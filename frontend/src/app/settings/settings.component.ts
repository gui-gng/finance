import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';

import { ApiService } from '../api.service';
import { SettingsService } from '../services/settings.service';
import { ToastService } from '../services/toast.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <h1 class="page-title">Settings</h1>
    <p class="page-sub">Preferences, merchants, data tools <span class="kbd-hint">— shortcuts: g+d dashboard, g+t transactions, g+i invoices, g+a insights, g+b budgets, g+c categories</span></p>

    <div class="grid-2">
      <div class="card">
        <h3>Preferences</h3>
        <label>Currency</label>
        <input type="text" [(ngModel)]="currency" (change)="save()" maxlength="3" style="margin-bottom: 0.9rem">
        <label>Locale</label>
        <input type="text" [(ngModel)]="locale" (change)="save()" style="margin-bottom: 0.9rem">
        <label>Reminder days before invoice due</label>
        <input type="number" min="0" max="30" [(ngModel)]="reminderDays" (change)="save()" style="margin-bottom: 0.9rem">
        <label>Default filter period</label>
        <select [(ngModel)]="defaultPeriod" (change)="save()" style="margin-bottom: 0.9rem">
          <option value="all">All time</option>
          <option value="year">This year</option>
          <option value="6m">Last 6 months</option>
          <option value="12m">Last 12 months</option>
        </select>
        <label class="check">
          <input type="checkbox" [(ngModel)]="mobileStack" (change)="save()"> Stack widget pairs on mobile
        </label>
      </div>

      <div class="card">
        <h3>Data</h3>
        <p class="muted">Backup downloads everything (transactions, categories, budgets, invoice status) as JSON. Restore re-inserts it without duplicating.</p>
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap">
          <button class="ghost" (click)="backup()">Download backup</button>
          <label class="ghost file-btn">
            Restore from backup
            <input type="file" accept=".json" hidden (change)="restore($event)">
          </label>
        </div>
        <p class="success" *ngIf="restoreMsg">{{ restoreMsg }}</p>
      </div>
    </div>

    <div class="card">
      <h3>Merchant aliases</h3>
      <p class="muted">Rename noisy establishment strings ("IFOOD*1234" → "iFood"). Applies retroactively and to future imports.</p>
      <div class="alias-form">
        <input type="text" [(ngModel)]="newAlias" placeholder="alias (e.g. IFOOD*)">
        <input type="text" [(ngModel)]="newCanonical" placeholder="canonical name (e.g. iFood)">
        <button (click)="addAlias()" [disabled]="!newAlias || !newCanonical">Add</button>
      </div>
      <div class="rules" style="margin-top: 0.75rem">
        <span class="rule-chip" *ngFor="let a of aliases">
          {{ a.alias }} → {{ a.canonical }}
          <button class="rule-x" (click)="removeAlias(a.alias)">×</button>
        </span>
      </div>
      <p class="muted" *ngIf="!aliases.length">No aliases yet.</p>
    </div>
  `,
  styles: [`
    label.check { display: flex; align-items: center; gap: 0.5rem; text-transform: none; letter-spacing: 0; color: var(--text); font-weight: 500; }
    .alias-form { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .file-btn { display: inline-flex; align-items: center; cursor: pointer; }
  `],
})
export class SettingsComponent implements OnInit {
  private api = inject(ApiService);
  private settings = inject(SettingsService);
  private toasts = inject(ToastService);

  currency = 'BRL';
  locale = 'pt-BR';
  reminderDays = 7;
  defaultPeriod = 'all';
  mobileStack = true;
  aliases: { alias: string; canonical: string }[] = [];
  newAlias = '';
  newCanonical = '';
  restoreMsg = '';

  ngOnInit(): void {
    this.currency = this.settings.s.currency;
    this.locale = this.settings.s.locale;
    this.reminderDays = this.settings.s.reminderDays;
    this.defaultPeriod = this.settings.s.defaultPeriod;
    this.mobileStack = this.settings.s.mobileStack;
    this.loadAliases();
  }

  save(): void {
    this.settings.update({
      currency: this.currency || 'BRL',
      locale: this.locale || 'pt-BR',
      reminderDays: Number(this.reminderDays) || 0,
      defaultPeriod: this.defaultPeriod,
      mobileStack: this.mobileStack,
    });
    this.toasts.show('Settings saved');
  }

  loadAliases(): void {
    this.api.aliases().subscribe((a) => (this.aliases = a));
  }

  addAlias(): void {
    this.api.createAlias(this.newAlias, this.newCanonical).subscribe(() => {
      this.newAlias = '';
      this.newCanonical = '';
      this.loadAliases();
      this.toasts.show('Alias added and applied');
    });
  }

  removeAlias(alias: string): void {
    this.api.deleteAlias(alias).subscribe(() => this.loadAliases());
  }

  backup(): void {
    this.api.backup().subscribe((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `finance-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  restore(e: Event): void {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.api.restore(file).subscribe((counts) => {
      this.restoreMsg = `Restored: ${Object.entries(counts).map(([k, v]) => `${k} (${v})`).join(', ')}`;
      this.toasts.show('Restore complete');
    });
  }
}
