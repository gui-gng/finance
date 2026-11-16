package main

import (
	"bufio"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type ParsedTransaction struct {
	Date              time.Time
	Establishment     string
	Holder            string
	Amount            float64
	InstallmentNumber *int
	InstallmentTotal  *int
	Time              *time.Time
}

var brlAmountRe = regexp.MustCompile(`^-?[\d.]*,\d{2}$`)
var installmentRe = regexp.MustCompile(`^(\d+)\s+de\s+(\d+)$`)

func parseBRL(s string) (float64, error) {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "R$")
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, ".", "")
	s = strings.ReplaceAll(s, ",", ".")
	return strconv.ParseFloat(s, 64)
}

// ParseXPInvoice parses an XP credit card invoice CSV:
// Data;Estabelecimento;Portador;Valor;Parcela (semicolon separated, dd/mm/yyyy, BRL values).
func ParseXPInvoice(r io.Reader) ([]ParsedTransaction, error) {
	br := bufio.NewReader(r)
	if b, err := br.Peek(3); err == nil && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF {
		br.Discard(3)
	}
	cr := csv.NewReader(br)
	cr.Comma = ';'
	cr.LazyQuotes = true
	cr.TrimLeadingSpace = true

	header, err := cr.Read()
	if err != nil {
		return nil, fmt.Errorf("read header: %w", err)
	}
	if len(header) < 5 || !strings.EqualFold(strings.TrimSpace(header[0]), "Data") {
		return nil, fmt.Errorf("unexpected header: %v", header)
	}

	var txs []ParsedTransaction
	line := 1
	for {
		rec, err := cr.Read()
		line++
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("line %d: %w", line, err)
		}
		if len(rec) < 5 {
			continue
		}

		date, err := time.Parse("02/01/2006", strings.TrimSpace(rec[0]))
		if err != nil {
			return nil, fmt.Errorf("line %d: invalid date %q", line, rec[0])
		}
		amount, err := parseBRL(rec[3])
		if err != nil {
			return nil, fmt.Errorf("line %d: invalid amount %q", line, rec[3])
		}

		tx := ParsedTransaction{
			Date:          date,
			Establishment: strings.TrimSpace(rec[1]),
			Holder:        strings.TrimSpace(rec[2]),
			Amount:        amount,
		}

		if inst := strings.TrimSpace(rec[4]); inst != "" && inst != "-" {
			if m := installmentRe.FindStringSubmatch(inst); m != nil {
				n, _ := strconv.Atoi(m[1])
				t, _ := strconv.Atoi(m[2])
				tx.InstallmentNumber = &n
				tx.InstallmentTotal = &t
			}
		}

		txs = append(txs, tx)
	}
	return txs, nil
}

var invoiceNameRe = regexp.MustCompile(`(?i)Fatura(\d{4})-(\d{2})-(\d{2})`)

// ReferenceDateFromFilename extracts e.g. 2024-09-10 from Fatura2024-09-10.csv.
func ReferenceDateFromFilename(name string) *time.Time {
	m := invoiceNameRe.FindStringSubmatch(name)
	if m == nil {
		return nil
	}
	t, err := time.Parse("2006-01-02", m[1]+"-"+m[2]+"-"+m[3])
	if err != nil {
		return nil
	}
	return &t
}

