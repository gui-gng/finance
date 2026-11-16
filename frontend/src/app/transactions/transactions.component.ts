import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ApiService, Category, Filters, Parcel, Transaction } from '../api.service';
import { FiltersComponent } from '../filters/filters.component';
import { SettingsService } from '../services/settings.service';
import { ToastService } from '../services/toast.service';
import { AuthService } from '../services/auth.service';

interface SavedView { name: string; filters: Filters }

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [CommonModule, FormsModule, FiltersComponent],
  template: `
    <h1 class="page-title">Transactions</h1>
    <p class="page-sub">{{ total }} transaction(s) found</p>

    <app-filters [showSearch]="true" (changed)="onFilters($event)" />

    <div class="card toolbar">
      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center">
        <button class="ghost" (click)="showAdd = !showAdd">+ Add</button>
        <button class="ghost" (click)="exportCsv()">Export CSV</button>
        <button class="ghost" (click)="showDuplicates = !showDuplicates" [class.warn-btn]="duplicates.length">Duplicates{{ duplicates.length ? ' (' + duplicates.length + ')' : '' }}</button>
        <label class="mini-check"><input type="checkbox" [(ngModel)]="hideInternal" (change)="load()"> hide internal transfers</label>
        <label class="mini-check"><input type="checkbox" [(ngModel)]="showExcluded" (change)="load()"> show excluded</label>
        <span style="flex: 1"></span>
        <select [(ngModel)]="pageSize" (ngModelChange)="onFilters(filters)" style="min-width: 0">
          <option [ngValue]="50">50 / page</option>
          <option [ngValue]="100">100 / page</option>
          <option [ngValue]="500">500 / page</option>
        </select>
      </div>
      <div style="display: flex; gap: 0.5rem; margin-top: 0.6rem; align-items: center; flex-wrap: wrap">
        <input type="text" [(ngModel)]="newViewName" placeholder="Save current view as…" style="min-width: 200px">
        <button class="ghost" (click)="saveView()" [disabled]="!newViewName">Save view</button>
        <select [ngModel]="''" (ngModelChange)="applyView($event)" style="min-width: 160px">
          <option value="">Saved views…</option>
          <option *ngFor="let v of savedViews" [ngValue]="v.name">{{ v.name }}</option>
        </select>
        <ng-container *ngIf="selected.size">
          <span class="muted">{{ selected.size }} selected</span>
          <select [ngModel]="''" (ngModelChange)="bulkCategorize($event)" style="min-width: 160px">
            <option value="">Set category…</option>
            <option *ngFor="let c of categories" [ngValue]="c.id">{{ c.name }}</option>
          </select>
          <button class="ghost" (click)="clearSelection()">Clear</button>
        </ng-container>
      </div>
    </div>

    <div class="card" *ngIf="showAdd">
      <h3>Add transaction</h3>
      <div class="add-form">
        <input type="date" [(ngModel)]="addForm.date">
        <input type="text" [(ngModel)]="addForm.establishment" placeholder="Establishment">
        <input type="number" [(ngModel)]="addForm.amount" placeholder="Amount" step="0.01">
        <input type="text" [(ngModel)]="addForm.holder" placeholder="Holder">
        <select [(ngModel)]="addForm.category_id">
          <option [ngValue]="null">No category</option>
          <option *ngFor="let c of categories" [ngValue]="c.id">{{ c.name }}</option>
        </select>
        <input type="number" [(ngModel)]="addForm.installments" placeholder="Installments" min="1" title="Installments">
        <input type="text" [(ngModel)]="addForm.note" placeholder="Note">
        <input type="text" [(ngModel)]="addForm.tagsText" placeholder="tags, comma, separated">
        <label class="mini-check"><input type="checkbox" [(ngModel)]="addForm.income"> income</label>
        <button (click)="add()" [disabled]="!addForm.date || !addForm.establishment || !addForm.amount">Add</button>
      </div>
    </div>

    <div class="card" *ngIf="showDuplicates">
      <h3>Possible duplicates <button class="ghost" style="float: right; font-size: 0.75rem" (click)="loadDuplicates()">refresh</button></h3>
      <p class="muted" *ngIf="!duplicates.length">No duplicates found.</p>
      <div class="sub-row" *ngFor="let d of duplicates">
        <span style="flex: 1">{{ d.date | date:'dd/MM/yyyy' }} — {{ d.establishment }} — {{ fmt(d.amount) }}</span>
        <span class="muted">ids {{ d.a_id }} / {{ d.b_id }}{{ d.same_import ? ' (same import)' : '' }}</span>
        <button class="ghost danger" (click)="deleteDuplicate(d.b_id)">delete #{{ d.b_id }}</button>
      </div>
    </div>

    <div class="card" *ngIf="splitFor">
      <h3>Split {{ fmt(splitFor.amount) }} — {{ splitFor.establishment }}</h3>
      <div class="sub-row" *ngFor="let s of splitParts; let i = index">
        <select [(ngModel)]="s.category_id" style="min-width: 150px">
          <option [ngValue]="null">No category</option>
          <option *ngFor="let c of categories" [ngValue]="c.id">{{ c.name }}</option>
        </select>
        <input type="number" [(ngModel)]="s.amount" placeholder="Amount" step="0.01">
        <input type="text" [(ngModel)]="s.note" placeholder="Note (optional)">
        <button class="ghost danger" (click)="splitParts.splice(i, 1)" *ngIf="splitParts.length > 2">✕</button>
      </div>
      <p class="muted">Total: {{ fmt(splitTotal) }} of {{ fmt(splitFor.amount) }}</p>
      <div style="display: flex; gap: 0.5rem">
        <button class="ghost" (click)="splitParts.push({})" [disabled]="splitParts.length >= 6">+ part</button>
        <button (click)="doSplit()" [disabled]="Math.abs(splitTotal - Math.abs(splitFor.amount)) > 0.02">Split</button>
        <button class="ghost" (click)="splitFor = null">Cancel</button>
      </div>
    </div>

    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" [checked]="allSelected" (change)="toggleAll()"></th>
              <th>Date</th><th>Establishment</th><th>Category</th><th>Holder</th>
              <th>Installment</th><th>Type</th><th>Tags</th><th class="num">Amount</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let t of transactions" [class.excluded-row]="t.excluded">
              <td><input type="checkbox" [checked]="selected.has(t.id)" (change)="toggleOne(t.id)"></td>
              <td class="muted">{{ formatDate(t.date) }}</td>
              <td>
                {{ t.establishment }}
                <span class="muted" *ngIf="t.note" [title]="t.note"> 📝</span>
                <a class="muted" *ngIf="t.has_receipt" style="cursor: pointer" (click)="openReceipt(t)" title="receipt"> 📎</a>
              </td>
              <td (click)="editCategory(t)" style="cursor: pointer" title="click to change">
                <select *ngIf="editing === t.id; else catLabel" [(ngModel)]="editCategoryId" (change)="saveCategory(t)" (blur)="editing = 0">
                  <option [ngValue]="null">—</option>
                  <option *ngFor="let c of categories" [ngValue]="c.id">{{ c.name }}</option>
                </select>
                <ng-template #catLabel>
                  <span class="pill cat" *ngIf="t.category_name" [style.color]="t.category_color" [style.background]="(t.category_color || '') + '22'">{{ t.category_name }}</span>
                  <span class="muted" *ngIf="!t.category_name">—</span>
                </ng-template>
              </td>
              <td><span class="pill neutral" *ngIf="t.holder">{{ t.holder }}</span></td>
              <td class="muted">
                <a *ngIf="t.installment_total && t.installment_total > 1; else noInst"
                  style="cursor: pointer" (click)="showPlan(t)" title="view installment plan">
                  {{ t.installment_number }} de {{ t.installment_total }}
                </a>
                <ng-template #noInst>—</ng-template>
              </td>
              <td>
                <span class="pill" [class.expense]="t.amount > 0 && !t.income" [class.payment]="t.amount < 0 && !t.income" [class.neutral]="t.income">
                  {{ t.income ? 'income' : t.amount > 0 ? 'expense' : 'payment' }}
                </span>
              </td>
              <td class="muted" style="font-size: 0.75rem">{{ (t.tags || []).join(', ') }}</td>
              <td class="num" [class.negative]="t.amount > 0 && !t.income" [class.positive]="t.amount < 0">
                {{ t.original_amount && t.currency !== 'BRL' ? fmt(t.original_amount) + ' ' + t.currency + ' (' + fmt(t.amount) + ')' : fmt(t.amount) }}
              </td>
              <td class="actions">
                <button class="ghost" (click)="startSplit(t)" title="split">⫚</button>
                <button class="ghost" (click)="toggleExcluded(t)" [class.warn-btn]="t.excluded" title="exclude/include from reports">{{ t.excluded ? '⊘' : '⊚' }}</button>
                <label class="ghost upload-btn" title="attach receipt">
                  📎
                  <input type="file" hidden (change)="uploadReceipt(t, $event)">
                </label>
                <button class="ghost danger" (click)="remove(t)" title="delete">✕</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="empty-state" *ngIf="!transactions.length">
        <div class="big">🧾</div>
        <p>No transactions found. <a routerLink="/import">Import a statement</a> or add one manually above.</p>
      </div>

      <div class="card" *ngIf="planTx" style="margin-top: 1rem">
        <h3>Installment plan — {{ planTx.establishment }}
          <button class="ghost" style="float: right; font-size: 0.75rem" (click)="planTx = null">close</button>
        </h3>
        <div class="plan-grid">
          <div class="plan-parcel" *ngFor="let p of parcels" [class.past]="p.past">
            <div class="muted" style="font-size: 0.7rem">{{ p.date | date:'MMM yy':'':'pt-BR' }}</div>
            <div style="font-weight: 600; font-size: 0.82rem">{{ p.installment_number }}/{{ p.installment_total }}</div>
            <div style="font-size: 0.8rem">{{ fmt(p.amount) }}</div>
          </div>
        </div>
      </div>

      <div class="pager" *ngIf="total > pageSize">
        <button class="ghost" (click)="prev()" [disabled]="offset === 0">← Prev</button>
        <span class="muted">Page {{ page }} of {{ pages }}</span>
        <button class="ghost" (click)="next()" [disabled]="offset + pageSize >= total">Next →</button>
      </div>
    </div>
  `,
  styles: [`
    .toolbar { padding: 0.9rem 1.4rem; }
    .add-form { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
    .add-form input, .add-form select { min-width: 120px; }
    .mini-check { display: flex; align-items: center; gap: 0.35rem; margin: 0; text-transform: none; letter-spacing: 0; color: var(--muted); font-size: 0.85rem; }
    .sub-row { display: flex; align-items: center; gap: 0.6rem; padding: 0.3rem 0; font-size: 0.88rem; flex-wrap: wrap; }
    .actions { white-space: nowrap; }
    .actions button, .upload-btn { padding: 0.15rem 0.45rem; font-size: 0.8rem; cursor: pointer; border-radius: 6px; }
    .upload-btn { display: inline-flex; align-items: center; }
    .warn-btn { color: #fbbf24 !important; }
    .excluded-row { opacity: 0.45; }
    .plan-grid { display: flex; gap: 0.4rem; flex-wrap: wrap; }
    .plan-parcel { border: 1px solid var(--border); border-radius: 8px; padding: 0.4rem 0.6rem; text-align: center; min-width: 74px; }
    .plan-parcel.past { background: var(--green-soft); }
  `],
})
export class TransactionsComponent implements OnInit {
  private api = inject(ApiService);
  private settings = inject(SettingsService);
  private toasts = inject(ToastService);
  private auth = inject(AuthService);

