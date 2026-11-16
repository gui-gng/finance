import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';

import {
  ApiService, BudgetStatus, BudgetTemplate, Category, Goal, TrendPoint,
} from '../api.service';
import { SettingsService } from '../services/settings.service';
import { ToastService } from '../services/toast.service';

const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

interface Suggestion { category_id: number; name: string; amount: number; apply: boolean }

@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [CommonModule, FormsModule, BaseChartDirective],
  template: `
    <h1 class="page-title">Budgets</h1>
    <p class="page-sub">Monthly budgets, goals, templates and long-range views</p>

    <div class="cards" *ngIf="budgets.length">
      <div class="stat" [class.red]="totalSpent > totalBudget">
        <div class="label">Total budget</div>
        <div class="value">{{ fmt(totalBudget) }}</div>
        <div class="hint" [class.negative]="totalSpent > totalBudget">{{ pctTotal }}% used</div>
      </div>
      <div class="stat purple">
        <div class="label">Total spent</div>
        <div class="value">{{ fmt(totalSpent) }}</div>
        <div class="hint">{{ monthLabel(budgetMonth) }}</div>
      </div>
      <div class="stat green" *ngIf="totalBudget - totalSpent > 0">
        <div class="label">Remaining</div>
        <div class="value">{{ fmt(totalBudget - totalSpent) }}</div>
      </div>
    </div>

    <div class="card">
      <h3>Budgets — {{ monthLabel(budgetMonth) }}
        <input type="month" class="month-input" [(ngModel)]="budgetMonth" (ngModelChange)="loadBudgets()">
      </h3>
      <div class="budget-row" *ngFor="let b of budgets">
        <div class="budget-head">
          <span>
            <span class="dot" [style.background]="b.color"></span>{{ b.name }}
            <span class="pill neutral" *ngIf="b.period === 'weekly'" style="font-size: 0.65rem">weekly</span>
          </span>
          <span class="muted">{{ fmt(b.spent) }} / {{ fmt(b.budget) }}</span>
          <span class="budget-pct" [class.negative]="b.spent > b.budget" [class.warn]="b.spent > b.budget * 0.8 && b.spent <= b.budget">
            {{ pct(b) }}%
          </span>
        </div>
        <div class="progress">
          <div [style.width]="barWidth(b)" [style.background]="barColor(b)"></div>
        </div>
        <div class="budget-actions">
          <span class="pace" [class.negative]="paceBad(b)" *ngIf="b.period === 'monthly'">
            {{ pacePct(b) | number:'1.0-0' }}% of month elapsed
          </span>
          <label class="mini-check"><input type="checkbox" [checked]="b.rollover" (change)="toggleRollover(b)"> rollover</label>
          <select [ngModel]="b.period" (ngModelChange)="setPeriod(b, $event)">
            <option value="monthly">monthly</option>
            <option value="weekly">weekly</option>
          </select>
        </div>
      </div>
      <p class="muted" *ngIf="!budgets.length">No budgets set. Add budgets on the <a routerLink="/categories">Categories</a> page.</p>
      <div class="digest" *ngIf="overBudgetList.length">
        <strong>Over budget:</strong>
        <span *ngFor="let b of overBudgetList">{{ b.name }} (+{{ fmt(b.spent - b.budget) }})</span>
      </div>
    </div>

    <div class="card" *ngIf="trendChartData.labels?.length">
      <h3>Budget vs actual trend <span class="muted" style="font-weight: 400; font-size: 0.8rem">(current budget vs last 6 months of spending, top categories)</span></h3>
      <div style="height: 300px">
        <canvas baseChart [data]="trendChartData" [options]="trendOptions" type="line"></canvas>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>Suggestions <span class="muted" style="font-weight: 400; font-size: 0.8rem">(3-month average)</span></h3>
        <button class="ghost" (click)="loadSuggestions()" *ngIf="!suggestions.length">Generate suggestions</button>
        <ng-container *ngIf="suggestions.length">
          <div class="sub-row" *ngFor="let s of suggestions">
            <label style="display: flex; align-items: center; gap: 0.5rem; margin: 0; text-transform: none; letter-spacing: 0">
              <input type="checkbox" [(ngModel)]="s.apply"> {{ s.name }}
            </label>
            <span style="flex: 1"></span>
            <span>{{ fmt(s.amount) }}</span>
          </div>
          <button style="margin-top: 0.75rem" (click)="applySuggestions()">Apply selected</button>
        </ng-container>
      </div>

      <div class="card">
        <h3>Templates</h3>
        <div class="sub-row" *ngFor="let t of templates">
          <span style="flex: 1">{{ t.name }} <span class="muted">({{ t.amounts.length }} budgets)</span></span>
          <button class="ghost" (click)="applyTemplate(t)">Apply</button>
          <button class="ghost danger" (click)="deleteTemplate(t)">✕</button>
        </div>
        <p class="muted" *ngIf="!templates.length">No templates yet.</p>
        <div style="display: flex; gap: 0.5rem; margin-top: 0.75rem">
          <input type="text" [(ngModel)]="newTemplateName" placeholder="Template name" style="flex: 1">
          <button class="ghost" (click)="saveTemplate()" [disabled]="!newTemplateName">Save current as template</button>
        </div>

        <h3 style="margin-top: 1.5rem">Allocation planner <span class="muted" style="font-weight: 400; font-size: 0.8rem">(50/30/20)</span></h3>
        <div style="display: flex; gap: 0.5rem">
          <input type="number" [(ngModel)]="income" placeholder="Monthly income" style="flex: 1">
          <button class="ghost" (click)="plan()" [disabled]="!income">Suggest</button>
        </div>
        <p class="muted" *ngIf="planResult" style="margin-top: 0.5rem">{{ planResult }}</p>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>Savings goals</h3>
        <div class="budget-row" *ngFor="let g of goals">
          <div class="budget-head">
            <span>{{ g.name }}</span>
            <span class="muted">{{ fmt(g.saved_amount) }} / {{ fmt(g.target_amount) }}
              <span *ngIf="g.deadline"> · {{ g.deadline | date:'MMM yyyy':'':'pt-BR' }}</span>
            </span>
            <span class="budget-pct">{{ goalPct(g) }}%</span>
          </div>
          <div class="progress"><div [style.width]="goalPct(g) + '%'"></div></div>
          <div class="budget-actions" *ngIf="g.monthly_needed">
            <span class="muted">needs {{ fmt(g.monthly_needed) }}/mo</span>
            <button class="ghost" (click)="contribute(g)">+ contribution</button>
            <button class="ghost danger" (click)="deleteGoal(g)">✕</button>
          </div>
        </div>
        <div style="display: flex; gap: 0.5rem; margin-top: 0.75rem; flex-wrap: wrap">
          <input type="text" [(ngModel)]="newGoal.name" placeholder="Goal name" style="flex: 2">
          <input type="number" [(ngModel)]="newGoal.target_amount" placeholder="Target" style="flex: 1">
          <input type="date" [(ngModel)]="newGoal.deadline" style="flex: 1">
          <button (click)="addGoal()" [disabled]="!newGoal.name || !newGoal.target_amount">Add</button>
        </div>
      </div>

      <div class="card">
        <h3>Annual view <span class="muted" style="font-weight: 400; font-size: 0.8rem">(last 12 months)</span></h3>
        <div class="table-wrap">
          <table class="annual">
            <thead>
              <tr><th>Category</th><th class="num" *ngFor="let m of last12">{{ m.short }}</th></tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of annualRows">
                <td><span class="dot" [style.background]="row.color"></span>{{ row.name }}</td>
                <td class="num" *ngFor="let m of last12"
                  [style.background]="cellColor(row.values[m.full])"
                  [title]="row.name + ' ' + m.full + ': ' + fmt(row.values[m.full] ?? 0)">
                  {{ shortVal(row.values[m.full]) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .month-input { float: right; padding: 0.2rem 0.4rem; min-width: 0; font-size: 0.8rem; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; color: var(--text); color-scheme: dark; }
    .budget-actions { display: flex; align-items: center; gap: 0.75rem; margin-top: 0.3rem; font-size: 0.78rem; }
    .budget-actions select { padding: 0.15rem 0.4rem; min-width: 0; font-size: 0.75rem; }
    .mini-check { display: flex; align-items: center; gap: 0.3rem; margin: 0; text-transform: none; letter-spacing: 0; color: var(--muted); }
    .pace.negative { color: var(--red); }
    .warn { color: #fbbf24 !important; }
    .sub-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0; font-size: 0.88rem; }
    .digest { margin-top: 1rem; font-size: 0.85rem; color: var(--red); display: flex; gap: 1rem; flex-wrap: wrap; }
    table.annual { font-size: 0.72rem; }
    table.annual td { padding: 0.3rem 0.35rem; }
  `],
})
export class BudgetsComponent implements OnInit {
  private api = inject(ApiService);
  private settings = inject(SettingsService);
  private toasts = inject(ToastService);

