package main

import (
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

func main() {
	dbURL := getenv("DATABASE_URL", "postgres://finance:finance@localhost:5432/finance?sslmode=disable")

	db, err := NewDB(dbURL)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer db.Close()

	if err := db.Migrate(); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	h := &Handler{db: db}

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"http://localhost:4200"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Route("/api", func(r chi.Router) {
		r.Get("/health", h.Health)
		r.Get("/people", h.ListPeople)
		r.Post("/people", h.CreatePerson)
		r.Get("/sources", h.ListSources)
		r.Post("/sources", h.CreateSource)
		r.Get("/holders", h.ListHolders)
		r.Get("/invoices", h.ListInvoices)
		r.Get("/categories", h.ListCategories)
		r.Post("/categories", h.CreateCategory)
		r.Delete("/categories/{id}", h.DeleteCategory)
		r.Put("/categories/{id}/budget", h.SetBudget)
		r.Post("/category-rules", h.CreateRule)
		r.Delete("/category-rules/{id}", h.DeleteRule)
		r.Post("/categorize", h.Recategorize)
		r.Post("/import", h.Import)
		r.Get("/transactions", h.ListTransactions)
		r.Get("/dashboard/summary", h.DashboardSummary)
		r.Get("/dashboard/monthly", h.DashboardMonthly)
		r.Get("/dashboard/top-establishments", h.DashboardTopEstablishments)
		r.Get("/dashboard/by-holder", h.DashboardByHolder)
		r.Get("/dashboard/by-weekday", h.DashboardByWeekday)
		r.Get("/dashboard/invoices", h.DashboardInvoices)
		r.Get("/dashboard/by-category", h.DashboardByCategory)
		r.Get("/dashboard/budget-status", h.DashboardBudgetStatus)
		r.Get("/dashboard/recurring", h.DashboardRecurring)
	})

	port := getenv("PORT", "8080")
	log.Printf("listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
