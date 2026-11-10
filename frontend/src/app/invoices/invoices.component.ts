import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin } from 'rxjs';

import {
  ApiService, CategorySpend, InstallmentItem, Invoice, InvoiceTotal,
  Transaction,
} from '../api.service';

interface InvoiceRow {
  invoice: Invoice;
  total: InvoiceTotal | null;
  variation: number | null; // % vs previous invoice
  urgency: 'overdue' | 'due' | 'future' | 'paid' | 'none';
}

const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

@Component({
  selector: 'app-invoices',
  standalone: true,
  imports: [CommonModule],
  template: `
    <h1 class="page-title">Invoices</h1>
    <p class="page-sub">Credit card statements, payment status, and running installments</p>

    <div class="cards" *ngIf="openTotal !== null || overdueCount">
      <div class="stat red" *ngIf="overdueCount">
        <div class="label">Overdue invoices</div>
        <div class="value">{{ overdueCount }}</div>
      </div>
      <div class="stat">
        <div class="label">Open total</div>
        <div class="value">{{ openTotal ?? 0 | currency:'BRL':'symbol':'1.2-2':'pt-BR' }}</div>
        <div class="hint">unpaid invoices</div>
      </div>
      <div class="stat purple" *ngIf="nextDue">
        <div class="label">Next due</div>
        <div class="value" style="font-size: 1.05rem">{{ nextDue.invoice.reference_date | date:'dd MMM yyyy':'':'pt-BR' }}</div>
        <div class="hint">{{ nextDue.total?.expenses | currency:'BRL':'symbol':'1.2-2':'pt-BR' }}</div>
      </div>
      <div class="stat green" *ngIf="paidTotal">
        <div class="label">Paid (total)</div>
        <div class="value">{{ paidTotal | currency:'BRL':'symbol':'1.2-2':'pt-BR' }}</div>
      </div>
    </div>

    <div class="card">
      <h3>Statements</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th></th><th>Reference</th><th>Name</th><th class="num">Total</th><th class="num">Δ vs prev</th>
              <th class="num">Tx</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            <ng-container *ngFor="let row of rows">
              <tr>
                <td>
                  <button class="ghost expand" (click)="toggle(row)">{{ expanded.has(row.invoice.id) ? '▾' : '▸' }}</button>
                </td>
                <td>{{ monthLabel(row.invoice.reference_date) }}</td>
                <td class="muted">{{ row.invoice.name }}</td>
                <td class="num">{{ row.total?.expenses | currency:'BRL':'symbol':'1.2-2':'pt-BR' }}</td>
                <td class="num">
                  <span *ngIf="row.variation !== null"
                    [class.positive]="row.variation <= 0" [class.negative]="row.variation > 0">
                    {{ row.variation > 0 ? '+' : '' }}{{ row.variation | number:'1.0-1' }}%
                  </span>
                  <span class="muted" *ngIf="row.variation === null">—</span>
                </td>
                <td class="num">{{ row.invoice.transactions }}</td>
                <td>
                  <span class="pill" [class.payment]="row.invoice.paid" [class.expense]="!row.invoice.paid"
                    [class.neutral]="urgencyClass(row) === 'due' && !row.invoice.paid">
                    {{ statusLabel(row) }}
                  </span>
                </td>
                <td>
                  <button class="ghost" (click)="setPaid(row, !row.invoice.paid)">
                    {{ row.invoice.paid ? 'Mark unpaid' : 'Mark paid' }}
                  </button>
                </td>
              </tr>
              <tr class="detail-row" *ngIf="expanded.has(row.invoice.id)">
                <td colspan="8">
                  <div class="grid-2" *ngIf="detail[row.invoice.id] as d">
                    <div>
                      <h4 class="muted">Transactions</h4>
                      <div class="table-wrap detail-table">
                        <table>
                          <thead>
                            <tr><th>Date</th><th>Establishment</th><th>Category</th><th class="num">Installment</th><th class="num">Amount</th></tr>
                          </thead>
                          <tbody>
                            <tr *ngFor="let t of d.transactions">
                              <td>{{ t.date | date:'dd/MM/yy' }}</td>
                              <td>{{ t.establishment }}</td>
                              <td>
                                <span class="pill cat" *ngIf="t.category_name" [style.color]="t.category_color" [style.background]="(t.category_color || '') + '22'">{{ t.category_name }}</span>
                                <span class="muted" *ngIf="!t.category_name">—</span>
                              </td>
                              <td class="num muted" *ngIf="t.installment_number">{{ t.installment_number }}/{{ t.installment_total }}</td>
                              <td class="num muted" *ngIf="!t.installment_number">—</td>
                              <td class="num" [class.negative]="t.amount > 0" [class.positive]="t.amount < 0">
                                {{ t.amount | currency:'BRL':'symbol':'1.2-2':'pt-BR' }}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <div>
                      <h4 class="muted">By category</h4>
                      <div *ngFor="let c of d.categories" class="budget-row">
                        <div class="budget-head">
                          <span><span class="dot" [style.background]="c.color"></span>{{ c.category }}</span>
                          <span class="muted">{{ c.total | currency:'BRL':'symbol':'1.2-2':'pt-BR' }} · {{ pctOf(c, row) | number:'1.0-0' }}%</span>
                        </div>
                        <div class="progress">
                          <div [style.width]="pctOf(c, row) + '%'" [style.background]="c.color"></div>
                        </div>
                      </div>
                      <p class="muted" *ngIf="!d.categories.length">No categorized expenses.</p>
                    </div>
                  </div>
                  <p class="muted" *ngIf="!detail[row.invoice.id]">Loading…</p>
                </td>
              </tr>
            </ng-container>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card" *ngIf="installments.length">
      <h3>Running installments <span class="muted" style="font-weight: 400; font-size: 0.8rem">(not fully paid)</span></h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Establishment</th><th>Category</th><th class="num">Installment</th><th class="num">Monthly</th><th class="num">Remaining</th><th class="num">Total committed</th><th style="width: 140px">Progress</th></tr>
          </thead>
          <tbody>
            <tr *ngFor="let i of installments">
              <td>{{ i.establishment }}</td>
              <td>
                <span class="pill cat" *ngIf="i.category" [style.color]="i.color" [style.background]="(i.color || '') + '22'">{{ i.category }}</span>
                <span class="muted" *ngIf="!i.category">—</span>
              </td>
              <td class="num">{{ i.current }}/{{ i.installment_total }}</td>
              <td class="num">{{ i.monthly_amount | currency:'BRL':'symbol':'1.2-2':'pt-BR' }}</td>
              <td class="num muted">{{ i.remaining }}x</td>
              <td class="num">{{ i.total_committed | currency:'BRL':'symbol':'1.2-2':'pt-BR' }}</td>
              <td>
                <div class="progress">
                  <div [style.width]="(i.current / i.installment_total) * 100 + '%'"></div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [`
    button.ghost.expand { padding: 0.1rem 0.5rem; min-width: 0; }
    .detail-row > td { padding: 0.75rem 1rem 1.25rem; background: rgba(91,140,255,0.03); }
    .detail-row h4 { margin: 0 0 0.75rem; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; }
    .detail-table { max-height: 380px; overflow-y: auto; }
  `],
})
export class InvoicesComponent implements OnInit {
  private api = inject(ApiService);

  rows: InvoiceRow[] = [];
  installments: InstallmentItem[] = [];
  expanded = new Set<number>();
  detail: Record<number, { transactions: Transaction[]; categories: CategorySpend[] }> = {};
  openTotal: number | null = null;
  paidTotal = 0;
  overdueCount = 0;
  nextDue: InvoiceRow | null = null;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    forkJoin({
      invoices: this.api.invoices(),
      totals: this.api.invoiceTotals({}),
      installments: this.api.installments({}),
    }).subscribe(({ invoices, totals, installments }) => {
      const byId = new Map(totals.map((t) => [t.import_id, t]));
      const withRef = invoices
        .filter((i) => i.reference_date)
        .sort((a, b) => (a.reference_date! < b.reference_date! ? -1 : 1));
      this.rows = invoices.map((invoice) => {
        const idx = withRef.findIndex((i) => i.id === invoice.id);
        const prev = idx > 0 ? withRef[idx - 1] : null;
        const prevTotal = prev ? byId.get(prev.id) : null;
        const total = byId.get(invoice.id) ?? null;
        const variation = total && prevTotal && prevTotal.expenses > 0
          ? ((total.expenses - prevTotal.expenses) / prevTotal.expenses) * 100
          : null;
        return { invoice, total, variation, urgency: this.urgency(invoice) };
      });
      this.installments = installments;
      this.openTotal = totals.filter((t) => !t.paid).reduce((acc, t) => acc + t.expenses, 0);
      this.paidTotal = totals.filter((t) => t.paid).reduce((acc, t) => acc + t.expenses, 0);
      this.overdueCount = this.rows.filter((r) => r.urgency === 'overdue').length;
      this.nextDue = this.rows.find((r) => r.urgency === 'overdue' || r.urgency === 'due') ?? null;
    });
  }

  monthLabel(ref?: string): string {
    if (!ref) return '—';
    const [y, m] = ref.split('-').map(Number);
    return `${MONTHS_PT[m - 1]}/${y}`;
  }

  urgency(invoice: Invoice): InvoiceRow['urgency'] {
    if (invoice.paid) return 'paid';
    if (!invoice.reference_date) return 'none';
    const today = new Date();
    const ref = new Date(invoice.reference_date + 'T00:00:00');
    if (ref < today) return 'overdue';
    if (ref.getFullYear() === today.getFullYear() && ref.getMonth() === today.getMonth()) return 'due';
    return 'future';
  }

  urgencyClass(row: InvoiceRow): string {
    return row.urgency;
  }

  statusLabel(row: InvoiceRow): string {
    if (row.invoice.paid) return 'Paid';
    if (row.urgency === 'overdue') return 'Overdue';
    if (row.urgency === 'due') return 'Due';
    if (row.urgency === 'future') return 'Open';
    return 'Unpaid';
  }

  pctOf(c: CategorySpend, row: InvoiceRow): number {
    const base = row.total?.expenses ?? 0;
    return base > 0 ? Math.min(100, (c.total / base) * 100) : 0;
  }

  setPaid(row: InvoiceRow, paid: boolean): void {
    this.api.setInvoicePaid(row.invoice.id, paid).subscribe(() => {
      row.invoice.paid = paid;
      if (paid) {
        row.invoice.paid_at = new Date().toISOString().slice(0, 10);
      } else {
        delete row.invoice.paid_at;
      }
      row.urgency = this.urgency(row.invoice);
      this.overdueCount = this.rows.filter((r) => r.urgency === 'overdue').length;
      this.nextDue = this.rows.find((r) => r.urgency === 'overdue' || r.urgency === 'due') ?? null;
      this.openTotal = this.rows.reduce((acc, r) => acc + (r.invoice.paid ? 0 : (r.total?.expenses ?? 0)), 0);
      this.paidTotal = this.rows.reduce((acc, r) => acc + (r.invoice.paid ? (r.total?.expenses ?? 0) : 0), 0);
    });
  }

  toggle(row: InvoiceRow): void {
    const id = row.invoice.id;
    if (this.expanded.has(id)) {
      this.expanded.delete(id);
      return;
    }
    this.expanded.add(id);
    if (this.detail[id]) return;
    forkJoin({
      transactions: this.api.transactions({ import_id: id }, 500, 0),
      categories: this.api.byCategory({ import_id: id }),
    }).subscribe(({ transactions, categories }) => {
      this.detail = { ...this.detail, [id]: { transactions: transactions.items, categories } };
    });
  }
}
