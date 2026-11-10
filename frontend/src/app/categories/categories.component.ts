import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ApiService, Category } from '../api.service';

@Component({
  selector: 'app-categories',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <h1 class="page-title">Categories</h1>
    <p class="page-sub">Rules match establishments automatically on import (case-insensitive contains)</p>

    <div class="card">
      <h3>New category</h3>
      <div class="filters">
        <div>
          <label>Name</label>
          <input type="text" [(ngModel)]="newName" placeholder="e.g. Pets">
        </div>
        <div>
          <label>Color</label>
          <input type="color" [(ngModel)]="newColor" class="color-input">
        </div>
        <div>
          <label>&nbsp;</label>
          <button (click)="addCategory()" [disabled]="!newName">Add category</button>
        </div>
      </div>
    </div>

    <div class="card" *ngIf="uncategorized !== null">
      <h3>Categorization status</h3>
      <p>
        <span [class.error]="uncategorized > 0" [class.success]="uncategorized === 0">
          {{ uncategorized }} transaction(s) without category
        </span>
        <button class="ghost" style="margin-left: 1rem" (click)="recategorize()" [disabled]="busy">
          {{ busy ? 'Running...' : 'Re-apply rules' }}
        </button>
      </p>
    </div>

    <div class="card" *ngFor="let c of categories">
      <div class="cat-head">
        <h3 style="margin: 0"><span class="dot" [style.background]="c.color"></span>{{ c.name }}</h3>
        <button class="ghost danger" (click)="removeCategory(c)">Delete</button>
      </div>

      <div class="rules">
        <span class="rule-chip" *ngFor="let r of c.rules">
          {{ r.pattern }}
          <button class="rule-x" (click)="removeRule(r.id)" title="Remove rule">×</button>
        </span>
        <span class="muted" *ngIf="!c.rules.length">No rules — transactions won't match automatically.</span>
      </div>

      <div class="filters" style="margin-top: 0.75rem">
        <div>
          <label>Add rule (pattern)</label>
          <input type="text" [(ngModel)]="newRule[c.id]" placeholder="e.g. IFOOD" (keyup.enter)="addRule(c)">
        </div>
        <div>
          <label>&nbsp;</label>
          <button class="ghost" (click)="addRule(c)" [disabled]="!newRule[c.id]">Add rule</button>
        </div>
        <div>
          <label>Monthly budget (R$)</label>
          <input type="text" inputmode="decimal" [ngModel]="budgetInput[c.id] ?? (c.budget ?? '')"
            (ngModelChange)="budgetInput[c.id] = $event" placeholder="0,00">
        </div>
        <div>
          <label>&nbsp;</label>
          <button class="ghost" (click)="saveBudget(c)">Save budget</button>
        </div>
      </div>
    </div>
  `,
})
export class CategoriesComponent implements OnInit {
  private api = inject(ApiService);

  categories: Category[] = [];
  newName = '';
  newColor = '#5b8cff';
  newRule: Record<number, string> = {};
  budgetInput: Record<number, string | undefined> = {};
  uncategorized: number | null = null;
  busy = false;

  ngOnInit(): void {
    this.reload();
  }

  private reload(): void {
    this.api.categories().subscribe((c) => (this.categories = c));
    this.api.transactions({ category_id: 'none' }, 1, 0).subscribe((page) => {
      this.uncategorized = page.total;
    });
  }

  addCategory(): void {
    this.api.createCategory(this.newName.trim(), this.newColor).subscribe(() => {
      this.newName = '';
      this.reload();
    });
  }

  removeCategory(c: Category): void {
    this.api.deleteCategory(c.id).subscribe(() => this.reload());
  }

  addRule(c: Category): void {
    const pattern = (this.newRule[c.id] ?? '').trim();
    if (!pattern) return;
    this.api.createRule(c.id, pattern).subscribe(() => {
      this.newRule[c.id] = '';
      this.reload();
    });
  }

  removeRule(id: number): void {
    this.api.deleteRule(id).subscribe(() => this.reload());
  }

  saveBudget(c: Category): void {
    const raw = String(this.budgetInput[c.id] ?? c.budget ?? '0');
    const amount = parseFloat(raw.replace(/\./g, '').replace(',', '.')) || 0;
    this.api.setBudget(c.id, amount).subscribe(() => {
      delete this.budgetInput[c.id];
      this.reload();
    });
  }

  recategorize(): void {
    this.busy = true;
    this.api.recategorize().subscribe({
      next: (res) => {
        this.uncategorized = res.uncategorized;
        this.busy = false;
      },
      error: () => (this.busy = false),
    });
  }
}
