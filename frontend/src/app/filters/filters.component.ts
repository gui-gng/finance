import { Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';

import { ApiService, Category, Filters, Invoice, Person, Source } from '../api.service';

const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

interface MonthOption {
  value: string;
  label: string;
}

@Component({
  selector: 'app-filters',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="card">
      <div class="filters">
        <div>
          <label>Person</label>
          <select [(ngModel)]="personId" (ngModelChange)="onScopeChange()">
            <option [ngValue]="0">All</option>
            <option *ngFor="let p of people" [ngValue]="p.id">{{ p.name }}</option>
          </select>
        </div>
        <div>
          <label>Source</label>
          <select [(ngModel)]="sourceId" (ngModelChange)="onScopeChange()">
            <option [ngValue]="0">All</option>
            <option *ngFor="let s of sources" [ngValue]="s.id">{{ s.name }}</option>
          </select>
        </div>
        <div>
          <label>Invoice</label>
          <select [(ngModel)]="importId" (ngModelChange)="emit()">
            <option [ngValue]="0">All</option>
            <option *ngFor="let i of visibleInvoices" [ngValue]="i.id">{{ i.name }}</option>
          </select>
        </div>
        <div>
          <label>Category</label>
          <select [(ngModel)]="categoryId" (ngModelChange)="emit()">
            <option [ngValue]="0">All</option>
            <option [ngValue]="-1">Uncategorized</option>
            <option *ngFor="let c of categories" [ngValue]="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div>
          <label>Holder</label>
          <select [(ngModel)]="holder" (ngModelChange)="emit()">
            <option value="">All</option>
            <option *ngFor="let h of holders" [value]="h">{{ h }}</option>
          </select>
        </div>
        <div>
          <label>Type</label>
          <select [(ngModel)]="type" (ngModelChange)="emit()">
            <option value="">All</option>
            <option value="expense">Expenses</option>
            <option value="payment">Payments</option>
          </select>
        </div>
        <div *ngIf="showSearch">
          <label>Search</label>
          <input type="text" [(ngModel)]="search" (ngModelChange)="emit()" placeholder="establishment...">
        </div>
        <div>
          <label>From</label>
          <select [(ngModel)]="fromMonth" (ngModelChange)="onRangeChange()">
            <option value="">Any</option>
            <option *ngFor="let m of months" [value]="m.value">{{ m.label }}</option>
          </select>
        </div>
        <div>
          <label>To</label>
          <select [(ngModel)]="toMonth" (ngModelChange)="onRangeChange()">
            <option value="">Any</option>
            <option *ngFor="let m of months" [value]="m.value">{{ m.label }}</option>
          </select>
        </div>
      </div>
      <div class="filter-presets">
        <button class="chip" [class.active]="preset === 'all'" (click)="applyPreset('all')">All time</button>
        <button class="chip" [class.active]="preset === 'year'" (click)="applyPreset('year')">This year</button>
        <button class="chip" [class.active]="preset === '6m'" (click)="applyPreset('6m')">Last 6 months</button>
        <button class="chip" [class.active]="preset === '12m'" (click)="applyPreset('12m')">Last 12 months</button>
        <button class="chip" [class.active]="preset === 'custom'" *ngIf="preset === 'custom'">Custom</button>
      </div>
    </div>
  `,
})
export class FiltersComponent implements OnInit {
  private api = inject(ApiService);

  @Input() showSearch = false;
  @Output() changed = new EventEmitter<Filters>();

  people: Person[] = [];
  sources: Source[] = [];
  holders: string[] = [];
  invoices: Invoice[] = [];
  categories: Category[] = [];
  months: MonthOption[] = [];

  personId = 0;
  sourceId = 0;
  importId = 0;
  categoryId = 0;
  holder = '';
  type = '';
  search = '';
  fromMonth = '';
  toMonth = '';
  preset = 'all';

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  get visibleInvoices(): Invoice[] {
    return this.invoices.filter(
      (i) =>
        (!this.personId || i.person_id === this.personId) &&
        (!this.sourceId || i.source_id === this.sourceId)
    );
  }

  ngOnInit(): void {
    forkJoin({
      people: this.api.people(),
      sources: this.api.sources(),
      holders: this.api.holders(),
      invoices: this.api.invoices(),
      categories: this.api.categories(),
    }).subscribe(({ people, sources, holders, invoices, categories }) => {
      this.people = people;
      this.sources = sources;
      this.holders = holders;
      this.invoices = invoices;
      this.categories = categories;
    });
    this.months = this.buildMonths();
    queueMicrotask(() => this.emit());
  }

  onScopeChange(): void {
    if (this.importId && !this.visibleInvoices.some((i) => i.id === this.importId)) {
      this.importId = 0;
    }
    this.emit();
  }

  private buildMonths(): MonthOption[] {
    const options: MonthOption[] = [];
    const now = new Date();
    const start = new Date(2024, 0, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 6, 1);
    for (let d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) {
      const y = d.getFullYear();
      const m = d.getMonth();
      options.push({
        value: `${y}-${String(m + 1).padStart(2, '0')}`,
        label: `${MONTHS_PT[m]}/${y}`,
      });
    }
    return options;
  }

  onRangeChange(): void {
    this.preset = 'custom';
    this.emit();
  }

  applyPreset(p: string): void {
    this.preset = p;
    const now = new Date();
    const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const shift = (months: number): string => {
      const d = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };
    switch (p) {
      case 'all':
        this.fromMonth = '';
        this.toMonth = '';
        break;
      case 'year':
        this.fromMonth = `${now.getFullYear()}-01`;
        this.toMonth = current;
        break;
      case '6m':
        this.fromMonth = shift(6);
        this.toMonth = current;
        break;
      case '12m':
        this.fromMonth = shift(12);
        this.toMonth = current;
        break;
    }
    this.emit();
  }

  emit(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.changed.emit({
        person_id: this.personId || undefined,
        source_id: this.sourceId || undefined,
        import_id: this.importId || undefined,
        category_id: this.categoryId === -1 ? 'none' : this.categoryId || undefined,
        holder: this.holder || undefined,
        type: this.type || undefined,
        search: this.search || undefined,
        from: this.fromMonth ? `${this.fromMonth}-01` : undefined,
        to: this.toMonth ? this.endOfMonth(this.toMonth) : undefined,
      });
    }, 200);
  }

  private endOfMonth(month: string): string {
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return `${month}-${String(lastDay).padStart(2, '0')}`;
  }
}
