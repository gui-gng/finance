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
		r.Post("/auth/login", h.Login)

		// everything below requires the bearer token
		r.Group(func(r chi.Router) {
			r.Use(h.AuthMiddleware)
			r.Get("/people", h.ListPeople)
			r.Post("/people", h.CreatePerson)
			r.Get("/sources", h.ListSources)
			r.Post("/sources", h.CreateSource)
			r.Get("/holders", h.ListHolders)
			r.Get("/invoices", h.ListInvoices)
			r.Patch("/invoices/{id}/paid", h.SetInvoicePaid)
			r.Patch("/invoices/{id}", h.UpdateInvoice)
			r.Delete("/invoices/{id}", h.DeleteInvoice)
			r.Get("/invoices/{id}/payments", h.ListInvoicePayments)
			r.Post("/invoices/{id}/payments", h.AddInvoicePayment)
			r.Delete("/invoices/{id}/payments/{pid}", h.DeleteInvoicePayment)
			r.Get("/card-limits", h.ListCardLimits)
			r.Put("/card-limits/{holder}", h.SetCardLimit)
			r.Get("/categories", h.ListCategories)
			r.Post("/categories", h.CreateCategory)
			r.Delete("/categories/{id}", h.DeleteCategory)
			r.Post("/category-rules", h.CreateRule)
			r.Delete("/category-rules/{id}", h.DeleteRule)
			r.Post("/categorize", h.Recategorize)
			r.Put("/categories/{id}/budget", h.SetBudget)
			r.Put("/categories/{id}/flags", h.SetBudgetFlags)
			r.Post("/budgets/suggest", h.SuggestBudgets)
			r.Get("/budget-templates", h.ListTemplates)
			r.Post("/budget-templates", h.SaveTemplate)
			r.Post("/budget-templates/{name}/apply", h.ApplyTemplate)
			r.Delete("/budget-templates/{name}", h.DeleteTemplate)
			r.Get("/goals", h.ListGoals)
			r.Post("/goals", h.SaveGoal)
			r.Patch("/goals/{id}", h.UpdateGoal)
			r.Delete("/goals/{id}", h.DeleteGoal)
			r.Post("/import", h.Import)
			r.Post("/import/preview", h.ImportPreview)
			r.Post("/transactions", h.CreateTransaction)
			r.Patch("/transactions/{id}", h.UpdateTransaction)
			r.Delete("/transactions/{id}", h.DeleteTransaction)
			r.Post("/transactions/bulk-category", h.BulkCategory)
			r.Post("/transactions/{id}/split", h.SplitTransaction)
			r.Post("/transactions/pair-refund", h.PairRefund)
			r.Get("/transactions/duplicates", h.Duplicates)
			r.Get("/transactions/export", h.ExportTransactions)
			r.Post("/transactions/{id}/receipt", h.UploadReceipt)
			r.Get("/transactions/{id}/receipt", h.GetReceipt)
			r.Get("/transactions/{id}/installment-plan", h.InstallmentPlan)
			r.Get("/transactions", h.ListTransactions)
			r.Get("/merchants/aliases", h.ListAliases)
			r.Post("/merchants/aliases", h.CreateAlias)
			r.Delete("/merchants/aliases/{alias}", h.DeleteAlias)
			r.Get("/dashboard/summary", h.DashboardSummary)
			r.Get("/dashboard/monthly", h.DashboardMonthly)
			r.Get("/dashboard/top-establishments", h.DashboardTopEstablishments)
			r.Get("/dashboard/by-holder", h.DashboardByHolder)
			r.Get("/dashboard/by-weekday", h.DashboardByWeekday)
			r.Get("/dashboard/invoices", h.DashboardInvoices)
			r.Get("/dashboard/by-category", h.DashboardByCategory)
			r.Get("/dashboard/budget-status", h.DashboardBudgetStatus)
			r.Get("/dashboard/recurring", h.DashboardRecurring)
			r.Get("/dashboard/installments", h.DashboardInstallments)
			r.Get("/dashboard/budget-trend", h.BudgetTrend)
			r.Get("/insights/anomalies", h.Anomalies)
			r.Get("/insights/price-changes", h.PriceChanges)
			r.Get("/insights/fun-facts", h.FunFacts)
			r.Get("/insights/weekly", h.Weekly)
			r.Get("/insights/query", h.Query)
			r.Get("/insights/hourly", h.Hourly)
			r.Get("/backup", h.Backup)
			r.Post("/restore", h.Restore)
		})
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