  budgets: BudgetStatus[] = [];
  budgetMonth = new Date().toISOString().slice(0, 7);
  goals: Goal[] = [];
  templates: BudgetTemplate[] = [];
  categories: Category[] = [];
  trend: TrendPoint[] = [];
  suggestions: Suggestion[] = [];
  newTemplateName = '';
  newGoal: Partial<Goal> = {};
  income = 0;
  planResult = '';
  last12: { full: string; short: string }[] = [];
  trendChartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  trendOptions: ChartConfiguration<'line'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { usePointStyle: true, boxWidth: 8 } } },
    scales: { y: { beginAtZero: true, grid: { color: 'rgba(148,163,184,0.08)' } }, x: { grid: { display: false } } },
  };

  ngOnInit(): void {
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const full = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      this.last12.push({ full, short: MONTHS_PT[d.getMonth()] });
    }
    forkJoin({
      budgets: this.api.budgetStatus(this.budgetMonth, {}),
      goals: this.api.goals(),
      templates: this.api.templates(),
      categories: this.api.categories(),
      trend: this.api.budgetTrend({}, 13),
    }).subscribe(({ budgets, goals, templates, categories, trend }) => {
      this.budgets = budgets;
      this.goals = goals;
      this.templates = templates;
      this.categories = categories;
      this.trend = trend;
      this.buildTrendChart(budgets, trend);
    });
  }

  private buildTrendChart(budgets: BudgetStatus[], trend: TrendPoint[]): void {
    const months = [...new Set(trend.map((p) => p.month))].sort().slice(-6);
    const top = budgets.slice().sort((a, b) => b.budget - a.budget).slice(0, 5);
    const palette = ['#5b8cff', '#9b6bff', '#34d399', '#fbbf24', '#f87171'];
    const datasets: ChartConfiguration<'line'>['data']['datasets'] = top.map((b, i) => ({
      label: b.name,
      data: months.map((m) => trend.find((p) => p.category_id === b.category_id && p.month === m)?.spent ?? 0),
      borderColor: palette[i % palette.length],
      pointRadius: 3,
      tension: 0.3,
    }));
    datasets.push({
      label: 'budget',
      data: months.map(() => budgets.reduce((a, b) => a + b.budget, 0)),
      borderColor: '#8b93a7',
      borderDash: [6, 4],
      pointRadius: 0,
      tension: 0,
    } as never);
    this.trendChartData = { labels: months, datasets };
  }

  fmt(v: number): string { return this.settings.fmt(v); }
  monthLabel(month: string): string {
    const [y, m] = month.split('-').map(Number);
    return `${MONTHS_PT[m - 1]}/${y}`;
  }

  get totalBudget(): number { return this.budgets.reduce((a, b) => a + b.budget, 0); }
  get totalSpent(): number { return this.budgets.reduce((a, b) => a + b.spent, 0); }
  get pctTotal(): number { return this.totalBudget ? Math.round((this.totalSpent / this.totalBudget) * 100) : 0; }
  get overBudgetList(): BudgetStatus[] { return this.budgets.filter((b) => b.spent > b.budget); }

  get annualRows(): { name: string; color: string; values: Record<string, number> }[] {
    const map = new Map<number, { name: string; color: string; values: Record<string, number> }>();
    for (const p of this.trend) {
      if (!map.has(p.category_id)) map.set(p.category_id, { name: p.name, color: p.color, values: {} });
      map.get(p.category_id)!.values[p.month] = p.spent;
    }
    return [...map.values()].sort((a, b) =>
      Object.values(b.values).reduce((x, y) => x + y, 0) - Object.values(a.values).reduce((x, y) => x + y, 0));
  }

  shortVal(v?: number): string {
    if (!v) return '·';
    return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
  }

  cellColor(v?: number): string {
    if (!v) return 'transparent';
    const max = 5000;
    const alpha = Math.min(0.45, (v / max) * 0.45);
    return `rgba(91, 140, 255, ${alpha.toFixed(2)})`;
  }

  pct(b: BudgetStatus): number { return b.budget ? Math.round((b.spent / b.budget) * 100) : 0; }
  barWidth(b: BudgetStatus): string { return Math.min(100, this.pct(b)) + '%'; }
  barColor(b: BudgetStatus): string { return b.spent > b.budget ? 'var(--red)' : b.spent > b.budget * 0.8 ? '#fbbf24' : b.color; }

  pacePct(b: BudgetStatus): number {
    const now = new Date();
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return (now.getDate() / days) * 100;
  }

  paceBad(b: BudgetStatus): boolean {
    return this.pct(b) > this.pacePct(b) + 10;
  }

  loadBudgets(): void {
    this.api.budgetStatus(this.budgetMonth, {}).subscribe((b) => (this.budgets = b));
  }

  toggleRollover(b: BudgetStatus): void {
    this.api.setBudgetFlags(b.category_id, { rollover: !b.rollover }).subscribe(() => {
      b.rollover = !b.rollover;
      this.loadBudgets();
    });
  }

  setPeriod(b: BudgetStatus, period: string): void {
    this.api.setBudgetFlags(b.category_id, { period }).subscribe(() => {
      b.period = period;
      this.loadBudgets();
    });
  }

  loadSuggestions(): void {
    this.api.suggestBudgets().subscribe((s) => (this.suggestions = s.map((x) => ({ ...x, apply: true }))));
  }

  applySuggestions(): void {
    const selected = this.suggestions.filter((s) => s.apply);
    let done = 0;
    for (const s of selected) {
      this.api.setBudget(s.category_id, s.amount).subscribe(() => {
        if (++done === selected.length) {
          this.toasts.show(`Applied ${selected.length} suggested budgets`);
          this.suggestions = [];
          this.loadBudgets();
        }
      });
    }
  }

  saveTemplate(): void {
    const amounts = this.budgets.map((b) => ({ category_id: b.category_id, amount: b.budget }));
    this.api.saveTemplate(this.newTemplateName, amounts).subscribe(() => {
      this.newTemplateName = '';
      this.toasts.show('Template saved');
      this.api.templates().subscribe((t) => (this.templates = t));
    });
  }

  applyTemplate(t: BudgetTemplate): void {
    this.api.applyTemplate(t.name).subscribe((r) => {
      this.toasts.show(`Applied ${r.applied} budgets`);
      this.loadBudgets();
    });
  }

  deleteTemplate(t: BudgetTemplate): void {
    this.api.deleteTemplate(t.name).subscribe(() => this.api.templates().subscribe((x) => (this.templates = x)));
  }

  plan(): void {
    const needs = ['Casa', 'Saúde', 'Transporte', 'Alimentação', 'Serviços', 'Educação'];
    const wants = ['Lazer', 'Viagens', 'Compras'];
    const savings = 0.2 * this.income;
    const needsTotal = 0.5 * this.income;
    const wantsTotal = 0.3 * this.income;
    let applied = 0;
    const setFor = (names: string[], total: number) => {
      const cats = this.categories.filter((c) => names.includes(c.name));
      const per = cats.length ? total / cats.length : 0;
      for (const c of cats) {
        this.api.setBudget(c.id, Math.round(per)).subscribe(() => {
          if (++applied === cats.length * 0 + 1) { /* noop */ }
        });
      }
    };
    setFor(needs, needsTotal);
    setFor(wants, wantsTotal);
    this.planResult = `Suggested: needs ${this.fmt(needsTotal)}, wants ${this.fmt(wantsTotal)}, savings ${this.fmt(savings)}. Applied per-category — review below.`;
    setTimeout(() => this.loadBudgets(), 800);
  }

  goalPct(g: Goal): number {
    return g.target_amount ? Math.min(100, Math.round((g.saved_amount / g.target_amount) * 100)) : 0;
  }

  addGoal(): void {
    this.api.createGoal(this.newGoal as Goal).subscribe(() => {
      this.newGoal = {};
      this.api.goals().subscribe((g) => (this.goals = g));
    });
  }

  contribute(g: Goal): void {
    const amount = Number(prompt('Contribution amount?'));
    if (!amount) return;
    this.api.updateGoal({ ...g, saved_amount: g.saved_amount + amount }).subscribe(() => {
      this.api.goals().subscribe((x) => (this.goals = x));
    });
  }

  deleteGoal(g: Goal): void {
    this.api.deleteGoal(g.id).subscribe(() => this.api.goals().subscribe((x) => (this.goals = x)));
  }
}
