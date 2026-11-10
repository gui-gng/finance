import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';
import { forkJoin } from 'rxjs';

import {
  ApiService, BudgetStatus, CategorySpend, EstablishmentTotal, Filters, HolderTotal,
  InvoiceTotal, MonthlyPoint, RecurringItem, Summary, WeekdayPoint,
} from '../api.service';
import { FiltersComponent } from '../filters/filters.component';

const WEEKDAYS_PT = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, BaseChartDirective, FiltersComponent],
  template: `
    <h1 class="page-title">Dashboard</h1>
    <p class="page-sub">Overview of your imported financial data</p>

    <app-filters (changed)="load($event)" />

    <div class="cards" *ngIf="summary">
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

    <div class="card" *ngIf="budgets.length">
      <h3>Budgets — {{ currentMonthLabel }} <a routerLink="/categories" class="muted" style="float: right; font-size: 0.8rem; font-weight: 400">manage →</a></h3>
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

    <div class="card">
      <h3>Monthly flow</h3>
      <div style="height: 300px">
        <canvas baseChart [data]="monthlyChartData" [options]="barOptions" type="bar"></canvas>
      </div>
    </div>

    <div class="grid-2">
      <div class="card" *ngIf="categoryChartData.labels?.length">
        <h3>Spending by category</h3>
        <div style="height: 280px">
          <canvas baseChart [data]="categoryChartData" [options]="doughnutOptions" type="doughnut"></canvas>
        </div>
      </div>
      <div class="card" *ngIf="holderChartData.labels?.length">
        <h3>Expenses by holder</h3>
        <div style="height: 280px">
          <canvas baseChart [data]="holderChartData" [options]="doughnutOptions" type="doughnut"></canvas>
        </div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card" *ngIf="invoiceChartData.labels?.length">
        <h3>Invoice totals (by statement)</h3>
        <div style="height: 260px">
          <canvas baseChart [data]="invoiceChartData" [options]="lineOptions" type="line"></canvas>
        </div>
      </div>
      <div class="card" *ngIf="weekdayChartData.labels?.length">
        <h3>Expenses by weekday</h3>
        <div style="height: 260px">
          <canvas baseChart [data]="weekdayChartData" [options]="barOptions" type="bar"></canvas>
        </div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>Top establishments</h3>
        <div style="height: 420px">
          <canvas baseChart [data]="topChartData" [options]="topChartOptions" type="bar"></canvas>
        </div>
      </div>
      <div class="card" *ngIf="recurringItems.length">
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
  `,
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
  currentMonth = new Date().toISOString().slice(0, 7);
  currentMonthLabel = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

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

  pct(b: BudgetStatus): number {
    return Math.round((b.spent / b.budget) * 100);
  }

  barWidth(b: BudgetStatus): string {
    return Math.min(100, this.pct(b)) + '%';
  }

  load(f: Filters): void {
    forkJoin({
      summary: this.api.summary(f),
      monthly: this.api.monthly(f),
      top: this.api.topEstablishments(f),
      holders: this.api.byHolder(f),
      weekdays: this.api.byWeekday(f),
      invoices: this.api.invoiceTotals(f),
      categories: this.api.byCategory(f),
      budgets: this.api.budgetStatus(this.currentMonth, f),
      recurring: this.api.recurring(f),
    }).subscribe(({ summary, monthly, top, holders, weekdays, invoices, categories, budgets, recurring }) => {
      this.summary = summary;
      this.topEstablishment = top[0] ?? null;
      this.budgets = budgets;
      this.recurringItems = recurring;
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