  transactions: Transaction[] = [];
  categories: Category[] = [];
  duplicates: { a_id: number; b_id: number; date: string; establishment: string; amount: number; same_import: boolean }[] = [];
  total = 0;
  pageSize = 50;
  offset = 0;
  filters: Filters = {};
  selected = new Set<number>();
  showAdd = false;
  showDuplicates = false;
  hideInternal = false;
  showExcluded = false;
  editing = 0;
  editCategoryId: number | null = null;
  splitFor: Transaction | null = null;
  splitParts: { category_id?: number | null; amount?: number; note?: string }[] = [{}, {}];
  planTx: Transaction | null = null;
  parcels: Parcel[] = [];
  savedViews: SavedView[] = [];
  newViewName = '';
  addForm = { date: new Date().toISOString().slice(0, 10), establishment: '', amount: 0, holder: '', category_id: null as number | null, installments: 1, note: '', tagsText: '', income: false };
  Math = Math;

  get page(): number { return Math.floor(this.offset / this.pageSize) + 1; }
  get pages(): number { return Math.max(1, Math.ceil(this.total / this.pageSize)); }
  get allSelected(): boolean { return this.transactions.length > 0 && this.transactions.every((t) => this.selected.has(t.id)); }
  get splitTotal(): number { return this.splitParts.reduce((a, p) => a + (p.amount || 0), 0); }

