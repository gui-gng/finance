import { Component, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BaseChartDirective } from 'ng2-charts';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { forkJoin } from 'rxjs';

import {
  ApiService, BudgetStatus, CategorySpend, EstablishmentTotal, Filters, HolderTotal,
  Invoice, InvoiceTotal, MonthlyPoint, RecurringItem, Summary, WeekdayPoint,
} from '../api.service';
import { FiltersComponent } from '../filters/filters.component';
import { SettingsService } from '../services/settings.service';
import { MoneyPipe } from '../money.pipe';

Chart.register(...registerables, zoomPlugin);

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

const KPI_OPTIONS = [
  { id: 'none', label: '—' },
  { id: 'count', label: 'Transaction count' },
  { id: 'avg_ticket', label: 'Average ticket' },
  { id: 'uncategorized', label: 'Uncategorized total' },
  { id: 'payment_ratio', label: 'Payment ratio %' },
  { id: 'biggest', label: 'Biggest expense' },
];

const PRESETS: Record<string, { order: string[]; hidden: string[] }> = {
  default: {
    order: DEFAULT_WIDGETS.map((w) => w.id),
    hidden: [],
  },
  compact: {
    order: DEFAULT_WIDGETS.map((w) => w.id),
    hidden: ['categories', 'holders', 'weekdays', 'top', 'recurring', 'monthly'],
  },
  analyst: {
    order: DEFAULT_WIDGETS.map((w) => w.id),
    hidden: ['invoiceStatus'],
  },
};

