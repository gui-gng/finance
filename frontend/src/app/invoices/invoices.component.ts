import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';

import {
  ApiService, CategorySpend, InstallmentItem, Invoice, InvoicePayment, InvoiceTotal, Transaction,
} from '../api.service';
import { SettingsService } from '../services/settings.service';
import { ToastService } from '../services/toast.service';

interface InvoiceRow {
  invoice: Invoice;
  total: InvoiceTotal | null;
  variation: number | null;
  urgency: 'overdue' | 'due' | 'future' | 'paid' | 'none';
}

interface CalendarDay {
  date: number;
  other: boolean;
  iso: string;
  events: { label: string; cls: string }[];
}

const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const WEEKDAYS_PT = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

@Component({
  selector: 'app-invoices',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <h1 class="page-title">Invoices</h1>
    <p class="page-sub">Credit card statements, payment status, and running installments</p>

    <div class="banner" *ngIf="reminders.length">
      ⏰ <span *ngFor="let r of reminders; let last = last">{{ r }}{{ last ? '' : ' · ' }}</span>
    </div>

    <div class="cards" *ngIf="openTotal !== null || overdueCount">
      <div class="stat red" *ngIf="overdueCount">
        <div class="label">Overdue invoices</div>
        <div class="value">{{ overdueCount }}</div>
        <div class="hint">{{ fmt(overdueTotal) }} past due</div>
      </div>
      <div class="stat">
        <div class="label">Open total</div>
        <div class="value">{{ fmt(openTotal ?? 0) }}</div>
        <div class="hint">{{ openCount }} unpaid</div>
      </div>
      <div class="stat purple" *ngIf="nextDue">
        <div class="label">Next due</div>
        <div class="value" style="font-size: 1.05rem">{{ nextDue.invoice.reference_date | date:'dd MMM yyyy':'':'pt-BR' }}</div>
        <div class="hint">{{ fmt(nextDue.total?.expenses ?? 0) }}</div>
      </div>
      <div class="stat green" *ngIf="paidTotal">
        <div class="label">Paid (total)</div>
        <div class="value">{{ fmt(paidTotal) }}</div>
      </div>
      <div class="stat" [class.red]="utilization > 30" *ngIf="combinedLimit">
        <div class="label">Combined utilization</div>
        <div class="value">{{ utilization | number:'1.0-0' }}%</div>
        <div class="hint">{{ fmt(openTotal ?? 0) }} of {{ fmt(combinedLimit) }} limit</div>
      </div>
    </div>

    <div class="card" *ngIf="holders.length > 1">
      <h3>Card comparison</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Holder</th><th class="num">Limit</th><th class="num">Open invoices</th><th class="num">Utilization</th></tr></thead>
          <tbody>
            <tr *ngFor="let h of holders">
              <td>{{ h }}</td>
              <td class="num">{{ limits[h] ? fmt(limits[h]) : '—' }}</td>
              <td class="num">{{ fmt(holderOpen[h] ?? 0) }}</td>
              <td class="num" [class.negative]="holderUtil(h) > 30">{{ limits[h] ? (holderUtil(h) | number:'1.0-0') + '%' : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style="display: flex; gap: 0.5rem; margin-top: 0.75rem; align-items: center; flex-wrap: wrap">
        <span class="muted" style="font-size: 0.82rem">Set limit:</span>
        <select [(ngModel)]="limitHolder"><option *ngFor="let h of holders" [value]="h">{{ h }}</option></select>
        <input type="number" [(ngModel)]="limitAmount" placeholder="Limit" style="min-width: 110px">
        <button class="ghost" (click)="saveLimit()">Save</button>
      </div>
    </div>

    <div class="card">
      <h3>
        Statements
        <span style="float: right; display: flex; gap: 0.4rem; align-items: center">
          <button class="chip" [class.active]="view === 'list'" (click)="view = 'list'">List</button>
          <button class="chip" [class.active]="view === 'calendar'" (click)="view = 'calendar'; buildCalendar()">Calendar</button>
          <button class="chip" [class.active]="order === 'urgency'" (click)="toggleOrder()" title="payment sequencing">Urgency order</button>
        </span>
      </h3>

      <ng-container *ngIf="view === 'calendar'">
        <input type="month" class="month-input" [(ngModel)]="calendarMonth" (ngModelChange)="buildCalendar()">
        <div class="calendar-grid">
          <div class="muted" style="text-align: center; font-size: 0.72rem" *ngFor="let d of weekdayLabels">{{ d }}</div>
          <div class="calendar-cell" *ngFor="let c of calendar" [class.other]="c.other">
            <div class="day">{{ c.date }}</div>
            <div class="calendar-event" *ngFor="let e of c.events" [class.paid]="e.cls === 'paid'" [class.overdue]="e.cls === 'overdue'">{{ e.label }}</div>
          </div>
        </div>
      </ng-container>

      <div class="table-wrap" *ngIf="view === 'list'">
        <table>
          <thead>
            <tr>
              <th></th><th>Reference</th><th class="num">Total</th><th class="num">Min. due</th><th class="num">Paid so far</th>
              <th class="num">Δ vs prev</th><th class="num">Tx</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            <ng-container *ngFor="let row of rows">
              <tr>
                <td><button class="ghost expand" (click)="toggle(row)">{{ expanded.has(row.invoice.id) ? '▾' : '▸' }}</button></td>
                <td>{{ monthLabel(row.invoice.reference_date) }}</td>
                <td class="num">{{ fmt(row.total?.expenses ?? 0) }}</td>
                <td class="num muted" *ngIf="row.invoice.min_payment">{{ fmt(row.invoice.min_payment) }}</td>
                <td class="num muted" *ngIf="!row.invoice.min_payment"><a style="cursor: pointer" (click)="editMin(row)">set</a></td>
                <td class="num">
                  <span *ngIf="paidSoFar(row) > 0" class="positive">{{ fmt(paidSoFar(row)) }}</span>
                  <a style="cursor: pointer; font-size: 0.75rem" (click)="addPayment(row)">+ pay</a>
                </td>
                <td class="num">
                  <span *ngIf="row.variation !== null" [class.positive]="row.variation <= 0" [class.negative]="row.variation > 0">
                    {{ row.variation > 0 ? '+' : '' }}{{ row.variation | number:'1.0-1' }}%
                  </span>
                  <span class="muted" *ngIf="row.variation === null">—</span>
                </td>
                <td class="num">{{ row.invoice.transactions }} <span class="muted" style="font-size: 0.68rem" [title]="'imported ' + row.invoice.imported_at + ' · inserted ' + row.invoice.inserted_count + ' · skipped ' + row.invoice.skipped_count">ⓘ</span></td>
                <td>
                  <span class="pill" [class.payment]="row.invoice.paid" [class.expense]="!row.invoice.paid" [class.neutral]="row.urgency === 'due' && !row.invoice.paid">
                    {{ statusLabel(row) }}
                  </span>
                </td>
                <td class="actions">
                  <button class="ghost" (click)="setPaid(row, !row.invoice.paid)">{{ row.invoice.paid ? 'Mark unpaid' : 'Mark paid' }}</button>
                  <button class="ghost" (click)="editNote(row)" title="note">📝</button>
                  <button class="ghost danger" (click)="remove(row)" title="undo import">🗑</button>
                </td>
              </tr>
              <tr class="detail-row" *ngIf="expanded.has(row.invoice.id)">
                <td colspan="9">
                  <p class="muted" *ngIf="row.invoice.note" style="margin: 0 0 0.75rem">📝 {{ row.invoice.note }}</p>
                  <p class="muted" *ngIf="payments[row.invoice.id]?.length" style="margin: 0 0 0.75rem">
                    Payments:
                    <span *ngFor="let p of payments[row.invoice.id]">{{ fmt(p.amount) }} ({{ p.paid_at | date:'dd/MM/yy' }})
                      <a style="cursor: pointer" (click)="removePayment(row, p)">✕</a> · </span>
                  </p>
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
                              <td class="num" [class.negative]="t.amount > 0" [class.positive]="t.amount < 0">{{ fmt(t.amount) }}</td>
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
                          <span class="muted">{{ fmt(c.total) }} · {{ pctOf(c, row) | number:'1.0-0' }}%</span>
                        </div>
                        <div class="progress"><div [style.width]="pctOf(c, row) + '%'" [style.background]="c.color"></div></div>
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
              <td class="num">{{ fmt(i.monthly_amount) }}</td>
              <td class="num muted">{{ i.remaining }}x</td>
              <td class="num">{{ fmt(i.total_committed) }}</td>
              <td><div class="progress"><div [style.width]="(i.current / i.installment_total) * 100 + '%'"></div></div></td>
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
    .actions { white-space: nowrap; }
    .actions button { padding: 0.2rem 0.5rem; font-size: 0.78rem; }
    .month-input { float: right; padding: 0.2rem 0.4rem; min-width: 0; font-size: 0.8rem; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; color: var(--text); color-scheme: dark; }
    .banner { background: var(--accent-soft); border: 1px solid var(--accent); color: var(--accent); border-radius: 10px; padding: 0.6rem 1rem; margin-bottom: 1.25rem; font-size: 0.9rem; }
  `],
})
export class InvoicesComponent implements OnInit {
  private api = inject(ApiService);
  private settings = inject(SettingsService);
  private toasts = inject(ToastService);

  rows: InvoiceRow[] = [];
  installments: InstallmentItem[] = [];
  expanded = new Set<number>();
  detail: Record<number, { transactions: Transaction[]; categories: CategorySpend[] }> = {};
  payments: Record<number, InvoicePayment[]> = {};
  limits: Record<string, number> = {};
  holders: string[] = [];
  openTotal: number | null = null;
  paidTotal = 0;
  openCount = 0;
  overdueCount = 0;
  overdueTotal = 0;
  nextDue: InvoiceRow | null = null;
  reminders: string[] = [];
  view: 'list' | 'calendar' = 'list';
  order: 'date' | 'urgency' = 'date';
  calendarMonth = new Date().toISOString().slice(0, 7);
  calendar: CalendarDay[] = [];
  weekdayLabels = WEEKDAYS_PT;
  limitHolder = '';
  limitAmount = 0;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    forkJoin({
      invoices: this.api.invoices(),
      totals: this.api.invoiceTotals({}),
      installments: this.api.installments({}),
      limits: this.api.cardLimits(),
      holders: this.api.holders(),
    }).subscribe(({ invoices, totals, installments, limits, holders }) => {
      this.limits = limits;
      this.holders = holders;
      this.limitHolder = holders[0] ?? '';
      const byId = new Map(totals.map((t) => [t.import_id, t]));
      const withRef = invoices.filter((i) => i.reference_date).sort((a, b) => (a.reference_date! < b.reference_date! ? -1 : 1));
      this.rows = invoices.map((invoice) => {
        const idx = withRef.findIndex((i) => i.id === invoice.id);
        const prev = idx > 0 ? withRef[idx - 1] : null;
        const prevTotal = prev ? byId.get(prev.id) : null;
        const total = byId.get(invoice.id) ?? null;
        const variation = total && prevTotal && prevTotal.expenses > 0
          ? ((total.expenses - prevTotal.expenses) / prevTotal.expenses) * 100 : null;
        return { invoice, total, variation, urgency: this.urgency(invoice) };
      });
      this.installments = installments;
      this.openTotal = totals.filter((t) => !t.paid).reduce((acc, t) => acc + t.expenses, 0);
      this.paidTotal = totals.filter((t) => t.paid).reduce((acc, t) => acc + t.expenses, 0);
      this.openCount = totals.filter((t) => !t.paid).length;
      this.overdueCount = this.rows.filter((r) => r.urgency === 'overdue').length;
      this.overdueTotal = this.rows.filter((r) => r.urgency === 'overdue').reduce((a, r) => a + (r.total?.expenses ?? 0), 0);
      this.nextDue = this.rows.find((r) => r.urgency === 'overdue' || r.urgency === 'due') ?? null;
      this.computeReminders();
      if (this.view === 'calendar') this.buildCalendar();
    });
  }

  get combinedLimit(): number {
    return Object.values(this.limits).reduce((a, b) => a + b, 0);
  }

  get utilization(): number {
    return this.combinedLimit ? ((this.openTotal ?? 0) / this.combinedLimit) * 100 : 0;
  }

  get holderOpen(): Record<string, number> {
    const map: Record<string, number> = {};
    for (const i of this.installments) map[i.holder] = (map[i.holder] ?? 0) + i.monthly_amount;
    return map;
  }

  holderUtil(holder: string): number {
    return this.limits[holder] ? ((this.holderOpen[holder] ?? 0) / this.limits[holder]) * 100 : 0;
  }

  saveLimit(): void {
    this.api.setCardLimit(this.limitHolder, this.limitAmount).subscribe(() => {
      this.toasts.show(`Limit saved for ${this.limitHolder}`);
      this.api.cardLimits().subscribe((l) => (this.limits = l));
    });
  }

  computeReminders(): void {
    const days = this.settings.s.reminderDays;
    const today = new Date();
    this.reminders = this.rows
      .filter((r) => !r.invoice.paid && r.invoice.reference_date)
      .map((r) => {
        const ref = new Date(r.invoice.reference_date! + 'T00:00:00');
        const diff = Math.round((ref.getTime() - today.getTime()) / 86400000);
        if (diff < 0) return `${r.invoice.name} is overdue (${Math.abs(diff)}d)`;
        if (diff <= days) return `${r.invoice.name} due in ${diff}d`;
        return '';
      })
      .filter(Boolean);
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

  paidSoFar(row: InvoiceRow): number {
    return (this.payments[row.invoice.id] ?? []).reduce((a, p) => a + p.amount, 0);
  }

  setPaid(row: InvoiceRow, paid: boolean): void {
    this.api.setInvoicePaid(row.invoice.id, paid).subscribe(() => {
      row.invoice.paid = paid;
      row.urgency = this.urgency(row.invoice);
      this.load();
    });
  }

  addPayment(row: InvoiceRow): void {
    const amount = Number(prompt(`Payment amount for ${row.invoice.name}?`));
    if (!amount) return;
    this.api.addInvoicePayment(row.invoice.id, amount).subscribe(() => {
      this.toasts.show('Payment recorded');
      this.api.invoicePayments(row.invoice.id).subscribe((p) => (this.payments = { ...this.payments, [row.invoice.id]: p }));
    });
  }

  removePayment(row: InvoiceRow, p: InvoicePayment): void {
    this.api.deleteInvoicePayment(row.invoice.id, p.id).subscribe(() => {
      this.payments = { ...this.payments, [row.invoice.id]: this.payments[row.invoice.id].filter((x) => x.id !== p.id) };
    });
  }

  editNote(row: InvoiceRow): void {
    const note = prompt('Invoice note', row.invoice.note ?? '');
    if (note === null) return;
    this.api.updateInvoice(row.invoice.id, { note }).subscribe(() => {
      row.invoice.note = note;
      this.toasts.show('Note saved');
    });
  }

  editMin(row: InvoiceRow): void {
    const v = Number(prompt('Minimum payment due', String(row.invoice.min_payment ?? '')));
    if (!v) return;
    this.api.updateInvoice(row.invoice.id, { min_payment: v }).subscribe(() => {
      row.invoice.min_payment = v;
      this.toasts.show('Minimum payment saved');
    });
  }

  remove(row: InvoiceRow): void {
    if (!confirm(`Undo import "${row.invoice.filename}"? This deletes its ${row.invoice.transactions} transactions.`)) return;
    this.api.deleteInvoice(row.invoice.id).subscribe(() => {
      this.toasts.show('Import undone');
      this.load();
    });
  }

  toggleOrder(): void {
    this.order = this.order === 'date' ? 'urgency' : 'date';
    const rank = { overdue: 0, due: 1, future: 2, none: 3, paid: 4 } as const;
    this.rows = [...this.rows].sort((a, b) => {
      if (this.order === 'urgency') {
        return rank[a.urgency] - rank[b.urgency] || (b.total?.expenses ?? 0) - (a.total?.expenses ?? 0);
      }
      return (b.invoice.reference_date ?? '').localeCompare(a.invoice.reference_date ?? '');
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
      payments: this.api.invoicePayments(id),
    }).subscribe(({ transactions, categories, payments }) => {
      this.detail = { ...this.detail, [id]: { transactions: transactions.items, categories } };
      this.payments = { ...this.payments, [id]: payments };
    });
  }

  buildCalendar(): void {
    forkJoin({ invoices: this.api.invoices(), totals: this.api.invoiceTotals({}) }).subscribe(({ invoices, totals }) => {
      const [y, m] = this.calendarMonth.split('-').map(Number);
      const first = new Date(y, m - 1, 1);
      const start = new Date(first);
      start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
      const byId = new Map(totals.map((t) => [t.import_id, t]));
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const cells: CalendarDay[] = [];
      for (let i = 0; i < 42; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const events: CalendarDay['events'] = [];
        for (const inv of invoices) {
          if (!inv.reference_date || !inv.reference_date.startsWith(iso)) continue;
          const total = byId.get(inv.id);
          const overdue = !inv.paid && new Date(inv.reference_date + 'T00:00:00') < today;
          events.push({ label: `Fatura ${this.fmt(total?.expenses ?? 0)}`, cls: inv.paid ? 'paid' : overdue ? 'overdue' : '' });
        }
        cells.push({ date: d.getDate(), iso, other: d.getMonth() !== m - 1, events });
      }
      this.calendar = cells;
    });
  }

  fmt(v: number): string {
    return this.settings.fmt(v);
  }
}