  ngOnInit(): void {
    this.api.categories().subscribe((c) => (this.categories = c));
    try {
      this.savedViews = JSON.parse(localStorage.getItem('finance-views') || '[]');
    } catch { /* ignore */ }
  }

  fmt(v: number): string { return this.settings.fmt(v); }

  onFilters(f: Filters): void {
    this.filters = f;
    this.offset = 0;
    this.load();
  }

  load(): void {
    const f: Filters = { ...this.filters, include_excluded: this.showExcluded };
    this.api.transactions(f, this.pageSize, this.offset).subscribe((res) => {
      this.transactions = res.items;
      this.total = res.total;
      if (this.hideInternal) {
        this.transactions = this.transactions.filter((t) => !(t.amount < 0 || t.category_name === 'Pagamento fatura'));
      }
    });
  }

  prev(): void { this.offset = Math.max(0, this.offset - this.pageSize); this.load(); }
  next(): void { this.offset += this.pageSize; this.load(); }
  formatDate(iso: string): string { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }

  toggleAll(): void {
    if (this.allSelected) this.selected.clear();
    else this.transactions.forEach((t) => this.selected.add(t.id));
  }

  toggleOne(id: number): void {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
  }

  clearSelection(): void { this.selected.clear(); }

  bulkCategorize(categoryId: number | string): void {
    if (!categoryId) return;
    const ids = [...this.selected];
    this.api.bulkCategory(ids, Number(categoryId)).subscribe((r) => {
      this.toasts.show(`Updated ${r.updated} transactions`);
      this.selected.clear();
      this.load();
    });
  }

