import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ApiService, Filters, Transaction } from '../api.service';
import { FiltersComponent } from '../filters/filters.component';

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [CommonModule, FormsModule, FiltersComponent],
  template: `
    <h1 class="page-title">Transactions</h1>
    <p class="page-sub">{{ total }} transaction(s) found</p>

    <app-filters [showSearch]="true" (changed)="onFilters($event)" />

    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Establishment</th>
              <th>Category</th>
              <th>Holder</th>
              <th>Installment</th>
              <th>Type</th>
              <th class="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let t of transactions">
              <td class="muted">{{ formatDate(t.date) }}</td>
              <td>{{ t.establishment }}</td>
              <td>
                <span class="pill cat" *ngIf="t.category_name"
                  [style.color]="t.category_color"
                  [style.background]="t.category_color + '22'">{{ t.category_name }}</span>
                <span class="muted" *ngIf="!t.category_name">—</span>
              </td>
              <td><span class="pill neutral" *ngIf="t.holder">{{ t.holder }}</span></td>
              <td class="muted">{{ t.installment_number ? t.installment_number + ' de ' + t.installment_total : '—' }}</td>
              <td>
                <span class="pill" [class.expense]="t.amount > 0" [class.payment]="t.amount < 0">
                  {{ t.amount > 0 ? 'expense' : 'payment' }}
                </span>
              </td>
              <td class="num" [class.negative]="t.amount > 0" [class.positive]="t.amount < 0">
                {{ t.amount | currency:'BRL':'symbol':'1.2-2':'pt-BR' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="muted" *ngIf="!transactions.length" style="margin: 1rem 0 0">No transactions found. Try importing some files first.</p>

      <div class="pager" *ngIf="total > pageSize">
        <button class="ghost" (click)="prev()" [disabled]="offset === 0">← Prev</button>
        <span class="muted">Page {{ page }} of {{ pages }}</span>
        <button class="ghost" (click)="next()" [disabled]="offset + pageSize >= total">Next →</button>
      </div>
    </div>
  `,
})
export class TransactionsComponent {
  private api = inject(ApiService);

  transactions: Transaction[] = [];
  total = 0;
  pageSize = 50;
  offset = 0;
  private filters: Filters = {};

  get page(): number {
    return Math.floor(this.offset / this.pageSize) + 1;
  }

  get pages(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  onFilters(f: Filters): void {
    this.filters = f;
    this.offset = 0;
    this.load();
  }

  prev(): void {
    this.offset = Math.max(0, this.offset - this.pageSize);
    this.load();
  }

  next(): void {
    this.offset += this.pageSize;
    this.load();
  }

  formatDate(iso: string): string {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  private load(): void {
    this.api.transactions(this.filters, this.pageSize, this.offset).subscribe((res) => {
      this.transactions = res.items;
      this.total = res.total;
    });
  }
}
