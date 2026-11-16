package main

import (
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ---------- auth ----------

func authToken() string {
	sum := sha256.Sum256([]byte("finance-token::" + authPassword()))
	return hex.EncodeToString(sum[:])
}

func authPassword() string {
	if p := os.Getenv("FINANCE_PASSWORD"); p != "" {
		return p
	}
	return "finance"
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.Password != authPassword() {
		writeError(w, http.StatusUnauthorized, "wrong password")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"token": authToken()})
}

func (h *Handler) AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+authToken() {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ---------- merchant aliases ----------

func (h *Handler) merchantAliases(ctx context.Context, q interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}) (map[string]string, error) {
	rows, err := q.Query(ctx, "SELECT alias, canonical FROM merchant_aliases")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := map[string]string{}
	for rows.Next() {
		var a, c string
		if err := rows.Scan(&a, &c); err != nil {
			return nil, err
		}
		m[strings.ToLower(a)] = c
	}
	return m, nil
}

// canonicalEstablishment replaces the establishment name with the canonical
// name of the longest matching alias (case-insensitive substring match).
func canonicalEstablishment(name string, aliases map[string]string) string {
	lower := strings.ToLower(name)
	best, bestLen := "", 0
	for alias, canonical := range aliases {
		if strings.Contains(lower, alias) && len(alias) > bestLen {
			best, bestLen = canonical, len(alias)
		}
	}
	if best == "" {
		return name
	}
	return best
}