  editCategory(t: Transaction): void {
    this.editing = t.id;
    this.editCategoryId = t.category_id ?? null;
  }

  saveCategory(t: Transaction): void {
    this.api.updateTransaction(t.id, { category_id: this.editCategoryId }).subscribe(() => {
      this.editing = 0;
      this.load();
    });
  }

  add(): void {
    this.api.createTransaction({
      date: this.addForm.date,
      establishment: this.addForm.establishment,
      amount: this.addForm.amount,
      holder: this.addForm.holder,
      category_id: this.addForm.category_id ?? undefined,
      installments: this.addForm.installments || 1,
      note: this.addForm.note,
      tags: this.addForm.tagsText.split(',').map((s) => s.trim()).filter(Boolean),
      income: this.addForm.income,
    }).subscribe((r) => {
      this.toasts.show(`Added ${r.created.length} transaction(s)`);
      this.addForm = { ...this.addForm, establishment: '', amount: 0, note: '', tagsText: '', income: false };
      this.load();
    });
  }

  startSplit(t: Transaction): void {
    this.splitFor = t;
    this.splitParts = [{}, {}];
  }

  doSplit(): void {
    if (!this.splitFor) return;
    this.api.splitTransaction(this.splitFor.id, this.splitParts.map((p) => ({
      category_id: p.category_id ?? undefined,
      amount: p.amount || 0,
      note: p.note,
    }))).subscribe(() => {
      this.toasts.show('Transaction split');
      this.splitFor = null;
      this.load();
    });
  }

  toggleExcluded(t: Transaction): void {
    const label = t.excluded ? 'Include in reports' : 'Exclude from reports';
    this.api.updateTransaction(t.id, { excluded: !t.excluded }).subscribe(() => {
      this.toasts.show(`${label}: ${t.establishment}`, {
        label: 'Undo',
        run: () => this.api.updateTransaction(t.id, { excluded: !!t.excluded }).subscribe(() => this.load()),
      });
      this.load();
    });
  }

  remove(t: Transaction): void {
    this.api.deleteTransaction(t.id).subscribe(() => {
      this.toasts.show(`Deleted ${t.establishment}`, {
        label: 'Undo (re-add manually)',
        run: () => this.api.createTransaction({ date: t.date, establishment: t.establishment, amount: t.amount, holder: t.holder, category_id: t.category_id, note: t.note, tags: t.tags }).subscribe(() => this.load()),
      });
      this.load();
    });
  }

  uploadReceipt(t: Transaction, e: Event): void {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.api.uploadReceipt(t.id, file).subscribe(() => {
      this.toasts.show('Receipt attached');
      this.load();
    });
  }

  openReceipt(t: Transaction): void {
    fetch(this.api.receiptUrl(t.id), { headers: { Authorization: `Bearer ${this.auth.token ?? ''}` } })
      .then((r) => r.blob())
      .then((blob) => window.open(URL.createObjectURL(blob), '_blank'));
  }

  showPlan(t: Transaction): void {
    this.planTx = t;
    this.api.installmentPlan(t.id).subscribe((p) => (this.parcels = p));
  }

  loadDuplicates(): void {
    this.api.duplicates().subscribe((d) => (this.duplicates = d));
  }

  deleteDuplicate(id: number): void {
    this.api.deleteTransaction(id).subscribe(() => this.loadDuplicates());
  }

  exportCsv(): void {
    const f: Filters = { ...this.filters, include_excluded: this.showExcluded };
    const url = `${this.api.exportUrl(f)}`;
    fetch(url, { headers: { Authorization: `Bearer ${this.auth.token ?? ''}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'transactions.csv';
        a.click();
        URL.revokeObjectURL(a.href);
      });
  }

  saveView(): void {
    this.savedViews = [...this.savedViews.filter((v) => v.name !== this.newViewName), { name: this.newViewName, filters: this.filters }];
    localStorage.setItem('finance-views', JSON.stringify(this.savedViews));
    this.newViewName = '';
    this.toasts.show('View saved');
  }

  applyView(name: string): void {
    const view = this.savedViews.find((v) => v.name === name);
    if (view) {
      this.onFilters(view.filters);
      this.toasts.show(`View "${name}" applied`);
    }
  }
}
