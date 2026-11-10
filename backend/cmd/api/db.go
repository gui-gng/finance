package main

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type DB struct {
	pool *pgxpool.Pool
}

func NewDB(url string) (*DB, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, err
	}
	return &DB{pool: pool}, nil
}

func (d *DB) Close() {
	d.pool.Close()
}

const schema = `
CREATE TABLE IF NOT EXISTS people (
    id   SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS sources (
    id   SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS imports (
    id             SERIAL PRIMARY KEY,
    person_id      INT NOT NULL REFERENCES people(id),
    source_id      INT NOT NULL REFERENCES sources(id),
    filename       TEXT NOT NULL,
    reference_date DATE,
    imported_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
    id                 SERIAL PRIMARY KEY,
    import_id          INT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
    person_id          INT NOT NULL REFERENCES people(id),
    source_id          INT NOT NULL REFERENCES sources(id),
    date               DATE NOT NULL,
    establishment      TEXT NOT NULL,
    holder             TEXT NOT NULL DEFAULT '',
    amount             NUMERIC(14,2) NOT NULL,
    installment_number INT,
    installment_total  INT
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_person ON transactions(person_id);
CREATE INDEX IF NOT EXISTS idx_transactions_source ON transactions(source_id);

ALTER TABLE imports ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
ALTER TABLE imports ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE imports ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS uuid UUID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_uuid ON transactions(uuid);
CREATE INDEX IF NOT EXISTS idx_transactions_import ON transactions(import_id);

UPDATE imports SET name = regexp_replace(filename, '\.[cC][sS][vV]$', '') WHERE name = '';

CREATE TABLE IF NOT EXISTS categories (
    id    SERIAL PRIMARY KEY,
    name  TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#5b8cff'
);

CREATE TABLE IF NOT EXISTS category_rules (
    id          SERIAL PRIMARY KEY,
    category_id INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    pattern     TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS budgets (
    category_id    INT PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
    monthly_amount NUMERIC(14,2) NOT NULL DEFAULT 0
);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS category_id INT REFERENCES categories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
`

const categorizeSQL = `
UPDATE transactions t SET category_id = (
    SELECT r.category_id
    FROM category_rules r
    WHERE t.establishment ILIKE '%' || r.pattern || '%'
    ORDER BY length(r.pattern) DESC, r.id
    LIMIT 1
);
`

var defaultCategories = []struct {
	Name  string
	Color string
}{
	{"Alimentação", "#f59e0b"},
	{"Transporte", "#22d3ee"},
	{"Saúde", "#f87171"},
	{"Casa", "#a78bfa"},
	{"Assinaturas", "#5b8cff"},
	{"Compras", "#34d399"},
	{"Educação", "#fbbf24"},
	{"Lazer", "#ec4899"},
	{"Viagens", "#38bdf8"},
	{"Serviços", "#94a3b8"},
	{"Pagamento fatura", "#64748b"},
}

var defaultRules = []struct {
	Category string
	Patterns []string
}{
	{"Alimentação", []string{"SUPERMERCADO", "MERCADO", "RESTAURANTE", "IFOOD", "PADARIA", "BURGUER", "PIZZA", "CAFE", "LANCHE", "CHICKEN", "SUSHI", "ACAI", "AÇAI", "CHURRAS", "BALAIO", "MARMITA", "BAR "}},
	{"Transporte", []string{"POSTO", "UBER", "99APP", "ESTACIONAMENTO", "PEDAGIO", "SEGURO AUTO", "DETRAN", "PNEU", "OFICINA", "AUTO PECAS", "AUTO POSTO", "LAVAGEM", "COMBUSTIVEL"}},
	{"Saúde", []string{"FARMACIA", "DROGARIA", "LABORATORIO", "HOSPITAL", "CLINICA", "DENTISTA", "PLANO DE SAUDE", "UNIMED", "FARMACONDE", "DR CONSULTA"}},
	{"Casa", []string{"CONSTRUCAO", "MOVEIS", "LEROY", "TINTAS", "FERRAGISTA", "MATERIAIS", "DECORACAO", "CASADACONSTRUCAO"}},
	{"Assinaturas", []string{"APPLE.COM/BILL", "NETFLIX", "SPOTIFY", "YOUTUBE", "GOOGLE", "MICROSOFT", "PRIME VIDEO", "AMAZON PRIME", "DISNEY", "HBO", "AWS", "OPENAI", "CHATGPT", "ICLOUD"}},
	{"Compras", []string{"MERCADOLIVRE", "AMAZON", "SHOPEE", "MAGAZINE", "MAGALU", "ALIEXPRESS", "SHEIN", "LOJA", "KALUNGA"}},
	{"Educação", []string{"CURSO", "ESCOLA", "FACULDADE", "UDEMY", "ALURA", "LIVRARIA", "HUBLA"}},
	{"Lazer", []string{"CINEMA", "TEATRO", "INGRESSO", "STEAM", "PLAYSTATION", "XBOX", "NINTENDO", "GAME", "BILHETERIA", "SHOW"}},
	{"Viagens", []string{"HOTEL", "AIRBNB", "LATAM", "GOL ", "AZUL", "VIAGEM", "PASSAGEM", "BOOKING", "POUSADA"}},
	{"Serviços", []string{"VIVO", "CLARO", "TIM ", "INTERNET", "ENERGIA", "ENEL", "SABESP", "CONTABIL", "SEGURO", "BANCO", "TARIFA"}},
	{"Pagamento fatura", []string{"PAGAMENTOS VALIDOS", "PAGAMENTO EFETUADO"}},
}

func (d *DB) Migrate() error {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if _, err := d.pool.Exec(ctx, schema); err != nil {
		return err
	}
	for _, seed := range []struct{ table, name string }{
		{"people", "gui"},
		{"sources", "xp"},
	} {
		if _, err := d.pool.Exec(ctx,
			"INSERT INTO "+seed.table+" (name) VALUES ($1) ON CONFLICT (name) DO NOTHING",
			seed.name); err != nil {
			return err
		}
	}

	for _, c := range defaultCategories {
		if _, err := d.pool.Exec(ctx,
			"INSERT INTO categories (name, color) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING",
			c.Name, c.Color); err != nil {
			return err
		}
	}
	for _, r := range defaultRules {
		for _, p := range r.Patterns {
			if _, err := d.pool.Exec(ctx,
				`INSERT INTO category_rules (category_id, pattern)
				 SELECT id, $1 FROM categories WHERE name = $2
				 ON CONFLICT (pattern) DO NOTHING`,
				p, r.Category); err != nil {
				return err
			}
		}
	}

	_, err := d.pool.Exec(ctx, categorizeSQL)
	return err
}
