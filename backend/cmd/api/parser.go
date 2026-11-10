package main

import (
	"bufio"
	"encoding/csv"
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
