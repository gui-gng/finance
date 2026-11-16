import { Injectable } from '@angular/core';

export interface Settings {
  theme: 'dark' | 'light';
  currency: string;
  locale: string;
  reminderDays: number;
  defaultPeriod: string;
  mobileStack: boolean;
}

const DEFAULTS: Settings = {
  theme: 'dark',
  currency: 'BRL',
  locale: 'pt-BR',
  reminderDays: 7,
  defaultPeriod: 'all',
  mobileStack: true,
};

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private values: Settings = { ...DEFAULTS };

  constructor() {
    try {
      const raw = localStorage.getItem('finance-settings');
      if (raw) this.values = { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      // keep defaults
    }
    this.applyTheme();
  }

  get s(): Settings {
    return this.values;
  }

  update(partial: Partial<Settings>): void {
    this.values = { ...this.values, ...partial };
    localStorage.setItem('finance-settings', JSON.stringify(this.values));
    this.applyTheme();
  }

  private applyTheme(): void {
    document.documentElement.setAttribute('data-theme', this.values.theme);
  }

  fmt(amount: number): string {
    try {
      return new Intl.NumberFormat(this.values.locale, {
        style: 'currency',
        currency: this.values.currency,
      }).format(amount);
    } catch {
      return `R$ ${amount.toFixed(2)}`;
    }
  }
}