func (h *Handler) ListAliases(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.pool.Query(r.Context(), "SELECT alias, canonical FROM merchant_aliases ORDER BY alias")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	type Alias struct {
		Alias     string `json:"alias"`
		Canonical string `json:"canonical"`
	}
	items := []Alias{}
	for rows.Next() {
		var a Alias
		if err := rows.Scan(&a.Alias, &a.Canonical); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		items = append(items, a)
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *Handler) CreateAlias(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Alias     string `json:"alias"`
		Canonical string `json:"canonical"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Alias == "" || body.Canonical == "" {
		writeError(w, http.StatusBadRequest, "alias and canonical are required")
		return
	}
	if _, err := h.db.pool.Exec(r.Context(),
		"INSERT INTO merchant_aliases (alias, canonical) VALUES ($1, $2) ON CONFLICT (alias) DO UPDATE SET canonical = EXCLUDED.canonical",
		body.Alias, body.Canonical); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Retroactively rename existing transactions.
	if _, err := h.db.pool.Exec(r.Context(),
		"UPDATE transactions SET establishment = $2 WHERE lower(establishment) LIKE '%' || lower($1) || '%'",
		body.Alias, body.Canonical); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, body)
}

func (h *Handler) DeleteAlias(w http.ResponseWriter, r *http.Request) {
	alias := r.PathValue("alias")
	if alias == "" {
		writeError(w, http.StatusBadRequest, "invalid alias")
		return
	}
	if _, err := h.db.pool.Exec(r.Context(), "DELETE FROM merchant_aliases WHERE alias = $1", alias); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------- transactions CRUD & tools ----------

type TransactionInput struct {
	Date          string   `json:"date"`
	Establishment string   `json:"establishment"`
	Holder        string   `json:"holder"`
	Amount        float64  `json:"amount"`
	CategoryID    *int     `json:"category_id"`
	Note          string   `json:"note"`
	Tags          []string `json:"tags"`
	Income        bool     `json:"income"`
	Installments  int      `json:"installments"` // >1 generates one parcel per month
}

func (h *Handler) CreateTransaction(w http.ResponseWriter, r *http.Request) {
	var body TransactionInput
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Date == "" || body.Establishment == "" || body.Amount == 0 {
		writeError(w, http.StatusBadRequest, "date, establishment and amount are required")
		return
	}
	date, err := time.Parse("2006-01-02", body.Date)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid date")
		return
	}
	personID, sourceID := defaultScope(r)
	if body.Tags == nil {
		body.Tags = []string{}
	}
	// Manual entries live under a synthetic "manual" import so the FK is satisfied.
	var manualImport int
	err = h.db.pool.QueryRow(r.Context(),
		"SELECT id FROM imports WHERE filename = 'manual' AND person_id = $1 ORDER BY id LIMIT 1", personID).Scan(&manualImport)
	if err != nil {
		if err2 := h.db.pool.QueryRow(r.Context(),
			"INSERT INTO imports (person_id, source_id, filename, name) VALUES ($1, $2, 'manual', 'manual') RETURNING id",
			personID, sourceID).Scan(&manualImport); err2 != nil {
			writeError(w, http.StatusInternalServerError, err2.Error())
			return
		}
	}
	amount := body.Amount
	if body.Income {
		amount = -abs(amount)
	}
	installments := body.Installments
	if installments < 1 {
		installments = 1
	}
	group := uuid.New()
	created := []int{}
	for i := 0; i < installments; i++ {
		d := date.AddDate(0, i, 0)
		var id int
		var instN, instT *int
		if installments > 1 {
			n, t := i+1, installments
			instN, instT = &n, &t
		}
		key := fmt.Sprintf("manual|%s|%s|%s|%d|%.2f|%d", body.Date, body.Establishment, body.Holder, i, amount, personID)
		err := h.db.pool.QueryRow(r.Context(),
			`INSERT INTO transactions (uuid, import_id, person_id, source_id, date, establishment, holder, amount, installment_number, installment_total, category_id, note, tags, income, split_group)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
			 ON CONFLICT (uuid) DO NOTHING RETURNING id`,
			uuid.NewSHA1(uuid.NameSpaceURL, []byte(key)), manualImport, personID, sourceID, d, body.Establishment, body.Holder,
			amount, instN, instT, body.CategoryID, body.Note, body.Tags, body.Income, group).Scan(&id)
		if err != nil && err != pgx.ErrNoRows {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if err == nil {
			created = append(created, id)
		}
	}
	writeJSON(w, http.StatusCreated, map[string]any{"created": created, "installments": installments})
}

func abs(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

func itoa(v int) string { return strconv.Itoa(v) }

func defaultScope(r *http.Request) (personID, sourceID int) {
	personID, sourceID = 1, 1
	if v := r.URL.Query().Get("person_id"); v != "" {
		if id, err := strconv.Atoi(v); err == nil && id > 0 {
			personID = id
		}
	}
	if v := r.URL.Query().Get("source_id"); v != "" {
		if id, err := strconv.Atoi(v); err == nil && id > 0 {
			sourceID = id
		}
	}
	return
}

func (h *Handler) UpdateTransaction(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	var body struct {
		CategoryID    *int     `json:"category_id"`
		Establishment *string  `json:"establishment"`
		Amount        *float64 `json:"amount"`
		Holder        *string  `json:"holder"`
		Note          *string  `json:"note"`
		Tags          []string `json:"tags"`
		Excluded      *bool    `json:"excluded"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	sets, args := []string{}, []any{}
	add := func(clause string, v any) {
		args = append(args, v)
		sets = append(sets, fmt.Sprintf(clause, len(args)))
	}
	if body.CategoryID != nil {
		add("category_id = $%d", *body.CategoryID)
	}
	if body.Establishment != nil {
		add("establishment = $%d", *body.Establishment)
	}
	if body.Amount != nil {
		add("amount = $%d", *body.Amount)
	}
	if body.Holder != nil {
		add("holder = $%d", *body.Holder)
	}
	if body.Note != nil {
		add("note = $%d", *body.Note)
	}
	if body.Tags != nil {
		add("tags = $%d", body.Tags)
	}
	if body.Excluded != nil {
		add("excluded = $%d", *body.Excluded)
	}
	if len(sets) == 0 {
		writeError(w, http.StatusBadRequest, "nothing to update")
		return
	}
	args = append(args, id)
	res, err := h.db.pool.Exec(r.Context(),
		fmt.Sprintf("UPDATE transactions SET %s WHERE id = $%d", strings.Join(sets, ", "), len(args)), args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "transaction not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) DeleteTransaction(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if _, err := h.db.pool.Exec(r.Context(), "DELETE FROM transactions WHERE id = $1", id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) BulkCategory(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs        []int `json:"ids"`
		CategoryID *int  `json:"category_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.IDs) == 0 {
		writeError(w, http.StatusBadRequest, "ids are required")
		return
	}
	tag, err := h.db.pool.Exec(r.Context(), "UPDATE transactions SET category_id = $1 WHERE id = ANY($2)",
		body.CategoryID, body.IDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"updated": tag.RowsAffected()})
}

func (h *Handler) SplitTransaction(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	var body struct {
		Splits []struct {
			CategoryID *int    `json:"category_id"`
			Amount     float64 `json:"amount"`
			Note       string  `json:"note"`
		} `json:"splits"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Splits) < 2 {
		writeError(w, http.StatusBadRequest, "at least 2 splits are required")
		return
	}
	var orig Transaction
	var d time.Time
	err = h.db.pool.QueryRow(r.Context(),
		`SELECT id, date, establishment, holder, amount, person_id, source_id, import_id, excluded, income
		 FROM transactions WHERE id = $1`, id).
		Scan(&orig.ID, &d, &orig.Establishment, &orig.Holder, &orig.Amount, &orig.PersonID, &orig.SourceID, &orig.ImportID, &orig.Excluded, &orig.Income)
	if err != nil {
		if err == pgx.ErrNoRows {
			writeError(w, http.StatusNotFound, "transaction not found")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sum := 0.0
	for _, s := range body.Splits {
		sum += s.Amount
	}
	if abs(sum-abs(orig.Amount)) > 0.02 {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("splits must total %.2f, got %.2f", abs(orig.Amount), sum))
		return
	}
	tx, err := h.db.pool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	group := uuid.New()
	for i, s := range body.Splits {
		key := fmt.Sprintf("split|%d|%s|%d|%.2f", id, group, i, s.Amount)
		if _, err := tx.Exec(r.Context(),
			`INSERT INTO transactions (uuid, import_id, person_id, source_id, date, establishment, holder, amount, category_id, note, tags, excluded, income, split_group)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
			uuid.NewSHA1(uuid.NameSpaceURL, []byte(key)), orig.ImportID, orig.PersonID, orig.SourceID, d,
			orig.Establishment, orig.Holder, s.Amount, s.CategoryID, s.Note, nil, orig.Excluded, orig.Income, group); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	if _, err := tx.Exec(r.Context(), "DELETE FROM transactions WHERE id = $1", id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"split_group": group.String()})
}

func (h *Handler) ExportTransactions(w http.ResponseWriter, r *http.Request) {
	where, args := h.filters(r)
	rows, err := h.db.pool.Query(r.Context(),
		fmt.Sprintf(`SELECT t.date, t.establishment, t.holder, t.amount, t.installment_number, t.installment_total, COALESCE(c.name, ''), t.note, array_to_string(t.tags, '|'), t.excluded, t.income
		 FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
		 %s ORDER BY t.date DESC, t.id DESC LIMIT 5000`, where), args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=transactions.csv")
	cw := csv.NewWriter(w)
	cw.Write([]string{"date", "establishment", "holder", "amount", "installment_number", "installment_total", "category", "note", "tags", "excluded", "income"})
	for rows.Next() {
		var d time.Time
		var amount float64
		var instN, instT *int
		var est, holder, cat, note, tags string
		var excluded, income bool
		if err := rows.Scan(&d, &est, &holder, &amount, &instN, &instT, &cat, &note, &tags, &excluded, &income); err != nil {
			return
		}
		cw.Write([]string{d.Format("2006-01-02"), est, holder, strconv.FormatFloat(amount, 'f', 2, 64),
			itoa(intValue(instN)), itoa(intValue(instT)), cat, note, tags, strconv.FormatBool(excluded), strconv.FormatBool(income)})
	}
	cw.Flush()
}

func (h *Handler) UploadReceipt(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := r.ParseMultipartForm(16 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "invalid multipart form")
		return
	}
	fh := r.MultipartForm.File["file"]
	if len(fh) == 0 {
		writeError(w, http.StatusBadRequest, "file is required (field: file)")
		return
	}
	dir := filepath.Join(os.TempDir(), "finance-receipts")
	_ = os.MkdirAll(dir, 0o755)
	name := fmt.Sprintf("%d-%s", id, filepath.Base(fh[0].Filename))
	dst := filepath.Join(dir, name)
	f, err := fh[0].Open()
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	defer f.Close()
	out, err := os.Create(dst)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer out.Close()
	if _, err := io.Copy(out, f); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if _, err := h.db.pool.Exec(r.Context(), "UPDATE transactions SET receipt = $1 WHERE id = $2", dst, id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"receipt": dst})
}

func (h *Handler) GetReceipt(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	var path string
	if err := h.db.pool.QueryRow(r.Context(), "SELECT receipt FROM transactions WHERE id = $1", id).Scan(&path); err != nil || path == "" {
		writeError(w, http.StatusNotFound, "no receipt")
		return
	}
	http.ServeFile(w, r, path)
}

func (h *Handler) InstallmentPlan(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	var establishment string
	var total int
	var refAmount float64
	err = h.db.pool.QueryRow(r.Context(),
		"SELECT establishment, COALESCE(installment_total, 1), amount FROM transactions WHERE id = $1", id).
		Scan(&establishment, &total, &refAmount)
	if err != nil {
		writeError(w, http.StatusNotFound, "transaction not found")
		return
	}
	rows, err := h.db.pool.Query(r.Context(),
		`SELECT id, date, installment_number, amount FROM transactions
		 WHERE lower(establishment) = lower($1) AND COALESCE(installment_total, 1) = $2
		   AND abs(amount - $3) < greatest(1, $3 * 0.02)
		 ORDER BY date`, establishment, total, refAmount)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	type Parcel struct {
		ID         int     `json:"id"`
		Date       string  `json:"date"`
		Number     int     `json:"installment_number"`
		Total      int     `json:"installment_total"`
		Amount     float64 `json:"amount"`
		Past       bool    `json:"past"`
	}
	items := []Parcel{}
	for rows.Next() {
		var p Parcel
		var d time.Time
		var num *int
		if err := rows.Scan(&p.ID, &d, &num, &p.Amount); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		p.Date = d.Format("2006-01-02")
		if num != nil {
			p.Number = *num
		}
		p.Total = total
		p.Past = !d.After(time.Now())
		items = append(items, p)
	}
	writeJSON(w, http.StatusOK, items)
}

type DuplicatePair struct {
	AID           int     `json:"a_id"`
	BID           int     `json:"b_id"`
	Date          string  `json:"date"`
	Establishment string  `json:"establishment"`
	Amount        float64 `json:"amount"`
	SameImport    bool    `json:"same_import"`
}

func (h *Handler) Duplicates(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.pool.Query(r.Context(),
		`SELECT a.id, b.id, a.date, a.establishment, a.amount, a.import_id = b.import_id
		 FROM transactions a
		 JOIN transactions b ON lower(a.establishment) = lower(b.establishment)
			AND a.amount = b.amount
			AND a.id < b.id
			AND abs(a.date - b.date) <= 3
		 WHERE a.excluded = FALSE AND b.excluded = FALSE
		 ORDER BY a.date DESC LIMIT 100`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items := []DuplicatePair{}
	for rows.Next() {
		var p DuplicatePair
		var d time.Time
		if err := rows.Scan(&p.AID, &p.BID, &d, &p.Establishment, &p.Amount, &p.SameImport); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		p.Date = d.Format("2006-01-02")
		items = append(items, p)
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *Handler) PairRefund(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ExpenseID int `json:"expense_id"`
		RefundID  int `json:"refund_id"`
		Pair      bool `json:"pair"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ExpenseID <= 0 || body.RefundID <= 0 {
		writeError(w, http.StatusBadRequest, "expense_id and refund_id are required")
		return
	}
	excluded := body.Pair
	tag, err := h.db.pool.Exec(r.Context(),
		"UPDATE transactions SET excluded = $1 WHERE id = ANY($2::int[])", excluded, []int{body.ExpenseID, body.RefundID})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"updated": tag.RowsAffected()})
}

// ---------- budgets: trend, rollover, period, suggestions, templates ----------

type TrendPoint struct {
	CategoryID int     `json:"category_id"`
	Name       string  `json:"name"`
	Color      string  `json:"color"`
	Month      string  `json:"month"`
	Spent      float64 `json:"spent"`
}

func (h *Handler) BudgetTrend(w http.ResponseWriter, r *http.Request) {
	months := 12
	if v := r.URL.Query().Get("months"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 36 {
			months = n
		}
	}
	extra, args := "", []any{}
	if v := r.URL.Query().Get("person_id"); v != "" {
		if id, err := strconv.Atoi(v); err == nil {
			args = append(args, id)
			extra += fmt.Sprintf(" AND t.person_id = $%d", len(args))
		}
	}
	if v := r.URL.Query().Get("source_id"); v != "" {
		if id, err := strconv.Atoi(v); err == nil {
			args = append(args, id)
			extra += fmt.Sprintf(" AND t.source_id = $%d", len(args))
		}
	}
	args = append(args, strconv.Itoa(months))
	rows, err := h.db.pool.Query(r.Context(),
		fmt.Sprintf(`SELECT c.id, c.name, c.color, to_char(t.date, 'YYYY-MM'), COALESCE(SUM(t.amount), 0)
		 FROM transactions t JOIN categories c ON c.id = t.category_id
		 WHERE t.amount > 0 AND t.income = FALSE AND t.excluded = FALSE
		   AND to_char(t.date, 'YYYY-MM') >= to_char(now() - ($%d::text || ' months')::interval, 'YYYY-MM') %s
		 GROUP BY 1, 2, 3, 4 ORDER BY 4`, len(args), extra), args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items := []TrendPoint{}
	for rows.Next() {
		var p TrendPoint
		if err := rows.Scan(&p.CategoryID, &p.Name, &p.Color, &p.Month, &p.Spent); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		items = append(items, p)
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *Handler) SetBudgetFlags(w http.ResponseWriter, r *http.Request) {
	categoryID, err := strconv.Atoi(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	var body struct {
		Rollover *bool   `json:"rollover"`
		Period   *string `json:"period"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	sets, args := []string{}, []any{}
	if body.Rollover != nil {
		args = append(args, *body.Rollover)
		sets = append(sets, fmt.Sprintf("rollover = $%d", len(args)))
	}
	if body.Period != nil && (*body.Period == "monthly" || *body.Period == "weekly") {
		args = append(args, *body.Period)
		sets = append(sets, fmt.Sprintf("period = $%d", len(args)))
	}
	if len(sets) == 0 {
		writeError(w, http.StatusBadRequest, "nothing to update")
		return
	}
	args = append(args, categoryID)
	tag, err := h.db.pool.Exec(r.Context(),
		fmt.Sprintf("UPDATE budgets SET %s WHERE category_id = $%d", strings.Join(sets, ", "), len(args)), args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "budget not set for this category")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) SuggestBudgets(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.pool.Query(r.Context(),
		`SELECT c.id, c.name, AVG(m.s)
		 FROM categories c
		 JOIN LATERAL (
			SELECT to_char(t.date, 'YYYY-MM') ym, SUM(t.amount) s
			FROM transactions t
			WHERE t.category_id = c.id AND t.amount > 0 AND t.income = FALSE AND t.excluded = FALSE
			  AND to_char(t.date, 'YYYY-MM') BETWEEN to_char(now() - '3 months'::interval, 'YYYY-MM')
				AND to_char(now() - '1 month'::interval, 'YYYY-MM')
			GROUP BY 1
		 ) m ON TRUE
		 GROUP BY c.id, c.name HAVING COUNT(*) >= 2 ORDER BY 2 DESC`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	type Suggestion struct {
		CategoryID int     `json:"category_id"`
		Name       string  `json:"name"`
		Amount     float64 `json:"amount"`
	}
	items := []Suggestion{}
	for rows.Next() {
		var s Suggestion
		if err := rows.Scan(&s.CategoryID, &s.Name, &s.Amount); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		s.Amount = float64(int(s.Amount*100+0.5)) / 100
		items = append(items, s)
	}
	writeJSON(w, http.StatusOK, items)
}

type BudgetTemplate struct {
	Name      string  `json:"name"`
	Amounts   []struct {
		CategoryID int     `json:"category_id"`
		Category   string  `json:"category"`
		Color      string  `json:"color"`
		Amount     float64 `json:"amount"`
	} `json:"amounts"`
}

func (h *Handler) ListTemplates(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.pool.Query(r.Context(),
		`SELECT bt.name, bt.category_id, c.name, c.color, bt.amount
		 FROM budget_templates bt JOIN categories c ON c.id = bt.category_id
		 ORDER BY bt.name, c.name`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	grouped := map[string]*BudgetTemplate{}
	order := []string{}
	for rows.Next() {
		var name string
		var catID int
		var cat, color string
		var amount float64
		if err := rows.Scan(&name, &catID, &cat, &color, &amount); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if _, ok := grouped[name]; !ok {
			grouped[name] = &BudgetTemplate{Name: name}
			order = append(order, name)
		}
		grouped[name].Amounts = append(grouped[name].Amounts, struct {
			CategoryID int     `json:"category_id"`
			Category   string  `json:"category"`
			Color      string  `json:"color"`
			Amount     float64 `json:"amount"`
		}{catID, cat, color, amount})
	}
	items := []BudgetTemplate{}
	for _, name := range order {
		items = append(items, *grouped[name])
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *Handler) SaveTemplate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name    string `json:"name"`
		Amounts []struct {
			CategoryID int     `json:"category_id"`
			Amount     float64 `json:"amount"`
		} `json:"amounts"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" || len(body.Amounts) == 0 {
		writeError(w, http.StatusBadRequest, "name and amounts are required")
		return
	}
	tx, err := h.db.pool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	if _, err := tx.Exec(r.Context(), "DELETE FROM budget_templates WHERE name = $1", body.Name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, a := range body.Amounts {
		if _, err := tx.Exec(r.Context(),
			"INSERT INTO budget_templates (name, category_id, amount) VALUES ($1, $2, $3)", body.Name, a.CategoryID, a.Amount); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"name": body.Name})
}

func (h *Handler) ApplyTemplate(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	rows, err := h.db.pool.Query(r.Context(), "SELECT category_id, amount FROM budget_templates WHERE name = $1", name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	type entry struct {
		catID int
		amt   float64
	}
	entries := []entry{}
	for rows.Next() {
		var e entry
		if err := rows.Scan(&e.catID, &e.amt); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		entries = append(entries, e)
	}
	if len(entries) == 0 {
		writeError(w, http.StatusNotFound, "template not found")
		return
	}
	for _, e := range entries {
		if _, err := h.db.pool.Exec(r.Context(),
			`INSERT INTO budgets (category_id, monthly_amount) VALUES ($1, $2)
			 ON CONFLICT (category_id) DO UPDATE SET monthly_amount = EXCLUDED.monthly_amount`, e.catID, e.amt); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]int{"applied": len(entries)})
}

func (h *Handler) DeleteTemplate(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if _, err := h.db.pool.Exec(r.Context(), "DELETE FROM budget_templates WHERE name = $1", name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------- savings goals ----------

type Goal struct {
	ID            int      `json:"id"`
	Name          string   `json:"name"`
	TargetAmount  float64  `json:"target_amount"`
	SavedAmount   float64  `json:"saved_amount"`
	Deadline      *string  `json:"deadline"`
	MonthlyNeeded *float64 `json:"monthly_needed,omitempty"`
}

func (h *Handler) ListGoals(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.pool.Query(r.Context(),
		"SELECT id, name, target_amount, saved_amount, deadline FROM savings_goals ORDER BY created_at")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items := []Goal{}
	for rows.Next() {
		var g Goal
		var dl *time.Time
		if err := rows.Scan(&g.ID, &g.Name, &g.TargetAmount, &g.SavedAmount, &dl); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if dl != nil {
			s := dl.Format("2006-01-02")
			g.Deadline = &s
			if g.TargetAmount > g.SavedAmount {
				monthsLeft := int(dl.Sub(time.Now()).Hours()/(24*30)) + 1
				if monthsLeft > 0 {
					v := (g.TargetAmount - g.SavedAmount) / float64(monthsLeft)
					g.MonthlyNeeded = &v
				}
			}
		}
		items = append(items, g)
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *Handler) SaveGoal(w http.ResponseWriter, r *http.Request) {
	var body Goal
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" || body.TargetAmount <= 0 {
		writeError(w, http.StatusBadRequest, "name and target_amount are required")
		return
	}
	var id int
	err := h.db.pool.QueryRow(r.Context(),
		`INSERT INTO savings_goals (name, target_amount, saved_amount, deadline) VALUES ($1, $2, $3, $4) RETURNING id`,
		body.Name, body.TargetAmount, body.SavedAmount, body.Deadline).Scan(&id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]int{"id": id})
}

func (h *Handler) UpdateGoal(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	var body Goal
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	tag, err := h.db.pool.Exec(r.Context(),
		"UPDATE savings_goals SET name = $1, target_amount = $2, saved_amount = $3, deadline = $4 WHERE id = $5",
		body.Name, body.TargetAmount, body.SavedAmount, body.Deadline, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "goal not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) DeleteGoal(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if _, err := h.db.pool.Exec(r.Context(), "DELETE FROM savings_goals WHERE id = $1", id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------- insights ----------

type Anomaly struct {
	CategoryID int     `json:"category_id"`
	Name       string  `json:"name"`
	Color      string  `json:"color"`
	Current    float64 `json:"current"`
	Average    float64 `json:"average"`
	ChangePct  float64 `json:"change_pct"`
}

func (h *Handler) Anomalies(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.pool.Query(r.Context(),
		`WITH monthly AS (
			SELECT category_id, to_char(date, 'YYYY-MM') m, SUM(amount) s
			FROM transactions WHERE amount > 0 AND income = FALSE AND excluded = FALSE AND category_id IS NOT NULL
			GROUP BY 1, 2
		), stats AS (
			SELECT category_id, AVG(s) a, COUNT(*) n
			FROM monthly WHERE m < to_char(now(), 'YYYY-MM') GROUP BY 1
		)
		SELECT c.id, c.name, c.color, mo.s, st.a, (mo.s - st.a) / st.a * 100
		 FROM monthly mo JOIN stats st ON st.category_id = mo.category_id
		 JOIN categories c ON c.id = mo.category_id
		 WHERE mo.m = to_char(now(), 'YYYY-MM') AND st.n >= 3
		   AND mo.s > st.a * 1.5 AND mo.s - st.a > 100
		 ORDER BY 6 DESC`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items := []Anomaly{}
	for rows.Next() {
		var a Anomaly
		if err := rows.Scan(&a.CategoryID, &a.Name, &a.Color, &a.Current, &a.Average, &a.ChangePct); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		items = append(items, a)
	}
	writeJSON(w, http.StatusOK, items)
}

type PriceChange struct {
	Establishment string  `json:"establishment"`
	Months        int     `json:"months"`
	MinAmount     float64 `json:"min_amount"`
	MaxAmount     float64 `json:"max_amount"`
	LastAmount    float64 `json:"last_amount"`
	Category      *string `json:"category"`
}

func (h *Handler) PriceChanges(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.pool.Query(r.Context(),
		`SELECT t.establishment,
			COUNT(DISTINCT to_char(t.date, 'YYYY-MM')),
			MIN(t.amount), MAX(t.amount),
			(SELECT t2.amount FROM transactions t2 WHERE lower(t2.establishment) = lower(t.establishment)
			 ORDER BY t2.date DESC LIMIT 1),
			MAX(c.name)
		 FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
		 WHERE t.amount > 0 AND t.income = FALSE AND t.excluded = FALSE
		 GROUP BY t.establishment
		 HAVING COUNT(DISTINCT to_char(t.date, 'YYYY-MM')) >= 2 AND COUNT(DISTINCT round(t.amount::numeric, 2)) > 1
		 ORDER BY 4 - 3 DESC LIMIT 20`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items := []PriceChange{}
	for rows.Next() {
		var p PriceChange
		if err := rows.Scan(&p.Establishment, &p.Months, &p.MinAmount, &p.MaxAmount, &p.LastAmount, &p.Category); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		items = append(items, p)
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *Handler) FunFacts(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	out := map[string]any{}

	var biggest struct {
		Establishment string  `json:"establishment"`
		Amount        float64 `json:"amount"`
		Date          string  `json:"date"`
	}
	var d time.Time
	err := h.db.pool.QueryRow(ctx,
		`SELECT establishment, amount, date FROM transactions WHERE amount > 0 AND income = FALSE AND excluded = FALSE ORDER BY amount DESC LIMIT 1`).
		Scan(&biggest.Establishment, &biggest.Amount, &d)
	if err == nil {
		biggest.Date = d.Format("2006-01-02")
		out["biggest_expense"] = biggest
	}

	var month struct {
		Month    string  `json:"month"`
		Expenses float64 `json:"expenses"`
	}
	err = h.db.pool.QueryRow(ctx,
		`SELECT to_char(date, 'YYYY-MM'), SUM(amount) FROM transactions
		 WHERE amount > 0 AND income = FALSE AND excluded = FALSE GROUP BY 1 ORDER BY 2 ASC LIMIT 1`).
		Scan(&month.Month, &month.Expenses)
	if err == nil {
		out["cheapest_month"] = month
	}

	var merchant struct {
		Establishment string `json:"establishment"`
		Count         int    `json:"count"`
	}
	err = h.db.pool.QueryRow(ctx,
		`SELECT establishment, COUNT(*) FROM transactions WHERE amount > 0 AND income = FALSE AND excluded = FALSE
		 GROUP BY 1 ORDER BY 2 DESC LIMIT 1`).Scan(&merchant.Establishment, &merchant.Count)
	if err == nil {
		out["most_frequent_merchant"] = merchant
	}

	var avg float64
	if err := h.db.pool.QueryRow(ctx,
		`SELECT AVG(amount) FROM transactions WHERE amount > 0 AND income = FALSE AND excluded = FALSE`).Scan(&avg); err == nil {
		out["average_ticket"] = avg
	}
	writeJSON(w, http.StatusOK, out)
}

type WeeklyDigest struct {
	Week        string         `json:"week"`
	From        string         `json:"from"`
	To          string         `json:"to"`
	Expenses    float64        `json:"expenses"`
	Count       int            `json:"count"`
	Categories  []CategorySpend `json:"categories"`
	Biggest     []Transaction  `json:"biggest"`
}

func (h *Handler) Weekly(w http.ResponseWriter, r *http.Request) {
	weekStr := r.URL.Query().Get("week") // e.g. 2026-W42; defaults to current week
	var from, to time.Time
	if weekStr != "" {
		parts := strings.Split(weekStr, "-W")
		if len(parts) != 2 {
			writeError(w, http.StatusBadRequest, "week must be YYYY-Www")
			return
		}
		y, _ := strconv.Atoi(parts[0])
		ww, _ := strconv.Atoi(parts[1])
		from = isoWeekStart(y, ww)
		to = from.AddDate(0, 0, 6)
	} else {
		now := time.Now()
		from = isoWeekStart(now.ISOWeek())
		to = from.AddDate(0, 0, 6)
		_, wn := now.ISOWeek()
		weekStr = fmt.Sprintf("%d-W%02d", now.Year(), wn)
	}

	var d WeeklyDigest
	d.Week = weekStr
	d.From = from.Format("2006-01-02")
	d.To = to.Format("2006-01-02")
	err := h.db.pool.QueryRow(r.Context(),
		`SELECT COALESCE(SUM(amount), 0), COUNT(*) FROM transactions
		 WHERE date BETWEEN $1 AND $2 AND amount > 0 AND income = FALSE AND excluded = FALSE`, d.From, d.To).
		Scan(&d.Expenses, &d.Count)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	rows, err := h.db.pool.Query(r.Context(),
		`SELECT COALESCE(c.name, 'Sem categoria'), COALESCE(c.color, '#8b93a7'), SUM(t.amount), COUNT(*)
		 FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
		 WHERE t.date BETWEEN $1 AND $2 AND t.amount > 0 AND t.income = FALSE AND t.excluded = FALSE
		 GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 5`, d.From, d.To)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var c CategorySpend
			if err := rows.Scan(&c.Category, &c.Color, &c.Total, &c.Count); err == nil {
				d.Categories = append(d.Categories, c)
			}
		}
	}

	txRows, err := h.db.pool.Query(r.Context(),
		`SELECT t.id, t.date, t.establishment, t.holder, t.amount, t.person_id, t.source_id, t.import_id
		 FROM transactions t
		 WHERE t.date BETWEEN $1 AND $2 AND t.amount > 0 AND t.income = FALSE AND t.excluded = FALSE
		 ORDER BY t.amount DESC LIMIT 3`, d.From, d.To)
	if err == nil {
		defer txRows.Close()
		for txRows.Next() {
			var t Transaction
			var dd time.Time
			if err := txRows.Scan(&t.ID, &dd, &t.Establishment, &t.Holder, &t.Amount, &t.PersonID, &t.SourceID, &t.ImportID); err == nil {
				t.Date = dd.Format("2006-01-02")
				d.Biggest = append(d.Biggest, t)
			}
		}
	}
	writeJSON(w, http.StatusOK, d)
}

func isoWeekStart(y, week int) time.Time {
	jan1 := time.Date(y, 1, 1, 0, 0, 0, 0, time.UTC)
	days := (week - 1) * 7
	// move to the Monday of ISO week 1, then add weeks
	offset := (int(jan1.Weekday()) + 6) % 7 // days since Monday
	return jan1.AddDate(0, 0, -offset+days)
}

var nlPeriodRe = regexp.MustCompile(`(mês passado|mes passado|neste mês|este mês|no mês|neste ano|este ano|ano passado)`)
var nlQueryRe = regexp.MustCompile(`quanto (?:gastei|paguei|gasto)(?:\s+(?:em|no|na|de|com))?\s*([a-z0-9áéíóúâêôãõç &.]{2,60})`)

func (h *Handler) Query(w http.ResponseWriter, r *http.Request) {
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	if q == "" {
		writeError(w, http.StatusBadRequest, "q is required")
		return
	}
	now := time.Now()
	current := now.Format("2006-01")
	lastDay := time.Date(now.Year(), now.Month()+1, 0, 0, 0, 0, 0, time.UTC).Day()
	from, to := current+"-01", fmt.Sprintf("%s-%02d", current, lastDay)
	periodLabel := "este mês"
	if m := nlPeriodRe.FindString(q); m != "" {
		switch m {
		case "mês passado", "mes passado":
			prev := now.AddDate(0, -1, 1)
			from = prev.Format("2006-01") + "-01"
			to = prev.Format("2006-01") + "-31"
			periodLabel = "mês passado"
		case "neste ano", "este ano":
			from = fmt.Sprintf("%d-01-01", now.Year())
			to = fmt.Sprintf("%s-%02d", current, lastDay)
			periodLabel = "este ano"
		case "ano passado":
			from = fmt.Sprintf("%d-01-01", now.Year()-1)
			to = fmt.Sprintf("%d-12-31", now.Year()-1)
			periodLabel = "ano passado"
		}
	}
	target := ""
	if m := nlQueryRe.FindStringSubmatch(q); m != nil {
		target = strings.TrimSpace(strings.TrimSuffix(m[1], nlPeriodRe.FindString(m[1])))
		target = strings.TrimSpace(strings.TrimSuffix(target, " neste"))
	}

	where := `WHERE t.date BETWEEN $1 AND $2 AND t.amount > 0 AND t.income = FALSE AND t.excluded = FALSE`
	args := []any{from, to}
	label := "total"
	if target != "" {
		args = append(args, target)
		where += fmt.Sprintf(` AND (t.establishment ILIKE '%%' || $%d || '%%' OR c.name ILIKE '%%' || $%d || '%%')`, len(args), len(args))
		label = target
	}
	var total float64
	var count int
	err := h.db.pool.QueryRow(r.Context(),
		fmt.Sprintf(`SELECT COALESCE(SUM(t.amount), 0), COUNT(*) FROM transactions t LEFT JOIN categories c ON c.id = t.category_id %s`, where),
		args...).Scan(&total, &count)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"total":        total,
		"count":        count,
		"label":        label,
		"period":       periodLabel,
		"answer":       fmt.Sprintf("R$ %.2f em %s %s (%d transações)", total, label, periodLabel, count),
		"from":         from,
		"to":           to,
	})
}

func (h *Handler) Hourly(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.pool.Query(r.Context(),
		`SELECT extract(isodow from date)::int, extract(hour from tx_time)::int, SUM(amount)
		 FROM transactions WHERE tx_time IS NOT NULL AND amount > 0 AND income = FALSE AND excluded = FALSE
		 GROUP BY 1, 2 ORDER BY 1, 2`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	type Cell struct {
		Weekday int     `json:"weekday"`
		Hour    int     `json:"hour"`
		Total   float64 `json:"total"`
	}
	items := []Cell{}
	for rows.Next() {
		var c Cell
		if err := rows.Scan(&c.Weekday, &c.Hour, &c.Total); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		items = append(items, c)
	}
	writeJSON(w, http.StatusOK, items)
}

// ---------- invoices: extras ----------

func (h *Handler) UpdateInvoice(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	var body struct {
		Note       *string  `json:"note"`
		MinPayment *float64 `json:"min_payment"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	sets, args := []string{}, []any{}
	if body.Note != nil {
		args = append(args, *body.Note)
		sets = append(sets, fmt.Sprintf("note = $%d", len(args)))
	}
	if body.MinPayment != nil {
		args = append(args, *body.MinPayment)
		sets = append(sets, fmt.Sprintf("min_payment = $%d", len(args)))
	}
	if len(sets) == 0 {
		writeError(w, http.StatusBadRequest, "nothing to update")
		return
	}
	args = append(args, id)
	tag, err := h.db.pool.Exec(r.Context(),
		fmt.Sprintf("UPDATE imports SET %s WHERE id = $%d", strings.Join(sets, ", "), len(args)), args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "invoice not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) DeleteInvoice(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	tag, err := h.db.pool.Exec(r.Context(), "DELETE FROM imports WHERE id = $1", id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "invoice not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type InvoicePayment struct {
	ID     int      `json:"id"`
	Amount float64  `json:"amount"`
	PaidAt string   `json:"paid_at"`
}

func (h *Handler) ListInvoicePayments(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	rows, err := h.db.pool.Query(r.Context(),
		"SELECT id, amount, paid_at FROM invoice_payments WHERE import_id = $1 ORDER BY paid_at DESC", id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items := []InvoicePayment{}
	for rows.Next() {
		var p InvoicePayment
		var d time.Time
		if err := rows.Scan(&p.ID, &p.Amount, &d); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		p.PaidAt = d.Format("2006-01-02")
		items = append(items, p)
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *Handler) AddInvoicePayment(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	var body struct {
		Amount float64 `json:"amount"`
		PaidAt string  `json:"paid_at"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Amount <= 0 {
		writeError(w, http.StatusBadRequest, "amount is required")
		return
	}
	paidAt := body.PaidAt
	if paidAt == "" {
		paidAt = time.Now().Format("2006-01-02")
	}
	var pid int
	if err := h.db.pool.QueryRow(r.Context(),
		"INSERT INTO invoice_payments (import_id, amount, paid_at) VALUES ($1, $2, $3) RETURNING id",
		id, body.Amount, paidAt).Scan(&pid); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]int{"id": pid})
}

func (h *Handler) DeleteInvoicePayment(w http.ResponseWriter, r *http.Request) {
	pid, err := strconv.Atoi(r.PathValue("pid"))
	if err != nil || pid <= 0 {
		writeError(w, http.StatusBadRequest, "invalid payment id")
		return
	}
	if _, err := h.db.pool.Exec(r.Context(), "DELETE FROM invoice_payments WHERE id = $1", pid); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) ListCardLimits(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.pool.Query(r.Context(), "SELECT holder, limit_amount FROM card_limits ORDER BY holder")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items := map[string]float64{}
	for rows.Next() {
		var holder string
		var amount float64
		if err := rows.Scan(&holder, &amount); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		items[holder] = amount
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *Handler) SetCardLimit(w http.ResponseWriter, r *http.Request) {
	holder := r.PathValue("holder")
	if holder == "" {
		writeError(w, http.StatusBadRequest, "invalid holder")
		return
	}
	var body struct {
		LimitAmount float64 `json:"limit_amount"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.LimitAmount <= 0 {
		if _, err := h.db.pool.Exec(r.Context(), "DELETE FROM card_limits WHERE holder = $1", holder); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if _, err := h.db.pool.Exec(r.Context(),
		`INSERT INTO card_limits (holder, limit_amount) VALUES ($1, $2)
		 ON CONFLICT (holder) DO UPDATE SET limit_amount = EXCLUDED.limit_amount`, holder, body.LimitAmount); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------- import preview & validation ----------

type PreviewRow struct {
	Date          string   `json:"date"`
	Establishment string   `json:"establishment"`
	Holder        string   `json:"holder"`
	Amount        float64  `json:"amount"`
	Installment   string   `json:"installment"`
	Category      string   `json:"category,omitempty"`
	Flags         []string `json:"flags"`
}

func (h *Handler) ImportPreview(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "invalid multipart form")
		return
	}
	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		writeError(w, http.StatusBadRequest, "no files provided")
		return
	}
	sourceName := r.FormValue("source")
	if sourceName == "" {
		sourceName = "xp"
	}
	type filePreview struct {
		Filename string       `json:"filename"`
		Rows     []PreviewRow `json:"rows"`
	}
	previews := []filePreview{}
	for _, fh := range files {
		f, err := fh.Open()
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		var txs []ParsedTransaction
		switch sourceName {
		case "xp":
			txs, err = ParseXPInvoice(f)
		case "nubank":
			txs, err = ParseNubankCSV(f)
		case "mapped":
			txs, err = ParseMappedCSV(f, r.FormValue("column_map"))
		default:
			err = fmt.Errorf("no parser for source %q", sourceName)
		}
		f.Close()
		if err != nil {
			writeError(w, http.StatusBadRequest, fh.Filename+": "+err.Error())
			return
		}
		// median for huge-amount detection
		amounts := []float64{}
		for _, t := range txs {
			amounts = append(amounts, abs(t.Amount))
		}
		sort.Float64s(amounts)
		median := 0.0
		if len(amounts) > 0 {
			median = amounts[len(amounts)/2]
		}
		rows := []PreviewRow{}
		for _, t := range txs {
			flags := []string{}
			if t.Date.After(time.Now()) {
				flags = append(flags, "future_date")
			}
			if t.Amount == 0 {
				flags = append(flags, "zero_amount")
			}
			if median > 0 && abs(t.Amount) > median*10 {
				flags = append(flags, "unusually_large")
			}
			inst := ""
			if t.InstallmentNumber != nil {
				inst = fmt.Sprintf("%d de %d", *t.InstallmentNumber, *t.InstallmentTotal)
			}
			rows = append(rows, PreviewRow{
				Date:          t.Date.Format("2006-01-02"),
				Establishment: t.Establishment,
				Holder:        t.Holder,
				Amount:        t.Amount,
				Installment:   inst,
				Flags:         flags,
			})
		}
		previews = append(previews, filePreview{Filename: fh.Filename, Rows: rows})
	}
	writeJSON(w, http.StatusOK, previews)
}

// ---------- backup & restore ----------

func (h *Handler) Backup(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	dump := map[string]any{}
	tables := []string{"people", "sources", "categories", "category_rules", "budgets", "merchant_aliases", "card_limits", "savings_goals", "budget_templates", "imports", "invoice_payments", "transactions"}
	for _, t := range tables {
		rows, err := h.db.pool.Query(ctx, fmt.Sprintf("SELECT to_jsonb(%s) FROM %s", t, t))
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		items := []any{}
		for rows.Next() {
			var v any
			if err := rows.Scan(&v); err != nil {
				rows.Close()
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			items = append(items, v)
		}
		rows.Close()
		dump[t] = items
	}
	w.Header().Set("Content-Disposition", "attachment; filename=finance-backup.json")
	writeJSON(w, http.StatusOK, dump)
}

func (h *Handler) Restore(w http.ResponseWriter, r *http.Request) {
	var dump map[string][]map[string]any
	if err := json.NewDecoder(r.Body).Decode(&dump); err != nil {
		writeError(w, http.StatusBadRequest, "invalid backup JSON")
		return
	}
	ctx := r.Context()
	restored := map[string]int{}
	// Order matters for FK integrity.
	simple := []struct {
		table string
		cols  []string
	}{
		{"people", []string{"name"}},
		{"sources", []string{"name"}},
		{"categories", []string{"name", "color", "parent_id"}},
		{"merchant_aliases", []string{"alias", "canonical"}},
		{"card_limits", []string{"holder", "limit_amount"}},
		{"savings_goals", []string{"name", "target_amount", "saved_amount", "deadline"}},
	}
	for _, s := range simple {
		for _, row := range dump[s.table] {
			placeholders := []string{}
			args := []any{}
			for i, c := range s.cols {
				placeholders = append(placeholders, fmt.Sprintf("$%d", i+1))
				args = append(args, row[c])
			}
			conflict := s.cols[0]
			if _, err := h.db.pool.Exec(ctx,
				fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s) ON CONFLICT (%s) DO NOTHING", s.table, strings.Join(s.cols, ", "), strings.Join(placeholders, ", "), conflict),
				args...); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			restored[s.table]++
		}
	}
	// Tables that need id-preserving upserts.
	for _, row := range dump["category_rules"] {
		if _, err := h.db.pool.Exec(ctx,
			`INSERT INTO category_rules (category_id, pattern)
			 SELECT c.id, $1 FROM categories c WHERE c.id = $2 ON CONFLICT (pattern) DO NOTHING`,
			row["pattern"], row["category_id"]); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		restored["category_rules"]++
	}
	for _, row := range dump["budgets"] {
		if _, err := h.db.pool.Exec(ctx,
			`INSERT INTO budgets (category_id, monthly_amount, rollover, period) VALUES ($1, $2, $3, $4)
			 ON CONFLICT (category_id) DO UPDATE SET monthly_amount = EXCLUDED.monthly_amount, rollover = EXCLUDED.rollover, period = EXCLUDED.period`,
			row["category_id"], row["monthly_amount"], row["rollover"], row["period"]); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		restored["budgets"]++
	}
	for _, row := range dump["budget_templates"] {
		if _, err := h.db.pool.Exec(ctx,
			`INSERT INTO budget_templates (name, category_id, amount) VALUES ($1, $2, $3)
			 ON CONFLICT (name, category_id) DO UPDATE SET amount = EXCLUDED.amount`,
			row["name"], row["category_id"], row["amount"]); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		restored["budget_templates"]++
	}
	for _, row := range dump["imports"] {
		if _, err := h.db.pool.Exec(ctx,
			`INSERT INTO imports (id, person_id, source_id, filename, name, reference_date, paid, paid_at, note, min_payment, inserted_count, skipped_count)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
			 ON CONFLICT (id) DO UPDATE SET paid = EXCLUDED.paid, note = EXCLUDED.note, min_payment = EXCLUDED.min_payment`,
			row["id"], row["person_id"], row["source_id"], row["filename"], row["name"], row["reference_date"], row["paid"], row["paid_at"], row["note"], row["min_payment"], row["inserted_count"], row["skipped_count"]); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		restored["imports"]++
	}
	for _, row := range dump["invoice_payments"] {
		if _, err := h.db.pool.Exec(ctx,
			`INSERT INTO invoice_payments (import_id, amount, paid_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
			row["import_id"], row["amount"], row["paid_at"]); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		restored["invoice_payments"]++
	}
	for _, row := range dump["transactions"] {
		cols := []string{"uuid", "import_id", "person_id", "source_id", "date", "establishment", "holder", "amount", "installment_number", "installment_total", "category_id", "note", "tags", "excluded", "income", "currency", "original_amount", "split_group", "tx_time"}
		placeholders := []string{}
		args := []any{}
		for i, c := range cols {
			placeholders = append(placeholders, fmt.Sprintf("$%d", i+1))
			args = append(args, row[c])
		}
		if _, err := h.db.pool.Exec(ctx,
			fmt.Sprintf(`INSERT INTO transactions (%s) VALUES (%s) ON CONFLICT (uuid) DO NOTHING`, strings.Join(cols, ", "), strings.Join(placeholders, ", ")),
			args...); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		restored["transactions"]++
	}
	writeJSON(w, http.StatusOK, restored)
}