interface Pin { category_id?: number; holder?: string }

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, BaseChartDirective, FiltersComponent, MoneyPipe],
  template: `
    <div class="dash-head">
      <div>
        <h1 class="page-title">Dashboard</h1>
        <p class="page-sub">Overview of your imported financial data</p>
      </div>
      <div style="display: flex; gap: 0.4rem">
        <button class="ghost" (click)="exportPdf()" [disabled]="exporting">{{ exporting ? 'Rendering…' : 'Export PDF' }}</button>
        <button class="ghost" (click)="autoRefresh = !autoRefresh; setupRefresh()">{{ autoRefresh ? '⏸ Auto-refresh on' : 'Auto-refresh' }}</button>
        <button class="ghost" (click)="customizing = !customizing">Customize</button>
      </div>
    </div>

    <div class="card customize" *ngIf="customizing">
      <h3>Customize dashboard</h3>
      <div style="display: flex; gap: 0.4rem; margin-bottom: 0.9rem; flex-wrap: wrap">
        <span class="muted" style="align-self: center; font-size: 0.82rem">Layout:</span>
        <button class="chip" *ngFor="let p of presetNames" [class.active]="preset === p" (click)="applyPreset(p)">{{ p }}</button>
      </div>
      <p class="muted" style="font-size: 0.82rem; margin: 0 0 0.4rem">Extra KPI cards:</p>
      <div style="display: flex; gap: 0.5rem; margin-bottom: 0.9rem; flex-wrap: wrap">
        <select *ngFor="let slot of [0, 1]; let i = index" [(ngModel)]="extraKpis[i]" (ngModelChange)="saveLayout(); load(lastFilters)">
          <option *ngFor="let o of kpiOptions" [ngValue]="o.id">{{ o.label }}</option>
        </select>
      </div>
      <div class="widget-list">
        <div class="widget-item" *ngFor="let w of widgets; let i = index">
          <label class="widget-check">
            <input type="checkbox" [checked]="!hidden.has(w.id)" (change)="toggleWidget(w.id)">
            {{ w.label }}
          </label>
          <span class="widget-pin" *ngIf="pinnable(w.id)">
            <select [ngModel]="pins[w.id]?.category_id || 0" (ngModelChange)="setPin(w.id, 'category_id', $event)" style="min-width: 0; padding: 0.1rem 0.3rem; font-size: 0.72rem">
              <option [ngValue]="0">all categories</option>
              <option *ngFor="let c of categories" [ngValue]="c.id">{{ c.name }}</option>
            </select>
            <select [ngModel]="pins[w.id]?.holder || ''" (ngModelChange)="setPin(w.id, 'holder', $event)" style="min-width: 0; padding: 0.1rem 0.3rem; font-size: 0.72rem">
              <option value="">all holders</option>
              <option *ngFor="let h of holders" [ngValue]="h">{{ h }}</option>
            </select>
          </span>
          <span class="widget-move">
            <button class="ghost" (click)="move(i, -1)" [disabled]="i === 0" title="Move up">↑</button>
            <button class="ghost" (click)="move(i, 1)" [disabled]="i === widgets.length - 1" title="Move down">↓</button>
          </span>
        </div>
      </div>
    </div>

    <app-filters (changed)="load($event)" />

    <div class="empty-state card" *ngIf="summary && !summary.count">
      <div class="big">📊</div>
      <p>No data yet. <a routerLink="/import">Import your first statement</a> to see the dashboard come alive.</p>
    </div>

    <div class="dash-grid" [class.side-by-side]="!settings.s.mobileStack" #dashGrid>
      <div class="widget span-2" *ngIf="visible('stats') && summary" [style.order]="orderOf('stats')">
        <div class="cards">
          <div class="stat red">
            <div class="label">Total expenses</div>
            <div class="value">{{ summary.total_expenses | money }}</div>
            <div class="hint" *ngIf="avgMonthly">avg {{ avgMonthly | money }}/month</div>
          </div>
          <div class="stat green">
            <div class="label">Total payments</div>
            <div class="value">{{ summary.total_payments | money }}</div>
          </div>
          <div class="stat" *ngIf="summary.total_income">
            <div class="label">Income</div>
            <div class="value positive">{{ summary.total_income | money }}</div>
          </div>
          <div class="stat">
            <div class="label">Net balance</div>
            <div class="value" [class.positive]="summary.net >= 0" [class.negative]="summary.net < 0">
              {{ summary.net | money }}
            </div>
          </div>
          <div class="stat purple">
            <div class="label">Last month</div>
            <div class="value">{{ lastMonthExpenses | money }}</div>
            <div class="hint" *ngIf="momChange !== null" [class.positive]="momChange <= 0" [class.negative]="momChange > 0">
              {{ momChange > 0 ? '+' : '' }}{{ momChange | number:'1.0-1' }}% vs previous month
            </div>
          </div>
          <div class="stat" *ngIf="topEstablishment">
            <div class="label">Top establishment</div>
            <div class="value" style="font-size: 1.05rem">{{ topEstablishment.establishment }}</div>
            <div class="hint">{{ topEstablishment.total | money }} · {{ topEstablishment.count }}x</div>
          </div>
          <div class="stat" *ngFor="let k of activeKpis">
            <div class="label">{{ k.label }}</div>
            <div class="value" [style.font-size.rem]="1.05">{{ k.value }}</div>
          </div>
        </div>
      </div>

      <div class="widget span-2" *ngIf="visible('invoiceStatus') && invoiceList.length" [style.order]="orderOf('invoiceStatus')">
        <div class="cards">
          <div class="stat" [class.red]="overdueCount > 0">
            <div class="label">Open invoices</div>
            <div class="value">{{ openInvoiceTotal | money }}</div>
            <div class="hint">{{ openInvoiceCount }} unpaid <a routerLink="/invoices" class="muted">manage →</a></div>
          </div>
          <div class="stat red" *ngIf="overdueCount">
            <div class="label">Overdue</div>
            <div class="value">{{ overdueCount }}</div>
            <div class="hint">{{ overdueTotal | money }} past due</div>
          </div>
          <div class="stat purple" *ngIf="nextDue">
            <div class="label">Next invoice due</div>
            <div class="value" style="font-size: 1.05rem">{{ nextDue | date:'dd MMM yyyy':'':'pt-BR' }}</div>
            <div class="hint">{{ nextDueTotal | money }}</div>
          </div>
        </div>
      </div>

      <div class="widget span-2" *ngIf="visible('budgets') && budgets.length" [style.order]="orderOf('budgets')" [class.full]="fullscreen === 'budgets'">
        <div class="card">
          <h3>Budgets — {{ budgetMonthLabel }}
            <input type="month" class="budget-month" [(ngModel)]="budgetMonth" (ngModelChange)="loadBudgets()">
            <a routerLink="/budgets" class="muted head-link">details →</a>
            <button class="ghost head-btn" (click)="toggleFull('budgets')">{{ fullscreen === 'budgets' ? '✕' : '⤢' }}</button>
          </h3>
          <div class="budget-row" *ngFor="let b of budgets">
            <div class="budget-head">
              <span><span class="dot" [style.background]="b.color"></span>{{ b.name }}</span>
              <span class="muted">{{ b.spent | money }} / {{ b.budget | money }}</span>
              <span class="budget-pct" [class.negative]="b.spent > b.budget">{{ pct(b) }}%</span>
            </div>
            <div class="progress">
              <div [style.width]="barWidth(b)" [style.background]="b.spent > b.budget ? 'var(--red)' : b.color"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="widget span-2" *ngIf="visible('monthly')" [style.order]="orderOf('monthly')" [class.full]="fullscreen === 'monthly'">
        <div class="card">
          <h3>Monthly flow
            <button class="chip head-chip" [class.active]="monthlyType === 'bar'" (click)="setMonthlyType('bar')">bar</button>
            <button class="chip head-chip" [class.active]="monthlyType === 'line'" (click)="setMonthlyType('line')">line</button>
            <button class="chip head-chip" [class.active]="yoyOverlay" (click)="yoyOverlay = !yoyOverlay; buildMonthly(monthlyCache)">YoY overlay</button>
            <button class="ghost head-btn" (click)="toggleFull('monthly')">{{ fullscreen === 'monthly' ? '✕' : '⤢' }}</button>
          </h3>
          <div [style.height.px]="fullscreen === 'monthly' ? 560 : 300">
            <canvas baseChart [data]="monthlyChartData" [options]="monthlyOptions" [type]="$any(monthlyType)"></canvas>
          </div>
        </div>
      </div>

      <div class="widget" *ngIf="visible('categories') && categoryChartData.labels?.length" [style.order]="orderOf('categories')" [class.full]="fullscreen === 'categories'">
        <div class="card">
          <h3>Spending by category
            <button class="ghost head-btn" (click)="toggleFull('categories')">{{ fullscreen === 'categories' ? '✕' : '⤢' }}</button>
          </h3>
          <div [style.height.px]="fullscreen === 'categories' ? 520 : 280">
            <canvas baseChart [data]="categoryChartData" [options]="doughnutOptions" type="doughnut"></canvas>
          </div>
        </div>
      </div>

      <div class="widget" *ngIf="visible('holders') && holderChartData.labels?.length" [style.order]="orderOf('holders')">
        <div class="card">
          <h3>Expenses by holder</h3>
          <div [style.height.px]="280">
            <canvas baseChart [data]="holderChartData" [options]="doughnutOptions" type="doughnut"></canvas>
          </div>
        </div>
      </div>

      <div class="widget" *ngIf="visible('invoices') && invoiceChartData.labels?.length" [style.order]="orderOf('invoices')">
        <div class="card">
          <h3>Invoice totals (by statement)
            <button class="chip head-chip" [class.active]="invoiceChartType === 'line'" (click)="invoiceChartType = 'line'; buildInvoices(invoiceCache)">line</button>
            <button class="chip head-chip" [class.active]="invoiceChartType === 'bar'" (click)="invoiceChartType = 'bar'; buildInvoices(invoiceCache)">bar</button>
            <a routerLink="/invoices" class="muted head-link">details →</a>
          </h3>
          <div style="height: 260px">
            <canvas baseChart [data]="invoiceChartData" [options]="lineOptions" [type]="$any(invoiceChartType)"></canvas>
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

      <div class="widget" *ngIf="visible('top')" [style.order]="orderOf('top')" [class.full]="fullscreen === 'top'">
        <div class="card">
          <h3>Top establishments
            <button class="ghost head-btn" (click)="toggleFull('top')">{{ fullscreen === 'top' ? '✕' : '⤢' }}</button>
          </h3>
          <div [style.height.px]="fullscreen === 'top' ? 560 : 420">
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
                  <td class="num">{{ r.avg_amount | money }}</td>
                  <td class="num">{{ r.total | money }}</td>
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
    .widget.full { grid-column: 1 / -1; }
    .customize .widget-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 0.4rem 1.5rem; }
    .widget-item { display: flex; align-items: center; gap: 0.5rem; font-size: 0.88rem; }
    .widget-check { display: flex; align-items: center; gap: 0.5rem; text-transform: none; letter-spacing: 0; color: var(--text); font-weight: 500; margin: 0; }
    .widget-check input { accent-color: var(--accent); }
    .widget-pin { display: flex; gap: 0.25rem; }
    .widget-move { display: flex; gap: 0.25rem; }
    .widget-move button { padding: 0.1rem 0.5rem; min-width: 0; }
    .budget-month, .head-chip { float: right; margin-left: 0.4rem; }
    .budget-month { padding: 0.2rem 0.4rem; min-width: 0; font-size: 0.8rem; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; color: var(--text); color-scheme: dark; }
    .head-link { float: right; font-size: 0.8rem; font-weight: 400; margin-left: 0.4rem; }
    .head-btn { float: right; padding: 0.05rem 0.45rem; min-width: 0; margin-left: 0.3rem; font-size: 0.78rem; }
    @media (max-width: 1000px) {
      .dash-grid:not(.side-by-side) { grid-template-columns: 1fr; }
    }
  `],
})
export class DashboardComponent implements OnDestroy {
  private api = inject(ApiService);
  settings = inject(SettingsService);

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
  preset = 'default';
  presetNames = ['default', 'compact', 'analyst'];
  widgets: WidgetDef[] = DEFAULT_WIDGETS.map((w) => ({ ...w }));
  hidden = new Set<string>();
  pins: Record<string, Pin> = {};
  extraKpis: string[] = ['none', 'none'];
  kpiOptions = KPI_OPTIONS;
  categories: { id: number; name: string }[] = [];
  holders: string[] = [];
  fullscreen = '';
  monthlyType = 'bar' as 'bar' | 'line';
  invoiceChartType = 'line' as 'line' | 'bar';
  yoyOverlay = false;
  autoRefresh = false;
  exporting = false;
  monthlyCache: MonthlyPoint[] = [];
  invoiceCache: InvoiceTotal[] = [];