// ParseNubankCSV parses a Nubank credit card statement export:
// data;descricao;valor (semicolon separated, yyyy-mm-dd, BRL values with
// decimal point). Negative amounts are purchases; positive are payments.
func ParseNubankCSV(r io.Reader) ([]ParsedTransaction, error) {
	cr := csv.NewReader(r)
	cr.Comma = ';'
	cr.LazyQuotes = true
	cr.TrimLeadingSpace = true

	header, err := cr.Read()
	if err != nil {
		return nil, fmt.Errorf("read header: %w", err)
	}
	if len(header) < 3 {
		return nil, fmt.Errorf("unexpected header: %v", header)
	}

	var txs []ParsedTransaction
	for {
		rec, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if len(rec) < 3 {
			continue
		}
		date, err := time.Parse("2006-01-02", strings.TrimSpace(rec[0]))
		if err != nil {
			continue
		}
		v, err := strconv.ParseFloat(strings.TrimSpace(rec[2]), 64)
		if err != nil {
			continue
		}
		est := strings.TrimSpace(rec[1])
		for _, p := range []string{"Pagamento em ", "Compra no débito ", "Compra no crédito ", "Compra internacional - ", "Compra recorrente - "} {
			est = strings.TrimPrefix(est, p)
		}
		amount := -v // purchases negative -> positive expense; payments positive -> negative
		txs = append(txs, ParsedTransaction{Date: date, Establishment: est, Amount: amount})
	}
	return txs, nil
}

// MappedColumnMap describes how to map arbitrary CSV columns onto transactions.
type MappedColumnMap struct {
	Delimiter       string `json:"delimiter"`
	Date            int    `json:"date"`
	DateFormat      string `json:"date_format"` // e.g. 2006-01-02 or 02/01/2006
	Establishment   int    `json:"establishment"`
	Amount          int    `json:"amount"`
	Holder          int    `json:"holder"`
	Installment     int    `json:"installment"` // -1 = absent
	Time            int    `json:"time"`        // -1 = absent
	DecimalComma    bool   `json:"decimal_comma"`
	ExpensePositive bool   `json:"expense_positive"` // true: positive values are expenses
}

// ParseMappedCSV parses a CSV using a user-supplied column mapping (JSON).
func ParseMappedCSV(r io.Reader, mappingJSON string) ([]ParsedTransaction, error) {
	var m MappedColumnMap
	if err := json.Unmarshal([]byte(mappingJSON), &m); err != nil {
		return nil, fmt.Errorf("invalid column_map: %w", err)
	}
	if m.Delimiter == "" {
		m.Delimiter = ","
	}
	if m.DateFormat == "" {
		m.DateFormat = "2006-01-02"
	}
	cr := csv.NewReader(r)
	cr.Comma = rune(m.Delimiter[0])
	cr.LazyQuotes = true
	cr.TrimLeadingSpace = true

	var txs []ParsedTransaction
	for {
		rec, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if len(rec) <= maxCol(m) {
			continue
		}
		date, err := time.Parse(m.DateFormat, strings.TrimSpace(rec[m.Date]))
		if err != nil {
			continue
		}
		var amount float64
		if m.DecimalComma {
			amount, err = parseBRL(rec[m.Amount])
		} else {
			amount, err = strconv.ParseFloat(strings.TrimSpace(rec[m.Amount]), 64)
		}
		if err != nil {
			continue
		}
		if !m.ExpensePositive {
			amount = -amount
		}
		tx := ParsedTransaction{Date: date, Establishment: strings.TrimSpace(rec[m.Establishment]), Amount: amount}
		if m.Holder >= 0 && m.Holder < len(rec) {
			tx.Holder = strings.TrimSpace(rec[m.Holder])
		}
		if m.Installment >= 0 && m.Installment < len(rec) {
			if mm := installmentRe.FindStringSubmatch(strings.TrimSpace(rec[m.Installment])); mm != nil {
				n, _ := strconv.Atoi(mm[1])
				t, _ := strconv.Atoi(mm[2])
				tx.InstallmentNumber = &n
				tx.InstallmentTotal = &t
			}
		}
		if m.Time >= 0 && m.Time < len(rec) {
			if tt, err := time.Parse("15:04", strings.TrimSpace(rec[m.Time])); err == nil {
				tx.Time = &tt
			}
		}
		txs = append(txs, tx)
	}
	return txs, nil
}

func maxCol(m MappedColumnMap) int {
	max := m.Date
	for _, c := range []int{m.Establishment, m.Amount, m.Holder, m.Installment, m.Time} {
		if c > max {
			max = c
		}
	}
	return max
}
