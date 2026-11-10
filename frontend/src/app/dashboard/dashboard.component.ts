import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';
import { forkJoin } from 'rxjs';

import {
  ApiService, BudgetStatus, CategorySpend, EstablishmentTotal, Filters, HolderTotal,
  Invoice, InvoiceTotal, MonthlyPoint, RecurringItem, Summary, WeekdayPoint,
} from '../api.service';
import { FiltersComponent } from '../filters/filters.component';

const WEEKDAYS_PT = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
const LAYOUT_KEY = 'dashboard-layout';

interface WidgetDef { id: string; label: string; }

const DEFAULT_WIDGETS: WidgetDef[] = [
  { id: 'stats', label: 'Key figures' },
  { id: 'invoiceStatus', label: 'Invoice status' },
  { id: 'budgets', label: 'Budgets' },
  { id: 'monthly', label: 'Monthly flow' },
  { id: 'categories', label: 'Spending by category' },
  { id: 'holders', label: 'Expenses by holder' },
  { id: 'invoices', label: 'Invoice totals' },
  { id: 'weekdays', label: 'Expenses by weekday' },
  { id: 'top', label: 'Top establishments' },
  { id: 'recurring', label: 'Recurring expenses' },
];

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, BaseChartDirective, FiltersComponent],
  template: `
    <div class="dash-head">
      <div>
        <h1 class="page-title">Dashboard</h1>
        <p class="page-sub">Overview of your imported financial data</p>
      </div>
      <button class="ghost" (click)="customizing = !customizing">Customize</button>
    </div>

    <div class="card customize" *ngIf="customizing">
      <h3>Customize dashboard</h3>
      <div class="widget-list">
        <div class="widget-item" *ngFor="let w of widgets; let i = index">
          <label class="widget-check">
            <input type="checkbox" [checked]="!hidden.has(w.id)" (change)="toggleWidget(w.id)">
            {{ w.label }}
          </label>
          <span class="widget-move">
            <button class="ghost" (click)="move(i, -1)" [disabled]="i === 0" title="Move up">↑</button>
            <button class="ghost" (click)="move(i, 1)" [disabled]="i === widgets.length - 1" title="Move down">↓</button>
          </span>
        </div>
      </div>
    </div>

    <app-filters (changed)="load($event)" />

    <div class="dash-grid">
      <div class="widget span-2" *ngIf="visible('stats') && summary" [style.order]="orderOf('stats')">
        <div class="cards">
          <div class="stat red">
            <div class="label">Total expenses</div>
            <div class="value">{{ summary.total_expenses | currency:'BRL':'symbol':'1.2-2':'pt-BR' }}</div>
            <div class="hint" *ngIf="avgMonthly">avg {{ avgMonthly | currency:'BRL':'symbol':'1.2-2':'pt-BR' }}/month</div>
          </div>
          <div class="stat green">
            <div class="label">Total payments</div>
            <div class="value">{{ summary.total_payments | currency:'BRL':'symbol':'1.2-2':'pt-BR' }}</div>
          </div>
          <div class="stat">
            <div class="label">Net balance</div>
            <div class="value" [class.positive]="summary.net >= 0" [class.negative]="summary.net < 0">
              {{ summary.net | currency:'BRL':'symbol':'1.2-2':'pt-BR' }}
            </div>
          </div>
          <div class="stat purple">
            <div class="label">Last month</div>
            <div class="value">{{ lastMonthExpenses | currency:'BRL':'symbol':'1.2-2':'pt-BR' }}</div>
            <div class="hint" *ngIf="momChange !== null"
              [class.positive]="momChange <= 0" [class.negative]="momChange > 0">
              {{ momChange > 0 ? '+' : '' }}{{ momChange | number:'1.0-1' }}% vs previous month
            </div>
          </div>
          <div class="stat" *ngIf="topEstablishment">
            <div class="label">Top establishment</div>
            <div class="value" style="font-size: 1.05rem">{{ topEstablishment.establishment }}</div>
            <div class="hint">{{ topEstablishment.total | currency:'BRL':'symbol':'1.2-2':'pt-BR' }} · {{ topEstablishment.count }}x</div>
          </div>
        </div>
      </div>

      <div class="widget span-2" *ngIf="visible('invoiceStatus') && invoiceList.length" [style.order]="orderOf('invoiceStatus')">
        <div class="cards">
          <div class="stat" [class.red]="overdueCount > 0">
            <div class="label">Open invoices</div>
            <div class="value">{{ openInvoiceTotal | currency:'BRL':'symbol':'1.2-2':'pt-BR' }}</div>
            <div class="hint">{{ openInvoiceCount }} unpaid <a routerLink="/invoices" class="muted">manage →</a></div>
          </div>
          <div class="stat red" *ngIf="overdueCount">
            <div class="label">Overdue</div>
            <div class="value">{{ overdueCount }}</div>
            <div class="hint">{{ overdueTotal | currency:'BRL':'symbol':'1.2-2':'pt-BR' }} past due</div>
          </div>
          <div class="stat purple" *ngIf="nextDue">
            <div class="label">Next invoice due</div>
            <div class="value" style="font-size: 1.05rem">{{ nextDue | date:'dd MMM yyyy':'':'pt-BR' }}</div>
            <div class="hint">{{ nextDueTotal | currency:'BRL':'symbol':'1.2-2':'pt-BR' }}</div>
          </div>
        </div>
      </div>

      <div class="widget span-2" *ngIf="visible('budgets') && budgets.length" [style.order]="orderOf('budgets')">
        <div class="card">
          <h3>Budgets — {{ budgetMonthLabel }}
            <input type="month" class="budget-month" [(ngModel)]="budgetMonth" (ngModelChange)="loadBudgets()">
            <a routerLink="/categories" class="muted" style="float: right; font-size: 0.8rem; font-weight: 400">manage →</a>
          </h3>
          <div class="budget-row" *ngFor="let b of budgets">
            <div class="budget-head">
              <span><span class="dot" [style.background]="b.color"></span>{{ b.name }}</span>
              <span class="muted">
                {{ b.spent | currency:'BRL':'symbol':'1.2-2':'pt-BR' }} / {{ b.budget | currency:'BRL':'symbol':'1.2-2':'pt-BR' }}
              </span>
              <span class="budget-pct" [class.negative]="b.spent > b.budget">{{ pct(b) }}%</span>
            </div>
            <div class="progress">
              <div [style.width]="barWidth(b)" [style.background]="b.spent > b.budget ? 'var(--red)' : b.color"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="widget span-2" *ngIf="visible('monthly')" [style.order]="orderOf('monthly')">
        <div class="card">
          <h3>Monthly flow</h3>
          <div style="height: 300px">
            <canvas baseChart [data]="monthlyChartData" [options]="barOptions" type="bar"></canvas>
          </div>
        </div>
      </div>

      <div class="widget" *ngIf="visible('categories') && categoryChartData.labels?.length" [style.order]="orderOf('categories')">
        <div class="card">
          <h3>Spending by category</h3>
          <div style="height: 280px">
            <canvas baseChart [data]="categoryChartData" [options]="doughnutOptions" type="doughnut"></canvas>
          </div>
        </div>
      </div>

      <div class="widget" *ngIf="visible('holders') && holderChartData.labels?.length" [style.order]="orderOf('holders')">
        <div class="card">
          <h3>Expenses by holder</h3>
          <div style="height: 280px">
            <canvas baseChart [data]="holderChartData" [options]="doughnutOptions" type="doughnut"></canvas>
          </div>
        </div>
      </div>

      <div class="widget" *ngIf="visible('invoices') && invoiceChartData.labels?.length" [style.order]="orderOf('invoices')">
        <div class="card">
          <h3>Invoice totals (by statement) <a routerLink="/invoices" class="muted" style="float: right; font-size: 0.8rem; font-weight: 400">details →</a></h3>
          <div style="height: 260px">
            <canvas baseChart [data]="invoiceChartData" [options]="lineOptions" type="line"></canvas>
          </div>
        </div>
      </div>

      <div class="widget" *ngIf="visible('weekdays') && weekdayChartData.labels?.length" [style.order]="orderOf('weekdays')">
        <div class="card">
          <h3>Expenses by weekday</h3>
          <div style="height: 260px">
            <canvas baseChart [data]="weekdayChartData" [options]="barOptions" type="bar"></canvas>
          </div>
        </div>
      </div>

      <div class="widget" *ngIf="visible('top')" [style.order]="orderOf('top')">
        <div class="card">
          <h3>Top establishments</h3>
          <div style="height: 420px">
            <canvas baseChart [data]="topChartData" [options]="topChartOptions" type="bar"></canvas>
          </div>
        </div>
      </div>

      <div class="widget" *ngIf="visible('recurring') && recurringItems.length" [style.order]="orderOf('recurring')">
        <div class="card">
          <h3>Recurring expenses <span class="muted" style="font-weight: 400; font-size: 0.8rem">(in 3+ months)</span></h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Establishment</th><th>Category</th><th class="num">Months</th><th class="num">Avg</th><th class="num">Total</th></tr>
              </thead>
              <tbody>
                <tr *ngFor="let r of recurringItems">
                  <td>{{ r.establishment }}</td>
                  <td>
                    <span class="pill cat" *ngIf="r.category" [style.color]="r.color" [style.background]="r.color + '22'">{{ r.category }}</span>
                    <span class="muted" *ngIf="!r.category">—</span>
                  </td>
                  <td class="num">{{ r.months }}</td>
                  <td class="num">{{ r.avg_amount | currency:'BRL':'symbol':'1.2-2':'pt-BR' }}</td>
                  <td class="num">{{ r.total | currency:'BRL':'symbol':'1.2-2':'pt-BR' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .dash-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
    .dash-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
    .dash-grid > .widget { min-width: 0; }
    .dash-grid > .widget > .card, .dash-grid > .widget > .cards { margin-left: 0; margin-right: 0; }
    .span-2 { grid-column: 1 / -1; }
    .widget .card { height: calc(100% - 1.25rem); box-sizing: border-box; }
    .customize .widget-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.4rem 1.5rem; }
    .widget-item { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; font-size: 0.88rem; }
    .widget-check { display: flex; align-items: center; gap: 0.5rem; text-transform: none; letter-spacing: 0; color: var(--text); font-weight: 500; margin: 0; }
    .widget-check input { accent-color: var(--accent); }
    .widget-move { display: flex; gap: 0.25rem; }
    .widget-move button { padding: 0.1rem 0.5rem; min-width: 0; }
    .budget-month { float: right; margin-left: 0.75rem; padding: 0.2rem 0.4rem; min-width: 0; font-size: 0.8rem; }
    @media (max-width: 1000px) { .dash-grid { grid-template-columns: 1fr; } }
  `],
})
export class DashboardComponent {
  private api = inject(ApiService);

