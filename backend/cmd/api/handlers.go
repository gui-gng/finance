package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type Handler struct {
	db *DB
}

type Person struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

type Source struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

type Transaction struct {
	ID                int      `json:"id"`
	Date              string   `json:"date"`
	Establishment     string   `json:"establishment"`
	Holder            string   `json:"holder"`
	Amount            float64  `json:"amount"`
	InstallmentNumber *int     `json:"installment_number,omitempty"`
	InstallmentTotal  *int     `json:"installment_total,omitempty"`
	PersonID          int      `json:"person_id"`
	SourceID          int      `json:"source_id"`
	ImportID          int      `json:"import_id"`
	CategoryID        *int     `json:"category_id"`
	CategoryName      *string  `json:"category_name"`
	CategoryColor     *string  `json:"category_color"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) ListPeople(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.pool.Query(r.Context(), "SELECT id, name FROM people ORDER BY name")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	people := []Person{}
	for rows.Next() {
		var p Person
		if err := rows.Scan(&p.ID, &p.Name); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		people = append(people, p)
	}
	writeJSON(w, http.StatusOK, people)
}

func (h *Handler) CreatePerson(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	var p Person
	err := h.db.pool.QueryRow(r.Context(),
		"INSERT INTO people (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id, name",
		body.Name).Scan(&p.ID, &p.Name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (h *Handler) ListSources(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.pool.Query(r.Context(), "SELECT id, name FROM sources ORDER BY name")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	sources := []Source{}
	for rows.Next() {
		var s Source
		if err := rows.Scan(&s.ID, &s.Name); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		sources = append(sources, s)
	}
	writeJSON(w, http.StatusOK, sources)
}

func (h *Handler) CreateSource(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	var s Source
	err := h.db.pool.QueryRow(r.Context(),
		"INSERT INTO sources (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id, name",
		body.Name).Scan(&s.ID, &s.Name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, s)
}

func (h *Handler) ListHolders(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.pool.Query(r.Context(),
		"SELECT DISTINCT holder FROM transactions WHERE holder <> '' ORDER BY holder")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	holders := []string{}
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		holders = append(holders, s)
	}
	writeJSON(w, http.StatusOK, holders)
}

type Invoice struct {
	ID            int     `json:"id"`
	Name          string  `json:"name"`
	Filename      string  `json:"filename"`
	ReferenceDate *string `json:"reference_date"`
	PersonID      int     `json:"person_id"`
	SourceID      int     `json:"source_id"`
	Transactions  int     `json:"transactions"`
}

func (h *Handler) ListInvoices(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	where := "WHERE 1=1"
	args := []any{}
	n := 0
	add := func(cond string, v any) {
		n++
		where += fmt.Sprintf(" AND "+cond, n)
		args = append(args, v)
	}
	if v := q.Get("person_id"); v != "" {
		if id, err := strconv.Atoi(v); err == nil {
			add("i.person_id = $%d", id)
		}
	}
	if v := q.Get("source_id"); v != "" {
		if id, err := strconv.Atoi(v); err == nil {
			add("i.source_id = $%d", id)
		}
	}

	rows, err := h.db.pool.Query(r.Context(),
		fmt.Sprintf(`SELECT i.id, i.name, i.filename, i.reference_date, i.person_id, i.source_id, COUNT(t.id)
		 FROM imports i
		 LEFT JOIN transactions t ON t.import_id = i.id
		 %s
		 GROUP BY i.id ORDER BY i.reference_date DESC NULLS LAST, i.id DESC`, where),
		args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	invoices := []Invoice{}
	for rows.Next() {
		var v Invoice
		var ref *time.Time
		if err := rows.Scan(&v.ID, &v.Name, &v.Filename, &ref, &v.PersonID, &v.SourceID, &v.Transactions); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if ref != nil {
			s := ref.Format("2006-01-02")
			v.ReferenceDate = &s
		}
		invoices = append(invoices, v)
	}
	writeJSON(w, http.StatusOK, invoices)
}

type ImportResult struct {
	Filename     string `json:"filename"`
	Invoice      string `json:"invoice"`
	Transactions int    `json:"transactions"`
	Skipped      int    `json:"skipped"`
}

func (h *Handler) Import(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "invalid multipart form: "+err.Error())
		return
	}

	personID, err := strconv.Atoi(r.FormValue("person_id"))
	if err != nil || personID <= 0 {
		writeError(w, http.StatusBadRequest, "person_id is required")
		return
	}
	sourceID, err := strconv.Atoi(r.FormValue("source_id"))
	if err != nil || sourceID <= 0 {
		writeError(w, http.StatusBadRequest, "source_id is required")
		return
	}

	var sourceName string
	if err := h.db.pool.QueryRow(r.Context(), "SELECT name FROM sources WHERE id = $1", sourceID).Scan(&sourceName); err != nil {
		writeError(w, http.StatusBadRequest, "unknown source_id")
		return
	}

	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		writeError(w, http.StatusBadRequest, "no files provided (field name: files)")
		return
	}

	results := []ImportResult{}
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
		default:
			err = fmt.Errorf("no parser for source %q", sourceName)
		}
		f.Close()
		if err != nil {
			writeError(w, http.StatusBadRequest, fh.Filename+": "+err.Error())
			return
		}

		inserted, skipped, err := h.saveImport(r.Context(), personID, sourceID, fh.Filename, txs)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		results = append(results, ImportResult{
			Filename:     fh.Filename,
			Invoice:      invoiceName(fh.Filename),
			Transactions: inserted,
			Skipped:      skipped,
		})
	}

	writeJSON(w, http.StatusCreated, results)
}

// invoiceName derives the invoice name from the filename (without extension).
func invoiceName(filename string) string {
	name := filename
	if i := strings.LastIndex(name, "."); i > 0 {
		name = name[:i]
	}
	return name
}

// transactionUUID builds a deterministic UUID (v5/SHA-1) from the import and
// row data, so re-importing the same file does not create duplicates.
func transactionUUID(personID, sourceID int, invoice string, row int, t ParsedTransaction) uuid.UUID {
	key := fmt.Sprintf("%d|%d|%s|%d|%s|%s|%s|%.2f|%d|%d",
		personID, sourceID, invoice, row,
		t.Date.Format("2006-01-02"), t.Establishment, t.Holder, t.Amount,
		intValue(t.InstallmentNumber), intValue(t.InstallmentTotal))
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte(key))
}

func intValue(p *int) int {
	if p == nil {
		return 0
	}
	return *p
}

func (h *Handler) saveImport(ctx context.Context, personID, sourceID int, filename string, txs []ParsedTransaction) (int, int, error) {
	tx, err := h.db.pool.Begin(ctx)
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback(ctx)

	invoice := invoiceName(filename)

	var importID int
	err = tx.QueryRow(ctx,
		"INSERT INTO imports (person_id, source_id, filename, name, reference_date) VALUES ($1, $2, $3, $4, $5) RETURNING id",
		personID, sourceID, filename, invoice, ReferenceDateFromFilename(filename)).Scan(&importID)
	if err != nil {
		return 0, 0, err
	}

	inserted, skipped := 0, 0
	for i, t := range txs {
		tag, err := tx.Exec(ctx,
			`INSERT INTO transactions (uuid, import_id, person_id, source_id, date, establishment, holder, amount, installment_number, installment_total)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			 ON CONFLICT (uuid) DO NOTHING`,
			transactionUUID(personID, sourceID, invoice, i, t),
			importID, personID, sourceID, t.Date, t.Establishment, t.Holder, t.Amount, t.InstallmentNumber, t.InstallmentTotal)
		if err != nil {
			return 0, 0, err
		}
		if tag.RowsAffected() == 0 {
			skipped++
		} else {
			inserted++
		}
	}
	if inserted == 0 {
		if _, err := tx.Exec(ctx, "DELETE FROM imports WHERE id = $1", importID); err != nil {
			return 0, 0, err
		}
	} else if _, err := tx.Exec(ctx, categorizeSQL); err != nil {
		return 0, 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, 0, err
	}
	return inserted, skipped, nil
}

// filters builds a WHERE clause from query params on the transactions table.
func (h *Handler) filters(r *http.Request) (string, []any) {
	q := r.URL.Query()
	where := "WHERE 1=1"
	args := []any{}
	n := 0
	add := func(cond string, v any) {
		n++
		where += fmt.Sprintf(" AND "+cond, n)
		args = append(args, v)
	}
	if v := q.Get("person_id"); v != "" {
		if id, err := strconv.Atoi(v); err == nil {
			add("person_id = $%d", id)
		}
	}
	if v := q.Get("source_id"); v != "" {
		if id, err := strconv.Atoi(v); err == nil {
			add("source_id = $%d", id)
		}
	}
	if v := q.Get("import_id"); v != "" {
		if id, err := strconv.Atoi(v); err == nil {
			add("import_id = $%d", id)
		}
	}
	if v := q.Get("category_id"); v != "" {
		if v == "none" {
			where += " AND category_id IS NULL"
		} else if id, err := strconv.Atoi(v); err == nil {
			add("category_id = $%d", id)
		}
	}
	if v := q.Get("from"); v != "" {
		add("date >= $%d", v)
	}
	if v := q.Get("to"); v != "" {
		add("date <= $%d", v)
	}
	if v := q.Get("holder"); v != "" {
		add("holder = $%d", v)
	}
	if v := q.Get("search"); v != "" {
		add("establishment ILIKE '%%' || $%d || '%%'", v)
	}
	switch q.Get("type") {
	case "expense":
		where += " AND amount > 0"
	case "payment":
		where += " AND amount < 0"
	}
	return where, args
}

func (h *Handler) ListTransactions(w http.ResponseWriter, r *http.Request) {
	where, args := h.filters(r)

	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if l, err := strconv.Atoi(v); err == nil && l > 0 && l <= 5000 {
			limit = l
		}
	}
	offset := 0
	if v := r.URL.Query().Get("offset"); v != "" {
		if o, err := strconv.Atoi(v); err == nil && o >= 0 {
			offset = o
		}
	}

	var total int
	if err := h.db.pool.QueryRow(r.Context(),
		fmt.Sprintf("SELECT COUNT(*) FROM transactions %s", where), args...).Scan(&total); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	rows, err := h.db.pool.Query(r.Context(),
		fmt.Sprintf(`SELECT t.id, t.date, t.establishment, t.holder, t.amount, t.installment_number, t.installment_total, t.person_id, t.source_id, t.import_id, t.category_id, c.name, c.color
		 FROM transactions t
		 LEFT JOIN categories c ON c.id = t.category_id
		 %s ORDER BY t.date DESC, t.id DESC LIMIT %d OFFSET %d`, where, limit, offset),
		args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	txs := []Transaction{}
	for rows.Next() {
		var t Transaction
		var d time.Time
		if err := rows.Scan(&t.ID, &d, &t.Establishment, &t.Holder, &t.Amount, &t.InstallmentNumber, &t.InstallmentTotal, &t.PersonID, &t.SourceID, &t.ImportID, &t.CategoryID, &t.CategoryName, &t.CategoryColor); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		t.Date = d.Format("2006-01-02")
		txs = append(txs, t)
	}
	writeJSON(w, http.StatusOK, map[string]any{"total": total, "items": txs})
}

type Summary struct {
	TotalExpenses float64 `json:"total_expenses"`
	TotalPayments float64 `json:"total_payments"`
	Net           float64 `json:"net"`
	Count         int     `json:"count"`
	FirstDate     *string `json:"first_date"`
	LastDate      *string `json:"last_date"`
}

func (h *Handler) DashboardSummary(w http.ResponseWriter, r *http.Request) {
	where, args := h.filters(r)

	var s Summary
	var first, last *time.Time
	err := h.db.pool.QueryRow(r.Context(),
		fmt.Sprintf(`SELECT
			COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0),
			COALESCE(-SUM(amount) FILTER (WHERE amount < 0), 0),
			COALESCE(SUM(amount), 0),
			COUNT(*),
			MIN(date), MAX(date)
		 FROM transactions %s`, where),
		args...).Scan(&s.TotalExpenses, &s.TotalPayments, &s.Net, &s.Count, &first, &last)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if first != nil {
		v := first.Format("2006-01-02")
		s.FirstDate = &v
	}
	if last != nil {
		v := last.Format("2006-01-02")
		s.LastDate = &v
	}
	writeJSON(w, http.StatusOK, s)
}

type MonthlyPoint struct {
	Month    string  `json:"month"`
	Expenses float64 `json:"expenses"`
	Payments float64 `json:"payments"`
	Net      float64 `json:"net"`
}

func (h *Handler) DashboardMonthly(w http.ResponseWriter, r *http.Request) {
	where, args := h.filters(r)

	rows, err := h.db.pool.Query(r.Context(),
		fmt.Sprintf(`SELECT to_char(date, 'YYYY-MM'),
			COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0),
			COALESCE(-SUM(amount) FILTER (WHERE amount < 0), 0),
			COALESCE(SUM(amount), 0)
		 FROM transactions %s
		 GROUP BY 1 ORDER BY 1`, where),
		args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	points := []MonthlyPoint{}
	for rows.Next() {
		var p MonthlyPoint
		if err := rows.Scan(&p.Month, &p.Expenses, &p.Payments, &p.Net); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		points = append(points, p)
	}
	writeJSON(w, http.StatusOK, points)
}

type EstablishmentTotal struct {
	Establishment string  `json:"establishment"`
	Total         float64 `json:"total"`
	Count         int     `json:"count"`
}

func (h *Handler) DashboardTopEstablishments(w http.ResponseWriter, r *http.Request) {
	where, args := h.filters(r)

	rows, err := h.db.pool.Query(r.Context(),
		fmt.Sprintf(`SELECT establishment, SUM(amount), COUNT(*)
		 FROM transactions %s AND amount > 0
		 GROUP BY establishment ORDER BY SUM(amount) DESC LIMIT 15`, where),
		args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	items := []EstablishmentTotal{}
	for rows.Next() {
		var e EstablishmentTotal
		if err := rows.Scan(&e.Establishment, &e.Total, &e.Count); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		items = append(items, e)
	}
	writeJSON(w, http.StatusOK, items)
}

type HolderTotal struct {
	Holder   string  `json:"holder"`
	Expenses float64 `json:"expenses"`
	Count    int     `json:"count"`
}

func (h *Handler) DashboardByHolder(w http.ResponseWriter, r *http.Request) {
	where, args := h.filters(r)

	rows, err := h.db.pool.Query(r.Context(),
		fmt.Sprintf(`SELECT holder, COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0), COUNT(*) FILTER (WHERE amount > 0)
		 FROM transactions %s AND holder <> ''
		 GROUP BY holder ORDER BY 2 DESC`, where),
		args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	items := []HolderTotal{}
	for rows.Next() {
		var t HolderTotal
		if err := rows.Scan(&t.Holder, &t.Expenses, &t.Count); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		items = append(items, t)
	}
	writeJSON(w, http.StatusOK, items)
}

type WeekdayPoint struct {
	Weekday  int     `json:"weekday"`
	Expenses float64 `json:"expenses"`
	Count    int     `json:"count"`
}

func (h *Handler) DashboardByWeekday(w http.ResponseWriter, r *http.Request) {
	where, args := h.filters(r)

	rows, err := h.db.pool.Query(r.Context(),
		fmt.Sprintf(`SELECT extract(isodow from date)::int,
			COALESCE(SUM(amount), 0), COUNT(*)
		 FROM transactions %s AND amount > 0
		 GROUP BY 1 ORDER BY 1`, where),
		args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	items := []WeekdayPoint{}
	for rows.Next() {
		var p WeekdayPoint
		if err := rows.Scan(&p.Weekday, &p.Expenses, &p.Count); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		items = append(items, p)
	}
	writeJSON(w, http.StatusOK, items)
}

type InvoiceTotal struct {
	ImportID      int     `json:"import_id"`
	Filename      string  `json:"filename"`
	ReferenceDate *string `json:"reference_date"`
	Expenses      float64 `json:"expenses"`
	Payments      float64 `json:"payments"`
	Count         int     `json:"count"`
}

func (h *Handler) DashboardInvoices(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	where := "WHERE 1=1"
	args := []any{}
	n := 0
	add := func(cond string, v any) {
		n++
		where += fmt.Sprintf(" AND "+cond, n)
		args = append(args, v)
	}
	if v := q.Get("person_id"); v != "" {
		if id, err := strconv.Atoi(v); err == nil {
			add("i.person_id = $%d", id)
		}
	}
	if v := q.Get("source_id"); v != "" {
		if id, err := strconv.Atoi(v); err == nil {
			add("i.source_id = $%d", id)
		}
	}
	if v := q.Get("from"); v != "" {
		add("i.reference_date >= $%d", v)
	}
	if v := q.Get("to"); v != "" {
		add("i.reference_date <= $%d", v)
	}
	if v := q.Get("holder"); v != "" {
		add("t.holder = $%d", v)
	}
	if v := q.Get("search"); v != "" {
		add("t.establishment ILIKE '%%' || $%d || '%%'", v)
	}
	switch q.Get("type") {
	case "expense":
		where += " AND t.amount > 0"
	case "payment":
		where += " AND t.amount < 0"
	}

	rows, err := h.db.pool.Query(r.Context(),
		fmt.Sprintf(`SELECT i.id, i.filename, i.reference_date,
			COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0),
			COALESCE(-SUM(t.amount) FILTER (WHERE t.amount < 0), 0),
			COUNT(t.id)
		 FROM imports i
		 LEFT JOIN transactions t ON t.import_id = i.id
		 %s
		 GROUP BY i.id ORDER BY i.reference_date NULLS LAST, i.id`, where),
		args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	items := []InvoiceTotal{}
	for rows.Next() {
		var v InvoiceTotal
		var ref *time.Time
		if err := rows.Scan(&v.ImportID, &v.Filename, &ref, &v.Expenses, &v.Payments, &v.Count); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if ref != nil {
			s := ref.Format("2006-01-02")
			v.ReferenceDate = &s
		}
		items = append(items, v)
	}
	writeJSON(w, http.StatusOK, items)
}
