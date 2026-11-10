package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
)

type CategoryRule struct {
	ID      int    `json:"id"`
	Pattern string `json:"pattern"`
}

type Category struct {
	ID     int            `json:"id"`
	Name   string         `json:"name"`
	Color  string         `json:"color"`
	Rules  []CategoryRule `json:"rules"`
	Budget *float64       `json:"budget"`
}

func (h *Handler) ListCategories(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.pool.Query(r.Context(),
		`SELECT c.id, c.name, c.color, b.monthly_amount,
			COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'pattern', r.pattern) ORDER BY r.pattern)
				FROM category_rules r WHERE r.category_id = c.id), '[]'::jsonb)
		 FROM categories c
		 LEFT JOIN budgets b ON b.category_id = c.id
		 ORDER BY c.name`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	cats := []Category{}
	for rows.Next() {
		var c Category
		if err := rows.Scan(&c.ID, &c.Name, &c.Color, &c.Budget, &c.Rules); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		cats = append(cats, c)
	}
	writeJSON(w, http.StatusOK, cats)
}

func (h *Handler) CreateCategory(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if body.Color == "" {
		body.Color = "#5b8cff"
	}
	var c Category
	err := h.db.pool.QueryRow(r.Context(),
		`INSERT INTO categories (name, color) VALUES ($1, $2)
		 ON CONFLICT (name) DO UPDATE SET color = EXCLUDED.color
		 RETURNING id, name, color`,
		body.Name, body.Color).Scan(&c.ID, &c.Name, &c.Color)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	c.Rules = []CategoryRule{}
	writeJSON(w, http.StatusCreated, c)
}

func (h *Handler) DeleteCategory(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if _, err := h.db.pool.Exec(r.Context(), "DELETE FROM categories WHERE id = $1", id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type RuleInput struct {
	CategoryID int    `json:"category_id"`
	Pattern    string `json:"pattern"`
}

func (h *Handler) CreateRule(w http.ResponseWriter, r *http.Request) {
	var body RuleInput
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.CategoryID <= 0 || body.Pattern == "" {
		writeError(w, http.StatusBadRequest, "category_id and pattern are required")
		return
	}
	var id int
	err := h.db.pool.QueryRow(r.Context(),
		`INSERT INTO category_rules (category_id, pattern) VALUES ($1, upper($2))
		 ON CONFLICT (pattern) DO UPDATE SET category_id = EXCLUDED.category_id
		 RETURNING id`,
		body.CategoryID, body.Pattern).Scan(&id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := h.recategorize(r); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]int{"id": id})
}

func (h *Handler) DeleteRule(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if _, err := h.db.pool.Exec(r.Context(), "DELETE FROM category_rules WHERE id = $1", id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := h.recategorize(r); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) recategorize(r *http.Request) error {
	_, err := h.db.pool.Exec(r.Context(), categorizeSQL)
	return err
}

func (h *Handler) Recategorize(w http.ResponseWriter, r *http.Request) {
	if err := h.recategorize(r); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	var categorized, uncategorized int
	err := h.db.pool.QueryRow(r.Context(),
		`SELECT COUNT(*) FILTER (WHERE category_id IS NOT NULL),
			COUNT(*) FILTER (WHERE category_id IS NULL)
		 FROM transactions`).Scan(&categorized, &uncategorized)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"categorized": categorized, "uncategorized": uncategorized})
}

func (h *Handler) SetBudget(w http.ResponseWriter, r *http.Request) {
	categoryID, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	var body struct {
		MonthlyAmount float64 `json:"monthly_amount"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "monthly_amount is required")
		return
	}
	if body.MonthlyAmount <= 0 {
		if _, err := h.db.pool.Exec(r.Context(), "DELETE FROM budgets WHERE category_id = $1", categoryID); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if _, err := h.db.pool.Exec(r.Context(),
		`INSERT INTO budgets (category_id, monthly_amount) VALUES ($1, $2)
		 ON CONFLICT (category_id) DO UPDATE SET monthly_amount = EXCLUDED.monthly_amount`,
		categoryID, body.MonthlyAmount); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type BudgetStatus struct {
	CategoryID int     `json:"category_id"`
	Name       string  `json:"name"`
	Color      string  `json:"color"`
	Budget     float64 `json:"budget"`
	Spent      float64 `json:"spent"`
}

func (h *Handler) DashboardBudgetStatus(w http.ResponseWriter, r *http.Request) {
	month := r.URL.Query().Get("month")
	if month == "" {
		month = time.Now().Format("2006-01")
	}

	extra := ""
	args := []any{month}
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

	rows, err := h.db.pool.Query(r.Context(),
		fmt.Sprintf(`SELECT c.id, c.name, c.color, b.monthly_amount,
			COALESCE((SELECT SUM(t.amount) FROM transactions t
				WHERE t.category_id = c.id AND t.amount > 0 AND to_char(t.date, 'YYYY-MM') = $1 %s), 0)
		 FROM budgets b
		 JOIN categories c ON c.id = b.category_id
		 ORDER BY c.name`, extra),
		args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	items := []BudgetStatus{}
	for rows.Next() {
		var b BudgetStatus
		if err := rows.Scan(&b.CategoryID, &b.Name, &b.Color, &b.Budget, &b.Spent); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		items = append(items, b)
	}
	writeJSON(w, http.StatusOK, items)
}

type RecurringItem struct {
	Establishment string  `json:"establishment"`
	Months        int     `json:"months"`
	Count         int     `json:"count"`
	AvgAmount     float64 `json:"avg_amount"`
	Total         float64 `json:"total"`
	Category      *string `json:"category"`
	Color         *string `json:"color"`
}

func (h *Handler) DashboardRecurring(w http.ResponseWriter, r *http.Request) {
	where, args := h.filters(r)

	rows, err := h.db.pool.Query(r.Context(),
		fmt.Sprintf(`SELECT t.establishment,
			COUNT(DISTINCT to_char(t.date, 'YYYY-MM')),
			COUNT(*),
			AVG(t.amount),
			SUM(t.amount),
			MAX(c.name),
			MAX(c.color)
		 FROM transactions t
		 LEFT JOIN categories c ON c.id = t.category_id
		 %s AND t.amount > 0
		 GROUP BY t.establishment
		 HAVING COUNT(DISTINCT to_char(t.date, 'YYYY-MM')) >= 3
		 ORDER BY 2 DESC, 5 DESC
		 LIMIT 20`, where),
		args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	items := []RecurringItem{}
	for rows.Next() {
		var item RecurringItem
		if err := rows.Scan(&item.Establishment, &item.Months, &item.Count, &item.AvgAmount, &item.Total, &item.Category, &item.Color); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		items = append(items, item)
	}
	writeJSON(w, http.StatusOK, items)
}

type CategorySpend struct {
	Category string  `json:"category"`
	Color    string  `json:"color"`
	Total    float64 `json:"total"`
	Count    int     `json:"count"`
}

func (h *Handler) DashboardByCategory(w http.ResponseWriter, r *http.Request) {
	where, args := h.filters(r)

	rows, err := h.db.pool.Query(r.Context(),
		fmt.Sprintf(`SELECT COALESCE(c.name, 'Sem categoria'), COALESCE(c.color, '#8b93a7'),
			SUM(t.amount), COUNT(*)
		 FROM transactions t
		 LEFT JOIN categories c ON c.id = t.category_id
		 %s AND t.amount > 0
		 GROUP BY 1, 2 ORDER BY 3 DESC`, where),
		args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	items := []CategorySpend{}
	for rows.Next() {
		var s CategorySpend
		if err := rows.Scan(&s.Category, &s.Color, &s.Total, &s.Count); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		items = append(items, s)
	}
	writeJSON(w, http.StatusOK, items)
}
