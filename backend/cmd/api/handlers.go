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
	Note              string   `json:"note,omitempty"`
	Tags              []string `json:"tags,omitempty"`
	Excluded          bool     `json:"excluded"`
	Income            bool     `json:"income"`
	Currency          string   `json:"currency,omitempty"`
	OriginalAmount    *float64 `json:"original_amount,omitempty"`
	HasReceipt        bool     `json:"has_receipt,omitempty"`
	TxTime            *string  `json:"tx_time,omitempty"`
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
	ID            int      `json:"id"`
	Name          string   `json:"name"`
	Filename      string   `json:"filename"`
	ReferenceDate *string  `json:"reference_date"`
	PersonID      int      `json:"person_id"`
	SourceID      int      `json:"source_id"`
	Transactions  int      `json:"transactions"`
	Paid          bool     `json:"paid"`
	PaidAt        *string  `json:"paid_at,omitempty"`
	Note          string   `json:"note,omitempty"`
	MinPayment    *float64 `json:"min_payment,omitempty"`
	InsertedCount int      `json:"inserted_count"`
	SkippedCount  int      `json:"skipped_count"`
	ImportedAt    string   `json:"imported_at"`
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
		fmt.Sprintf(`SELECT i.id, i.name, i.filename, i.reference_date, i.person_id, i.source_id, COUNT(t.id), i.paid, i.paid_at, i.note, i.min_payment, i.inserted_count, i.skipped_count, i.imported_at
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
		var ref, paidAt *time.Time
		var importedAt time.Time
		if err := rows.Scan(&v.ID, &v.Name, &v.Filename, &ref, &v.PersonID, &v.SourceID, &v.Transactions, &v.Paid, &paidAt, &v.Note, &v.MinPayment, &v.InsertedCount, &v.SkippedCount, &importedAt); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if ref != nil {
			s := ref.Format("2006-01-02")
			v.ReferenceDate = &s
		}
		if paidAt != nil {
			s := paidAt.Format("2006-01-02")
			v.PaidAt = &s
		}
		v.ImportedAt = importedAt.Format("2006-01-02 15:04")
		invoices = append(invoices, v)
	}
	writeJSON(w, http.StatusOK, invoices)
}

// SetInvoicePaid marks an invoice as paid (or unpaid) and records when.
func (h *Handler) SetInvoicePaid(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid invoice id")
		return
	}
	var body struct {
		Paid bool `json:"paid"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	paidAt := any(nil)
	if body.Paid {
		paidAt = time.Now()
	}
	var exists bool
	err = h.db.pool.QueryRow(r.Context(),
		"UPDATE imports SET paid = $1, paid_at = $2 WHERE id = $3 RETURNING TRUE", body.Paid, paidAt, id).Scan(&exists)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "invoice not found")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "paid": body.Paid})
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

	// multi-currency: amount is always stored converted to BRL;
	// original_amount/currency preserve the source value when provided.
	currency := r.FormValue("currency")
	fxRate := 1.0
	if v := r.FormValue("fx_rate"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil && f > 0 {
			fxRate = f
		}
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

		inserted, skipped, err := h.saveImport(r.Context(), personID, sourceID, fh.Filename, txs, currency, fxRate)
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

func (h *Handler) saveImport(ctx context.Context, personID, sourceID int, filename string, txs []ParsedTransaction, currency string, fxRate float64) (int, int, error) {
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

	// Normalize establishment names through merchant aliases (longest match wins).
	aliases, err := h.merchantAliases(ctx, tx)
	if err != nil {
		return 0, 0, err
	}

	inserted, skipped := 0, 0
	rowCurrency := currency
	if rowCurrency == "" {
		rowCurrency = "BRL"
	}
	for i, t := range txs {
		if c := canonicalEstablishment(t.Establishment, aliases); c != t.Establishment {
			t.Establishment = c
		}
		amount := t.Amount
		var original any
		if rowCurrency != "BRL" && fxRate != 1 {
			original = t.Amount
			amount = t.Amount * fxRate
		}
		tag, err := tx.Exec(ctx,
			`INSERT INTO transactions (uuid, import_id, person_id, source_id, date, establishment, holder, amount, installment_number, installment_total, currency, original_amount, tx_time)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
			 ON CONFLICT (uuid) DO NOTHING`,
			transactionUUID(personID, sourceID, invoice, i, t),
			importID, personID, sourceID, t.Date, t.Establishment, t.Holder, amount, t.InstallmentNumber, t.InstallmentTotal, rowCurrency, original, t.Time)
		if err != nil {
			return 0, 0, err
		}
		if tag.RowsAffected() == 0 {
			skipped++
		} else {
			inserted++
		}
	}
	if _, err := tx.Exec(ctx, "UPDATE imports SET inserted_count = $1, skipped_count = $2 WHERE id = $3", inserted, skipped, importID); err != nil {
		return 0, 0, err
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
	if v := q.Get("tag"); v != "" {
		add("$%d = ANY(tags)", v)
	}
	if q.Get("include_excluded") != "1" {
		where += " AND excluded = FALSE"
	}
	switch q.Get("type") {
	case "expense":
		where += " AND amount > 0 AND income = FALSE"
	case "payment":
		where += " AND amount < 0 AND income = FALSE"
	case "income":
		where += " AND income = TRUE"
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
		fmt.Sprintf(`SELECT t.id, t.date, t.establishment, t.holder, t.amount, t.installment_number, t.installment_total, t.person_id, t.source_id, t.import_id, t.category_id, c.name, c.color, t.note, t.tags, t.excluded, t.income, t.currency, t.original_amount, t.receipt <> '', t.tx_time
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
		var tt *time.Time
		if err := rows.Scan(&t.ID, &d, &t.Establishment, &t.Holder, &t.Amount, &t.InstallmentNumber, &t.InstallmentTotal, &t.PersonID, &t.SourceID, &t.ImportID, &t.CategoryID, &t.CategoryName, &t.CategoryColor, &t.Note, &t.Tags, &t.Excluded, &t.Income, &t.Currency, &t.OriginalAmount, &t.HasReceipt, &tt); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		t.Date = d.Format("2006-01-02")
		if tt != nil {
			s := tt.Format("15:04")
			t.TxTime = &s
		}
		txs = append(txs, t)
	}
	writeJSON(w, http.StatusOK, map[string]any{"total": total, "items": txs})
}

type Summary struct {
	TotalExpenses float64 `json:"total_expenses"`
	TotalPayments float64 `json:"total_payments"`
	TotalIncome   float64 `json:"total_income"`
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
			COALESCE(SUM(amount) FILTER (WHERE amount > 0 AND income = FALSE), 0),
			COALESCE(-SUM(amount) FILTER (WHERE amount < 0 AND income = FALSE), 0),
			COALESCE(-SUM(amount) FILTER (WHERE income = TRUE), 0),
			COALESCE(SUM(amount), 0),
			COUNT(*),
			MIN(date), MAX(date)
		 FROM transactions %s`, where),
		args...).Scan(&s.TotalExpenses, &s.TotalPayments, &s.TotalIncome, &s.Net, &s.Count, &first, &last)
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
	Paid          bool    `json:"paid"`
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
	if v := q.Get("category_id"); v != "" {
		if v == "none" {
			where += " AND t.category_id IS NULL"
		} else if id, err := strconv.Atoi(v); err == nil {
			add("t.category_id = $%d", id)
		}
	}
	switch q.Get("type") {
	case "expense":
		where += " AND t.amount > 0"
	case "payment":
		where += " AND t.amount < 0"
	}

	rows, err := h.db.pool.Query(r.Context(),
		fmt.Sprintf(`SELECT i.id, i.filename, i.reference_date, i.paid,
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
		if err := rows.Scan(&v.ImportID, &v.Filename, &ref, &v.Paid, &v.Expenses, &v.Payments, &v.Count); err != nil {
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

type InstallmentItem struct {
	Establishment   string  `json:"establishment"`
	Holder          string  `json:"holder"`
	Category        *string `json:"category"`
	Color           *string `json:"color"`
	InstallmentMax  int     `json:"installment_total"`
	Current         int     `json:"current"`
	Remaining       int     `json:"remaining"`
	MonthlyAmount   float64 `json:"monthly_amount"`
	TotalCommitted  float64 `json:"total_committed"`
}

// DashboardInstallments lists installment purchases that are not yet fully
// paid (installment_number < installment_total), grouped by establishment,
// holder, total installments, and category.
func (h *Handler) DashboardInstallments(w http.ResponseWriter, r *http.Request) {
	where, args := h.filters(r)

	rows, err := h.db.pool.Query(r.Context(),
		fmt.Sprintf(`SELECT t.establishment, t.holder, c.name, c.color, t.installment_total,
			MAX(t.installment_number),
			COUNT(*),
			AVG(t.amount),
			SUM(t.amount) + (t.installment_total - MAX(t.installment_number)) * AVG(t.amount)
		 FROM transactions t
		 LEFT JOIN categories c ON c.id = t.category_id
		 %s AND t.installment_total > 1 AND t.installment_number < t.installment_total AND t.amount > 0
		 GROUP BY t.establishment, t.holder, c.name, c.color, t.installment_total
		 ORDER BY AVG(t.amount) DESC`, where),
		args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	items := []InstallmentItem{}
	for rows.Next() {
		var it InstallmentItem
		var count int
		if err := rows.Scan(&it.Establishment, &it.Holder, &it.Category, &it.Color, &it.InstallmentMax,
			&it.Current, &count, &it.MonthlyAmount, &it.TotalCommitted); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		it.Remaining = it.InstallmentMax - it.Current
		items = append(items, it)
	}
	writeJSON(w, http.StatusOK, items)
}