  summary: Summary | null = null;
  avgMonthly: number | null = null;
  lastMonthExpenses = 0;
  momChange: number | null = null;
  topEstablishment: EstablishmentTotal | null = null;
  budgets: BudgetStatus[] = [];
  recurringItems: RecurringItem[] = [];
  budgetMonth = new Date().toISOString().slice(0, 7);

  invoiceList: Invoice[] = [];
  openInvoiceTotal = 0;
  openInvoiceCount = 0;
  overdueCount = 0;
  overdueTotal = 0;
  nextDue: string | null = null;
  nextDueTotal = 0;

  customizing = false;
  widgets: WidgetDef[] = DEFAULT_WIDGETS.map((w) => ({ ...w }));
  hidden = new Set<string>();
  private lastFilters: Filters = {};

  barOptions: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { usePointStyle: true, boxWidth: 8 } } },
    scales: { y: { beginAtZero: true, grid: { color: 'rgba(148,163,184,0.08)' } }, x: { grid: { display: false } } },
  };

  lineOptions: ChartConfiguration<'line'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { usePointStyle: true, boxWidth: 8 } } },
    scales: { y: { beginAtZero: true, grid: { color: 'rgba(148,163,184,0.08)' } }, x: { grid: { display: false } } },
  };

  doughnutOptions: ChartConfiguration<'doughnut'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'right', labels: { usePointStyle: true, boxWidth: 8 } } },
  };

  topChartOptions: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: { x: { grid: { color: 'rgba(148,163,184,0.08)' } }, y: { grid: { display: false } } },
  };

  monthlyChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  invoiceChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  holderChartData: ChartConfiguration<'doughnut'>['data'] = { labels: [], datasets: [] };
  categoryChartData: ChartConfiguration<'doughnut'>['data'] = { labels: [], datasets: [] };
  weekdayChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  topChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };

  constructor() {
    this.restoreLayout();
  }

  get budgetMonthLabel(): string {
    const [y, m] = this.budgetMonth.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  }

  visible(id: string): boolean {
    return !this.hidden.has(id);
  }

  orderOf(id: string): number {
    return this.widgets.findIndex((w) => w.id === id);
  }

  toggleWidget(id: string): void {
    if (this.hidden.has(id)) {
      this.hidden.delete(id);
    } else {
      this.hidden.add(id);
    }
    this.saveLayout();
  }

  move(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= this.widgets.length) return;
    const copy = [...this.widgets];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    this.widgets = copy;
    this.saveLayout();
  }

  pct(b: BudgetStatus): number {
    return Math.round((b.spent / b.budget) * 100);
  }

  barWidth(b: BudgetStatus): string {
    return Math.min(100, this.pct(b)) + '%';
  }

  load(f: Filters): void {
    this.lastFilters = f;
    forkJoin({
      summary: this.api.summary(f),
      monthly: this.api.monthly(f),
      top: this.api.topEstablishments(f),
      holders: this.api.byHolder(f),
      weekdays: this.api.byWeekday(f),
      invoices: this.api.invoiceTotals(f),
      categories: this.api.byCategory(f),
      budgets: this.api.budgetStatus(this.budgetMonth, f),
      recurring: this.api.recurring(f),
      invoiceList: this.api.invoices(),
    }).subscribe(({ summary, monthly, top, holders, weekdays, invoices, categories, budgets, recurring, invoiceList }) => {
      this.summary = summary;
      this.topEstablishment = top[0] ?? null;
      this.budgets = budgets;
      this.recurringItems = recurring;
      this.invoiceList = invoiceList;
      this.computeInvoiceStatus(invoiceList, invoices);
      const active = monthly.filter((m) => m.expenses > 0);
      this.avgMonthly = active.length ? active.reduce((acc, m) => acc + m.expenses, 0) / active.length : null;
      const last = monthly[monthly.length - 1];
      const prev = monthly[monthly.length - 2];
      this.lastMonthExpenses = last?.expenses ?? 0;
      this.momChange = last && prev && prev.expenses > 0
        ? ((last.expenses - prev.expenses) / prev.expenses) * 100
        : null;
      this.buildMonthly(monthly);
      this.buildTop(top);
      this.buildHolders(holders);
      this.buildCategories(categories);
      this.buildWeekdays(weekdays);
      this.buildInvoices(invoices);
    });
  }

  loadBudgets(): void {
    this.api.budgetStatus(this.budgetMonth, this.lastFilters).subscribe((b) => (this.budgets = b));
  }

  private computeInvoiceStatus(invoiceList: Invoice[], totals: InvoiceTotal[]): void {
    const today = new Date();
    const byId = new Map(totals.map((t) => [t.import_id, t]));
    let openTotal = 0, openCount = 0, overdueTotal = 0, overdueCount = 0;
    let nextDue: string | null = null, nextDueTotal = 0;
    for (const inv of invoiceList) {
      if (inv.paid || !inv.reference_date) continue;
      const total = byId.get(inv.id);
      const ref = new Date(inv.reference_date + 'T00:00:00');
      const amount = total?.expenses ?? 0;
      if (ref < today) {
        overdueCount++;
        overdueTotal += amount;
        if (!nextDue || ref < new Date(nextDue + 'T00:00:00')) {
          nextDue = inv.reference_date;
          nextDueTotal = amount;
        }
      } else {
        openTotal += amount;
        openCount++;
        if (!nextDue || ref < new Date(nextDue + 'T00:00:00')) {
          nextDue = inv.reference_date;
          nextDueTotal = amount;
        }
      }
    }
    this.openInvoiceTotal = openTotal;
    this.openInvoiceCount = openCount;
    this.overdueCount = overdueCount;
    this.overdueTotal = overdueTotal;
    this.nextDue = nextDue;
    this.nextDueTotal = nextDueTotal;
  }

  private restoreLayout(): void {
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { order?: string[]; hidden?: string[] };
      if (parsed.order?.length) {
        const known = new Set(DEFAULT_WIDGETS.map((w) => w.id));
        const ordered = parsed.order.filter((id) => known.has(id));
        const missing = DEFAULT_WIDGETS.filter((w) => !ordered.includes(w.id));
        this.widgets = [...ordered, ...missing.map((w) => w.id)].map(
          (id) => DEFAULT_WIDGETS.find((w) => w.id === id)!
        );
      }
      if (parsed.hidden?.length) {
        this.hidden = new Set(parsed.hidden.filter((id) => DEFAULT_WIDGETS.some((w) => w.id === id)));
      }
    } catch {
      // ignore corrupted layout, keep defaults
    }
  }

  private saveLayout(): void {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({
      order: this.widgets.map((w) => w.id),
      hidden: [...this.hidden],
    }));
  }

  private buildMonthly(points: MonthlyPoint[]): void {
    this.monthlyChartData = {
      labels: points.map((p) => p.month),
      datasets: [
        { data: points.map((p) => p.expenses), label: 'Expenses', backgroundColor: '#f87171', borderRadius: 5, maxBarThickness: 26 },
        { data: points.map((p) => p.payments), label: 'Payments', backgroundColor: '#34d399', borderRadius: 5, maxBarThickness: 26 },
      ],
    };
  }

  private buildInvoices(invoices: InvoiceTotal[]): void {
    const withRef = invoices.filter((i) => i.reference_date);
    this.invoiceChartData = {
      labels: withRef.map((i) => (i.reference_date ?? '').slice(0, 7)),
      datasets: [{
        data: withRef.map((i) => i.expenses),
        label: 'Invoice total',
        borderColor: '#5b8cff',
        backgroundColor: 'rgba(91,140,255,0.15)',
        fill: true,
        tension: 0.35,
        pointRadius: 3,
      }],
    };
  }

  private buildHolders(holders: HolderTotal[]): void {
    this.holderChartData = {
      labels: holders.map((h) => h.holder),
      datasets: [{
        data: holders.map((h) => h.expenses),
        backgroundColor: ['#5b8cff', '#9b6bff', '#34d399', '#fbbf24', '#f87171', '#22d3ee'],
        borderWidth: 0,
      }],
    };
  }

  private buildCategories(categories: CategorySpend[]): void {
    this.categoryChartData = {
      labels: categories.map((c) => c.category),
      datasets: [{
        data: categories.map((c) => c.total),
        backgroundColor: categories.map((c) => c.color),
        borderWidth: 0,
      }],
    };
  }

  private buildWeekdays(points: WeekdayPoint[]): void {
    const byDay = new Map(points.map((p) => [p.weekday, p.expenses]));
    this.weekdayChartData = {
      labels: WEEKDAYS_PT,
      datasets: [{
        data: [1, 2, 3, 4, 5, 6, 7].map((d) => byDay.get(d) ?? 0),
        label: 'Expenses',
        backgroundColor: '#9b6bff',
        borderRadius: 5,
        maxBarThickness: 34,
      }],
    };
  }

  private buildTop(items: EstablishmentTotal[]): void {
    this.topChartData = {
      labels: items.map((i) => i.establishment),
      datasets: [{ data: items.map((i) => i.total), label: 'Total', backgroundColor: '#5b8cff', borderRadius: 5, maxBarThickness: 18 }],
    };
  }
}
