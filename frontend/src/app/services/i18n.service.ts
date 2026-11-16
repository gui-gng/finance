import { Injectable } from '@angular/core';

const DICT: Record<string, { 'pt-BR': string; en: string }> = {
  dashboard: { 'pt-BR': 'Dashboard', en: 'Dashboard' },
  transactions: { 'pt-BR': 'Transações', en: 'Transactions' },
  invoices: { 'pt-BR': 'Faturas', en: 'Invoices' },
  insights: { 'pt-BR': 'Análises', en: 'Insights' },
  budgets: { 'pt-BR': 'Orçamentos', en: 'Budgets' },
  categories: { 'pt-BR': 'Categorias', en: 'Categories' },
  import: { 'pt-BR': 'Importar', en: 'Import' },
  settings: { 'pt-BR': 'Configurações', en: 'Settings' },
  logout: { 'pt-BR': 'Sair', en: 'Log out' },
  lightTheme: { 'pt-BR': 'Tema claro', en: 'Light theme' },
  darkTheme: { 'pt-BR': 'Tema escuro', en: 'Dark theme' },
  language: { 'pt-BR': 'English', en: 'Português' },
  search: { 'pt-BR': 'Buscar', en: 'Search' },
};

@Injectable({ providedIn: 'root' })
export class I18nService {
  lang: 'pt-BR' | 'en' = 'pt-BR';

  constructor() {
    const saved = localStorage.getItem('finance-lang');
    if (saved === 'en' || saved === 'pt-BR') this.lang = saved;
  }

  toggle(): void {
    this.lang = this.lang === 'en' ? 'pt-BR' : 'en';
    localStorage.setItem('finance-lang', this.lang);
  }

  t(key: keyof typeof DICT | string): string {
    const entry = DICT[key];
    if (!entry) return key;
    return entry[this.lang];
  }
}