  lastFilters: Filters = {};

  barOptions: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { usePointStyle: true, boxWidth: 8 } } },
    scales: { y: { beginAtZero: true, grid: { color: 'rgba(148,163,184,0.08)' } }, x: { grid: { display: false } } },
  };

  monthlyOptions: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { usePointStyle: true, boxWidth: 8 } },
      zoom: {
        pan: { enabled: true, mode: 'x' },
        zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
      },
    },
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

  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private uncategorizedTotal = 0;

  constructor() {
    this.restoreLayout();
    this.api.categories().subscribe((c) => (this.categories = c));
    this.api.holders().subscribe((h) => (this.holders = h));
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  get budgetMonthLabel(): string {
    const [y, m] = this.budgetMonth.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  }

  get activeKpis(): { label: string; value: string }[] {
    if (!this.summary) return [];
    const out: { label: string; value: string }[] = [];
    for (const id of this.extraKpis) {
      switch (id) {
        case 'count':
          out.push({ label: 'Transactions', value: String(this.summary.count) });
          break;
        case 'avg_ticket':
          out.push({ label: 'Avg ticket', value: this.settings.fmt(this.summary.count ? this.summary.total_expenses / this.summary.count : 0) });
          break;
        case 'uncategorized':
          out.push({ label: 'Uncategorized', value: this.settings.fmt(this.uncategorizedTotal) });
          break;
        case 'payment_ratio':
          out.push({
            label: 'Payment ratio',
            value: this.summary.total_expenses ? `${Math.round((this.summary.total_payments / this.summary.total_expenses) * 100)}%` : '—',
          });
          break;
        case 'biggest':
          out.push({ label: 'Biggest expense', value: this.topEstablishment ? this.settings.fmt(this.topEstablishment.total) : '—' });
          break;
      }
    }
    return out;
  }

  visible(id: string): boolean { return !this.hidden.has(id); }

  orderOf(id: string): number { return this.widgets.findIndex((w) => w.id === id); }

  pinnable(id: string): boolean {
    return ['categories', 'holders', 'invoices', 'weekdays', 'top', 'recurring', 'monthly'].includes(id);
  }

  toggleWidget(id: string): void {
    if (this.hidden.has(id)) this.hidden.delete(id);
    else this.hidden.add(id);
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

  setPin(widgetId: string, key: keyof Pin, value: number | string): void {
    const pin = { ...(this.pins[widgetId] ?? {}) };
    if (key === 'category_id') {
      if (value) pin.category_id = Number(value);
      else delete pin.category_id;
    } else {
      if (value) pin.holder = String(value);
      else delete pin.holder;
    }
    this.pins = { ...this.pins, [widgetId]: pin };
    this.saveLayout();
    this.load(this.lastFilters);
  }

  private filtersFor(id: string): Filters {
    const pin = this.pins[id] ?? {};
    const f: Filters = { ...this.lastFilters };
    if (pin.category_id) f.category_id = pin.category_id;
    if (pin.holder) f.holder = pin.holder;
    return f;
  }

  applyPreset(name: string): void {
    const p = PRESETS[name];
    if (!p) return;
    this.preset = name;
    this.hidden = new Set(p.hidden);
    const ordered = p.order.filter((id) => DEFAULT_WIDGETS.some((w) => w.id === id));
    const missing = DEFAULT_WIDGETS.filter((w) => !ordered.includes(w.id));
    this.widgets = [...ordered, ...missing].map((id) => DEFAULT_WIDGETS.find((w) => w.id === id)!);
    this.saveLayout();
  }

  setMonthlyType(t: 'bar' | 'line'): void {
    this.monthlyType = t;
  }

  toggleFull(id: string): void {
    this.fullscreen = this.fullscreen === id ? '' : id;
  }

  setupRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.autoRefresh) {
      this.refreshTimer = setInterval(() => this.load(this.lastFilters), 5 * 60 * 1000);
    }
  }

  async exportPdf(): Promise<void> {
    const el = document.querySelector('.dash-grid');
    if (!el) return;
    this.exporting = true;
    try {
      const canvas = await html2canvas(el as HTMLElement, { backgroundColor: '#0b0e14', scale: 1.5 });
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt' });
      const img = canvas.toDataURL('image/png');
      const w = pdf.internal.pageSize.getWidth();
      const h = (canvas.height * w) / canvas.width;
      let position = 0;
      let remaining = h;
      pdf.addImage(img, 'PNG', 0, position, w, h);
      remaining -= pdf.internal.pageSize.getHeight();
      while (remaining > 0) {
        position -= pdf.internal.pageSize.getHeight();
        pdf.addPage();
        pdf.addImage(img, 'PNG', 0, position, w, h);
        remaining -= pdf.internal.pageSize.getHeight();
      }
      pdf.save(`dashboard-${new Date().toISOString().slice(0, 10)}.pdf`);
    } finally {
      this.exporting = false;
    }
  }

  pct(b: BudgetStatus): number { return Math.round((b.spent / b.budget) * 100); }
  barWidth(b: BudgetStatus): string { return Math.min(100, this.pct(b)) + '%'; }

  load(f: Filters): void {
    this.lastFilters = f;
    forkJoin({
      summary: this.api.summary(this.filtersFor('stats')),
      monthly: this.api.monthly(this.filtersFor('monthly')),
      top: this.api.topEstablishments(this.filtersFor('top')),
      holders: this.api.byHolder(this.filtersFor('holders')),
      weekdays: this.api.byWeekday(this.filtersFor('weekdays')),
      invoices: this.api.invoiceTotals(this.filtersFor('invoices')),
      categories: this.api.byCategory(this.filtersFor('categories')),
      budgets: this.api.budgetStatus(this.budgetMonth, f),
      recurring: this.api.recurring(this.filtersFor('recurring')),
      invoiceList: this.api.invoices(),
      uncategorized: this.api.transactions({ ...f, category_id: 'none', include_excluded: false }, 1, 0),
    }).subscribe(({ summary, monthly, top, holders, weekdays, invoices, categories, budgets, recurring, invoiceList, uncategorized }) => {
      this.summary = summary;
      this.topEstablishment = top[0] ?? null;
      this.budgets = budgets;
      this.recurringItems = recurring;
      this.invoiceList = invoiceList;
      this.uncategorizedTotal = uncategorized.total;
      this.computeInvoiceStatus(invoiceList, invoices);
      const active = monthly.filter((m) => m.expenses > 0);
      this.avgMonthly = active.length ? active.reduce((acc, m) => acc + m.expenses, 0) / active.length : null;
      const last = monthly[monthly.length - 1];
      const prev = monthly[monthly.length - 2];
      this.lastMonthExpenses = last?.expenses ?? 0;
      this.momChange = last && prev && prev.expenses > 0 ? ((last.expenses - prev.expenses) / prev.expenses) * 100 : null;
      this.monthlyCache = monthly;
      this.invoiceCache = invoices;
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
      const earlier = !nextDue || ref < new Date(nextDue + 'T00:00:00');
      if (ref < today) {
        overdueCount++;
        overdueTotal += amount;
        if (earlier) { nextDue = inv.reference_date; nextDueTotal = amount; }
      } else {
        openTotal += amount;
        openCount++;
        if (earlier) { nextDue = inv.reference_date; nextDueTotal = amount; }
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
      const parsed = JSON.parse(raw) as {
        order?: string[]; hidden?: string[]; pins?: Record<string, Pin>;
        extraKpis?: string[]; preset?: string;
      };
      if (parsed.order?.length) {
        const known = new Set(DEFAULT_WIDGETS.map((w) => w.id));
        const ordered = parsed.order.filter((id) => known.has(id));
        const missing = DEFAULT_WIDGETS.filter((w) => !ordered.includes(w.id));
        this.widgets = [...ordered, ...missing.map((w) => w.id)].map((id) => DEFAULT_WIDGETS.find((w) => w.id === id)!);
      }
      if (parsed.hidden?.length) {
        this.hidden = new Set(parsed.hidden.filter((id) => DEFAULT_WIDGETS.some((w) => w.id === id)));
      }
      if (parsed.pins) this.pins = parsed.pins;
      if (parsed.extraKpis?.length) this.extraKpis = [parsed.extraKpis[0] ?? 'none', parsed.extraKpis[1] ?? 'none'];
      if (parsed.preset) this.preset = parsed.preset;
    } catch {
      // ignore corrupted layout, keep defaults
    }
  }

  saveLayout(): void {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({
      order: this.widgets.map((w) => w.id),
      hidden: [...this.hidden],
      pins: this.pins,
      extraKpis: this.extraKpis,
      preset: this.preset,
    }));
  }

  buildMonthly(points: MonthlyPoint[]): void {
    const datasets: ChartConfiguration<'bar'>['data']['datasets'] = [
      { data: points.map((p) => p.expenses), label: 'Expenses', backgroundColor: '#f87171', borderRadius: 5, maxBarThickness: 26 },
      { data: points.map((p) => p.payments), label: 'Payments', backgroundColor: '#34d399', borderRadius: 5, maxBarThickness: 26 },
    ];
    if (this.yoyOverlay) {
      const prev = points.map((p, i) => {
        const [y, m] = p.month.split('-').map(Number);
        const lastYear = `${y - 1}-${String(m).padStart(2, '0')}`;
        return points.find((q) => q.month === lastYear)?.expenses ?? null;
      });
      datasets.push({
        data: prev as number[],
        label: 'Same month last year',
        type: 'line',
        borderColor: '#fbbf24',
        borderDash: [6, 4],
        pointRadius: 3,
        fill: false,
      } as never);
    }
    this.monthlyChartData = { labels: points.map((p) => p.month), datasets };
  }

  buildInvoices(invoices: InvoiceTotal[]): void {
    const withRef = invoices.filter((i) => i.reference_date);
    const dataset: ChartConfiguration<'line'>['data']['datasets'][number] = {
      data: withRef.map((i) => i.expenses),
      label: 'Invoice total',
      borderColor: '#5b8cff',
      backgroundColor: 'rgba(91,140,255,0.15)',
      fill: this.invoiceChartType === 'line',
      tension: 0.35,
      pointRadius: 4,
      pointBackgroundColor: withRef.map((i) => (i.paid ? '#34d399' : '#f87171')),
    } as never;
    this.invoiceChartData = {
      labels: withRef.map((i) => (i.reference_date ?? '').slice(0, 7)),
      datasets: [dataset],
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
