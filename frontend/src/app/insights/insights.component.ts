import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';

import {
  Anomaly, ApiService, CategorySpend, FunFacts, Invoice, InvoicePayment, InvoiceTotal,
  PriceChange, RecurringItem, TrendPoint, WeeklyDigest,
} from '../api.service';
import { SettingsService } from '../services/settings.service';

interface CalendarDay {
  date: number;
  iso: string;
  other: boolean;
  events: { label: string; cls: string }[];
}

const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const WEEKDAYS_PT = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

@Component({
  selector: 'app-insights',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <h1 class="page-title">Insights</h1>
    <p class="page-sub">What needs attention, spending intelligence and recurring commitments</p>

    <div class="card">
      <h3>Ask your data</h3>
      <div style="display: flex; gap: 0.5rem">
        <input type="text" style="flex: 1" [(ngModel)]="question" (keydown.enter)="ask()"
          placeholder="quanto gastei em supermercado este mês?">
        <button (click)="ask()">Ask</button>
      </div>
      <p *ngIf="answer" style="margin-top: 0.75rem; font-size: 1.05rem">{{ answer }}</p>
      <p class="kbd-hint" style="margin-top: 0.4rem">Try: "quanto gastei no ifood mês passado", "quanto paguei em transporte ano passado"</p>
    </div>

    <div class="cards" *ngIf="safeToSpend !== null || projection !== null">
      <div class="stat">
        <div class="label">Safe to spend / day</div>
        <div class="value">{{ fmt(safeToSpend ?? 0) }}</div>
        <div class="hint">budget left ÷ days left this month</div>
      </div>
      <div class="stat purple">
        <div class="label">Month-end projection</div>
        <div class="value">{{ fmt(projection ?? 0) }}</div>
        <div class="hint">expenses projected to close the month</div>
      </div>
      <div class="stat green" *ngIf="facts?.biggest_expense">
        <div class="label">Biggest expense ever</div>
        <div class="value" style="font-size: 1rem">{{ facts!.biggest_expense!.establishment }}</div>
        <div class="hint">{{ fmt(facts!.biggest_expense!.amount) }} · {{ facts!.biggest_expense!.date | date:'MMM yyyy':'':'pt-BR' }}</div>
      </div>
      <div class="stat red" *ngIf="facts?.cheapest_month">
        <div class="label">Cheapest month</div>
        <div class="value" style="font-size: 1rem">{{ monthLabel(facts!.cheapest_month!.month) }}</div>
        <div class="hint">{{ fmt(facts!.cheapest_month!.expenses) }} total</div>
      </div>
    </div>

    <div class="card" *ngIf="anomalies.length || overBudget.length || priceChanges.length">
      <h3>Needs attention</h3>
      <div class="attention-row" *ngFor="let a of anomalies">
        <span class="dot" [style.background]="a.color"></span>
        <span><strong>{{ a.name }}</strong> is {{ a.change_pct | number:'1.0-0' }}% above its average
          ({{ fmt(a.current) }} vs avg {{ fmt(a.average) }})</span>
      </div>
      <div class="attention-row" *ngFor="let b of overBudget">
        <span class="dot" [style.background]="b.color"></span>
        <span><strong>{{ b.name }}</strong> is over budget: {{ fmt(b.spent) }} of {{ fmt(b.budget) }}</span>
      </div>
      <div class="attention-row" *ngFor="let p of priceChanges">
        <span class="dot" style="background: #fbbf24"></span>
        <span><strong>{{ p.establishment }}</strong> amount varies between {{ fmt(p.min_amount) }} and {{ fmt(p.max_amount) }}</span>
      </div>
      <p class="muted" *ngIf="!anomalies.length && !overBudget.length && !priceChanges.length">All clear — nothing unusual this month.</p>
    </div>

    <div class="grid-2">
      <div class="card" *ngIf="movers.length">
        <h3>Top movers vs last month</h3>
        <div class="attention-row" *ngFor="let m of movers">
          <span class="dot" [style.background]="m.color"></span>
          <span style="flex: 1">{{ m.name }}</span>
          <span [class.negative]="m.delta > 0" [class.positive]="m.delta <= 0">
            {{ m.delta > 0 ? '+' : '' }}{{ fmt(m.delta) }}
          </span>
        </div>
      </div>
      <div class="card" *ngIf="facts?.most_frequent_merchant || facts?.average_ticket">
        <h3>Did you know</h3>
        <p *ngIf="facts?.most_frequent_merchant">
          Your most frequent merchant is <strong>{{ facts!.most_frequent_merchant!.establishment }}</strong>
          ({{ facts!.most_frequent_merchant!.count }} purchases).
        </p>
        <p *ngIf="facts?.average_ticket">Your average ticket is <strong>{{ fmt(facts!.average_ticket!) }}</strong>.</p>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>Weekly digest
          <input type="week" class="week-input" [(ngModel)]="weekInput" (ngModelChange)="loadWeekly()">
        </h3>
        <ng-container *ngIf="weekly">
          <p><strong>{{ fmt(weekly.expenses) }}</strong> in {{ weekly.count }} transactions
            <span class="muted">({{ weekly.from | date:'dd/MM' }} – {{ weekly.to | date:'dd/MM' }})</span></p>
          <div class="budget-row" *ngFor="let c of weekly.categories">
            <div class="budget-head">
              <span><span class="dot" [style.background]="c.color"></span>{{ c.category }}</span>
              <span class="muted">{{ fmt(c.total) }}</span>
            </div>
          </div>
          <p class="muted" *ngIf="weekly.biggest?.length" style="margin-top: 0.6rem">Biggest: {{ weekly.biggest[0].establishment }} ({{ fmt(weekly.biggest[0].amount) }})</p>
        </ng-container>
      </div>
      <div class="card">
        <h3>Subscription audit</h3>
        <p class="muted" style="margin-top: 0">Monthly commitment: <strong>{{ fmt(subscriptionTotal) }}</strong></p>
        <div class="sub-row" *ngFor="let r of recurring">
          <span style="flex: 1">{{ r.establishment }} <span class="muted">({{ fmt(r.avg_amount) }}/mo)</span></span>
          <button class="chip" [class.active]="subStatus(r.establishment) === 'keep'" (click)="setSubStatus(r.establishment, 'keep')">keep</button>
          <button class="chip" [class.active]="subStatus(r.establishment) === 'review'" (click)="setSubStatus(r.establishment, 'review')">review</button>
          <button class="chip" [class.active]="subStatus(r.establishment) === 'cancel'" (click)="setSubStatus(r.establishment, 'cancel')">cancel</button>
        </div>
        <p class="muted" *ngIf="!recurring.length">No recurring expenses detected (need 3+ months of data).</p>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>Due-date calendar
          <input type="month" class="week-input" [(ngModel)]="calendarMonth" (ngModelChange)="buildCalendar()">
        </h3>
        <div class="calendar-grid">
          <div class="muted" style="text-align: center; font-size: 0.72rem" *ngFor="let d of weekdayLabels">{{ d }}</div>
          <div class="calendar-cell" *ngFor="let c of calendar" [class.other]="c.other">
            <div class="day">{{ c.date }}</div>
            <div class="calendar-event" *ngFor="let e of c.events" [class.paid]="e.cls === 'paid'" [class.overdue]="e.cls === 'overdue'" [class.recurring]="e.cls === 'recurring'">
              {{ e.label }}
            </div>
          </div>
        </div>
      </div>
      <div class="card">
        <h3>Seasonality <span class="muted" style="font-weight: 400; font-size: 0.8rem">(avg by month of year)</span></h3>
        <div class="season-row" *ngFor="let s of seasonality">
          <span style="width: 90px"><span class="dot" [style.background]="s.color"></span>{{ s.name }}</span>
          <div class="season-bars">
            <div class="season-bar" *ngFor="let v of s.values" [style.height.%]="v.pct" [title]="v.label + ': ' + fmt(v.value)"></div>
          </div>
        </div>
        <p class="muted" *ngIf="!seasonality.length">Not enough history yet.</p>
      </div>
    </div>

    <div class="card" *ngIf="hourly.length">
      <h3>Weekday × hour heatmap</h3>
      <div class="hourly-grid">
        <span></span>
        <span class="muted" *ngFor="let h of hourLabels">{{ h }}</span>
        <ng-container *ngFor="let w of [1,2,3,4,5,6,7]">
          <span class="muted">{{ weekdayLabels[w-1] }}</span>
          <div class="hourly-cell" *ngFor="let h of hours" [style.opacity]="hourlyIntensity(w, h)"></div>
        </ng-container>
      </div>
    </div>
  `,
  styles: [`
    .attention-row { display: flex; align-items: center; gap: 0.6rem; padding: 0.35rem 0; font-size: 0.9rem; }
    .sub-row { display: flex; align-items: center; gap: 0.4rem; padding: 0.3rem 0; font-size: 0.88rem; }
    .week-input { float: right; padding: 0.2rem 0.4rem; min-width: 0; font-size: 0.8rem; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; color: var(--text); color-scheme: dark; }
    .season-row { display: flex; align-items: flex-end; gap: 0.6rem; margin-bottom: 0.6rem; font-size: 0.82rem; }
    .season-bars { display: flex; align-items: flex-end; gap: 2px; height: 44px; flex: 1; }
    .season-bar { flex: 1; background: var(--accent); border-radius: 2px; min-height: 2px; opacity: 0.85; }
    .hourly-grid { display: grid; grid-template-columns: 34px repeat(12, 1fr); gap: 3px; align-items: center; font-size: 0.68rem; }
    .hourly-cell { aspect-ratio: 1; background: #9b6bff; border-radius: 3px; min-height: 10px; }
  `],
})
export class InsightsComponent implements OnInit {
  private api = inject(ApiService);
  private settings = inject(SettingsService);

  question = '';
  answer = '';
  anomalies: Anomaly[] = [];
  priceChanges: PriceChange[] = [];
  overBudget: { name: string; color: string; budget: number; spent: number }[] = [];
  movers: { name: string; color: string; delta: number }[] = [];
  recurring: RecurringItem[] = [];
  subscriptionTotal = 0;
  facts: FunFacts | null = null;
  weekly: WeeklyDigest | null = null;
  weekInput = '';
  safeToSpend: number | null = null;
  projection: number | null = null;
  calendarMonth = new Date().toISOString().slice(0, 7);
  calendar: CalendarDay[] = [];
  seasonality: { name: string; color: string; values: { label: string; value: number; pct: number }[] }[] = [];
  hourly: { weekday: number; hour: number; total: number }[] = [];
  hours = Array.from({ length: 12 }, (_, i) => i * 2);
  hourLabels = this.hours.map((h) => `${h}h`);
  weekdayLabels = WEEKDAYS_PT;

  private subStatuses: Record<string, string> = {};

  ngOnInit(): void {
    try {
      this.subStatuses = JSON.parse(localStorage.getItem('finance-sub-status') || '{}');
    } catch { /* ignore */ }
    const now = new Date();
    this.weekInput = `${now.getFullYear()}-W${String(this.getISOWeek(now)).padStart(2, '0')}`;

    forkJoin({
      anomalies: this.api.anomalies(),
      priceChanges: this.api.priceChanges(),
      facts: this.api.funFacts(),
      recurring: this.api.recurring({}),
      budgets: this.api.budgetStatus(this.calendarMonth, {}),
      trend: this.api.budgetTrend({}, 13),
    }).subscribe(({ anomalies, priceChanges, facts, recurring, budgets, trend }) => {
      this.anomalies = anomalies;
      this.priceChanges = priceChanges;
      this.facts = facts;
      this.recurring = recurring.slice(0, 12);
      this.subscriptionTotal = recurring.reduce((acc, r) => acc + r.avg_amount, 0);
      this.overBudget = budgets.filter((b) => b.spent > b.budget);
      this.movers = this.computeMovers(trend);
      this.computeSafeToSpend(budgets);
      this.computeProjection();
      this.computeSeasonality(trend);
    });
    this.loadWeekly();
    this.buildCalendar();
    this.api.hourly().subscribe((h) => (this.hourly = h));
  }

  fmt(v: number): string {
    return this.settings.fmt(v);
  }

  monthLabel(month: string): string {
    const [y, m] = month.split('-').map(Number);
    return `${MONTHS_PT[m - 1]}/${y}`;
  }

  ask(): void {
    if (!this.question.trim()) return;
    this.api.query(this.question).subscribe((r) => (this.answer = r.answer));
  }

  loadWeekly(): void {
    this.api.weekly(this.weekInput || undefined).subscribe((w) => (this.weekly = w));
  }

  subStatus(establishment: string): string {
    return this.subStatuses[establishment] ?? 'keep';
  }

  setSubStatus(establishment: string, status: string): void {
    this.subStatuses = { ...this.subStatuses, [establishment]: status };
    localStorage.setItem('finance-sub-status', JSON.stringify(this.subStatuses));
  }

  buildCalendar(): void {
    forkJoin({
      invoices: this.api.invoices(),
      totals: this.api.invoiceTotals({}),
      recurring: this.api.recurring({}),
    }).subscribe(({ invoices, totals, recurring }) => {
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
          events.push({
            label: `Fatura ${this.fmt(total?.expenses ?? 0)}`,
            cls: inv.paid ? 'paid' : overdue ? 'overdue' : '',
          });
        }
        for (const r of recurring) {
          // crude: show recurring charges around the day of month they most often occur
          if (r.establishment && d.getDate() === 5) {
            events.push({ label: r.establishment, cls: 'recurring' });
          }
        }
        cells.push({ date: d.getDate(), iso, other: d.getMonth() !== m - 1, events });
      }
      this.calendar = cells;
    });
  }

  private computeMovers(trend: TrendPoint[]): { name: string; color: string; delta: number }[] {
    const byCat = new Map<number, { name: string; color: string; points: Map<string, number> }>();
    for (const p of trend) {
      if (!byCat.has(p.category_id)) byCat.set(p.category_id, { name: p.name, color: p.color, points: new Map() });
      byCat.get(p.category_id)!.points.set(p.month, p.spent);
    }
    const now = new Date();
    const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prevD = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prev = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, '0')}`;
    const movers: { name: string; color: string; delta: number }[] = [];
    for (const c of byCat.values()) {
      const cur = c.points.get(current) ?? 0;
      const prv = c.points.get(prev) ?? 0;
      if (cur > 0 && prv > 0) movers.push({ name: c.name, color: c.color, delta: cur - prv });
    }
    return movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5);
  }

  private computeSafeToSpend(budgets: { budget: number; spent: number }[]): void {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const left = daysInMonth - now.getDate();
    const remaining = budgets.reduce((acc, b) => acc + Math.max(0, b.budget - b.spent), 0);
    this.safeToSpend = left > 0 ? remaining / left : remaining;
  }

  private computeProjection(): void {
    this.api.monthly({}).subscribe((points) => {
      const now = new Date();
      const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const day = now.getDate();
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const cur = points.find((p) => p.month === current);
      if (cur && day > 0) {
        this.projection = (cur.expenses / day) * daysInMonth;
      }
    });
  }

  private computeSeasonality(trend: TrendPoint[]): void {
    const byCat = new Map<number, { name: string; color: string; byMonth: Map<number, number[]> }>();
    for (const p of trend) {
      if (!byCat.has(p.category_id)) byCat.set(p.category_id, { name: p.name, color: p.color, byMonth: new Map() });
      const monthNum = Number(p.month.split('-')[1]);
      const entry = byCat.get(p.category_id)!;
      if (!entry.byMonth.has(monthNum)) entry.byMonth.set(monthNum, []);
      entry.byMonth.get(monthNum)!.push(p.spent);
    }
    const result: typeof this.seasonality = [];
    for (const c of byCat.values()) {
      const values = Array.from({ length: 12 }, (_, i) => {
        const arr = c.byMonth.get(i + 1) ?? [];
        const avg = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        return { label: MONTHS_PT[i], value: avg, pct: 0 };
      });
      const max = Math.max(...values.map((v) => v.value), 1);
      for (const v of values) v.pct = (v.value / max) * 100;
      result.push({ name: c.name, color: c.color, values });
    }
    this.seasonality = result.sort((a, b) =>
      Math.max(...b.values.map((v) => v.value)) - Math.max(...a.values.map((v) => v.value)),
    ).slice(0, 8);
  }

  hourlyIntensity(weekday: number, hour: number): number {
    const cell = this.hourly.find((c) => c.weekday === weekday && c.hour >= hour && c.hour < hour + 2);
    if (!cell) return 0.04;
    const max = Math.max(...this.hourly.map((c) => c.total), 1);
    return 0.15 + (cell.total / max) * 0.85;
  }

  private getISOWeek(d: Date): number {
    const date = new Date(d.getTime());
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
    const week1 = new Date(date.getFullYear(), 0, 4);
    return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  }
}
