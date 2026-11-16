import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';

import { AuthService } from './services/auth.service';

declare global {
  interface Window { __API_BASE__?: string }
}

export interface Person { id: number; name: string; }
export interface Source { id: number; name: string; }

export interface Transaction {
  id: number;
  date: string;
  establishment: string;
  holder: string;
  amount: number;
  installment_number?: number;
  installment_total?: number;
  person_id: number;
  source_id: number;
  import_id: number;
  category_id?: number;
  category_name?: string;
  category_color?: string;
  note?: string;
  tags?: string[];
  excluded?: boolean;
  income?: boolean;
  currency?: string;
  original_amount?: number;
  has_receipt?: boolean;
  tx_time?: string;
}

export interface CategoryRule {
  id: number;
  pattern: string;
}

export interface Category {
  id: number;
  name: string;
  color: string;
  rules: CategoryRule[];
  budget: number | null;
  parent_id?: number | null;
  rollover: boolean;
  period: string;
}

export interface CategorySpend {
  category: string;
  color: string;
  total: number;
  count: number;
}

export interface BudgetStatus {
  category_id: number;
  name: string;
  color: string;
  budget: number;
  spent: number;
  rollover: boolean;
  period: string;
}

export interface TrendPoint {
  category_id: number;
  name: string;
  color: string;
  month: string;
  spent: number;
}

export interface Goal {
  id: number;
  name: string;
  target_amount: number;
  saved_amount: number;
  deadline?: string;
  monthly_needed?: number;
}

export interface BudgetTemplate {
  name: string;
  amounts: { category_id: number; category: string; color: string; amount: number }[];
}

export interface RecurringItem {
  establishment: string;
  months: number;
  count: number;
  avg_amount: number;
  total: number;
  category?: string;
  color?: string;
}

export interface TransactionPage {
  total: number;
  items: Transaction[];
}

export interface Summary {
  total_expenses: number;
  total_payments: number;
  total_income: number;
  net: number;
  count: number;
  first_date?: string;
  last_date?: string;
}

export interface MonthlyPoint {
  month: string;
  expenses: number;
  payments: number;
  net: number;
}

export interface EstablishmentTotal {
  establishment: string;
  total: number;
  count: number;
}

export interface HolderTotal {
  holder: string;
  expenses: number;
  count: number;
}

export interface WeekdayPoint {
  weekday: number;
  expenses: number;
  count: number;
}

export interface InvoiceTotal {
  import_id: number;
  filename: string;
  reference_date?: string;
  expenses: number;
  payments: number;
  count: number;
  paid: boolean;
}

export interface Invoice {
  id: number;
  name: string;
  filename: string;
  reference_date?: string;
  person_id: number;
  source_id: number;
  transactions: number;
  paid: boolean;
  paid_at?: string;
  note?: string;
  min_payment?: number;
  inserted_count: number;
  skipped_count: number;
  imported_at: string;
}

export interface ImportResult {
  filename: string;
  invoice: string;
  transactions: number;
  skipped: number;
}

export interface InstallmentItem {
  establishment: string;
  holder: string;
  category?: string;
  color?: string;
  installment_total: number;
  current: number;
  remaining: number;
  monthly_amount: number;
  total_committed: number;
}

export interface Anomaly {
  category_id: number;
  name: string;
  color: string;
  current: number;
  average: number;
  change_pct: number;
}

export interface PriceChange {
  establishment: string;
  months: number;
  min_amount: number;
  max_amount: number;
  last_amount: number;
  category?: string;
}

export interface DuplicatePair {
  a_id: number;
  b_id: number;
  date: string;
  establishment: string;
  amount: number;
  same_import: boolean;
}

export interface Parcel {
  id: number;
  date: string;
  installment_number: number;
  installment_total: number;
  amount: number;
  past: boolean;
}

export interface InvoicePayment {
  id: number;
  amount: number;
  paid_at: string;
}

export interface WeeklyDigest {
  week: string;
  from: string;
  to: string;
  expenses: number;
  count: number;
  categories: CategorySpend[];
  biggest: Transaction[];
}

export interface FunFacts {
  biggest_expense?: { establishment: string; amount: number; date: string };
  cheapest_month?: { month: string; expenses: number };
  most_frequent_merchant?: { establishment: string; count: number };
  average_ticket?: number;
}

export interface PreviewFile {
  filename: string;
  rows: {
    date: string;
    establishment: string;
    holder: string;
    amount: number;
    installment: string;
    category?: string;
    flags: string[];
  }[];
}

export interface Filters {
  person_id?: number;
  source_id?: number;
  import_id?: number;
  category_id?: number | string;
  holder?: string;
  search?: string;
  type?: string;
  tag?: string;
  from?: string;
  to?: string;
  include_excluded?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private base = window.__API_BASE__ || 'http://localhost:8080/api';

  private params(f: Filters, extra: Record<string, number> = {}): HttpParams {
    let p = new HttpParams();
    if (f.person_id) p = p.set('person_id', f.person_id);
    if (f.source_id) p = p.set('source_id', f.source_id);
    if (f.import_id) p = p.set('import_id', f.import_id);
    if (f.category_id) p = p.set('category_id', String(f.category_id));
    if (f.holder) p = p.set('holder', f.holder);
    if (f.search) p = p.set('search', f.search);
    if (f.type) p = p.set('type', f.type);
    if (f.tag) p = p.set('tag', f.tag);
    if (f.from) p = p.set('from', f.from);
    if (f.to) p = p.set('to', f.to);
    if (f.include_excluded) p = p.set('include_excluded', 1);
    for (const [k, v] of Object.entries(extra)) p = p.set(k, v);
    return p;
  }

  private opts(): { headers: Record<string, string> } {
    const headers: Record<string, string> = {};
    if (this.auth.token) headers['Authorization'] = `Bearer ${this.auth.token}`;
    return { headers };
  }

  private guard<T>(obs: Observable<T>): Observable<T> {
    return obs.pipe(
      catchError((err) => {
        if (err?.status === 401) this.auth.logout();
        return throwError(() => err);
      }),
    );
  }

  login(password: string): Observable<{ token: string }> {
    return this.http.post<{ token: string }>(`${this.base}/auth/login`, { password });
  }

  people(): Observable<Person[]> {
    return this.guard(this.http.get<Person[]>(`${this.base}/people`, this.opts()));
  }

  sources(): Observable<Source[]> {
    return this.guard(this.http.get<Source[]>(`${this.base}/sources`, this.opts()));
  }

  holders(): Observable<string[]> {
    return this.guard(this.http.get<string[]>(`${this.base}/holders`, this.opts()));
  }

  invoices(): Observable<Invoice[]> {
    return this.guard(this.http.get<Invoice[]>(`${this.base}/invoices`, this.opts()));
  }

  updateInvoice(id: number, body: { note?: string; min_payment?: number }): Observable<void> {
    return this.guard(this.http.patch<void>(`${this.base}/invoices/${id}`, body, this.opts()));
  }

  deleteInvoice(id: number): Observable<void> {
    return this.guard(this.http.delete<void>(`${this.base}/invoices/${id}`, this.opts()));
  }

  invoicePayments(id: number): Observable<InvoicePayment[]> {
    return this.guard(this.http.get<InvoicePayment[]>(`${this.base}/invoices/${id}/payments`, this.opts()));
  }

  addInvoicePayment(id: number, amount: number, paidAt?: string): Observable<{ id: number }> {
    return this.guard(this.http.post<{ id: number }>(`${this.base}/invoices/${id}/payments`, { amount, paid_at: paidAt }, this.opts()));
  }

  deleteInvoicePayment(id: number, pid: number): Observable<void> {
    return this.guard(this.http.delete<void>(`${this.base}/invoices/${id}/payments/${pid}`, this.opts()));
  }

  cardLimits(): Observable<Record<string, number>> {
    return this.guard(this.http.get<Record<string, number>>(`${this.base}/card-limits`, this.opts()));
  }

  setCardLimit(holder: string, limitAmount: number): Observable<void> {
    return this.guard(this.http.put<void>(`${this.base}/card-limits/${encodeURIComponent(holder)}`, { limit_amount: limitAmount }, this.opts()));
  }

  categories(): Observable<Category[]> {
    return this.guard(this.http.get<Category[]>(`${this.base}/categories`, this.opts()));
  }

  createCategory(name: string, color: string, parentId?: number | null): Observable<Category> {
    return this.guard(this.http.post<Category>(`${this.base}/categories`, { name, color, parent_id: parentId ?? null }, this.opts()));
  }

  deleteCategory(id: number): Observable<void> {
    return this.guard(this.http.delete<void>(`${this.base}/categories/${id}`, this.opts()));
  }

  createRule(categoryId: number, pattern: string): Observable<{ id: number }> {
    return this.guard(this.http.post<{ id: number }>(`${this.base}/category-rules`, { category_id: categoryId, pattern }, this.opts()));
  }

  deleteRule(id: number): Observable<void> {
    return this.guard(this.http.delete<void>(`${this.base}/category-rules/${id}`, this.opts()));
  }

  recategorize(): Observable<{ categorized: number; uncategorized: number }> {
    return this.guard(this.http.post<{ categorized: number; uncategorized: number }>(`${this.base}/categorize`, {}, this.opts()));
  }

  setBudget(categoryId: number, monthlyAmount: number): Observable<void> {
    return this.guard(this.http.put<void>(`${this.base}/categories/${categoryId}/budget`, { monthly_amount: monthlyAmount }, this.opts()));
  }

  setBudgetFlags(categoryId: number, body: { rollover?: boolean; period?: string }): Observable<void> {
    return this.guard(this.http.put<void>(`${this.base}/categories/${categoryId}/flags`, body, this.opts()));
  }

  budgetTrend(f: Filters, months: number): Observable<TrendPoint[]> {
    return this.guard(this.http.get<TrendPoint[]>(`${this.base}/dashboard/budget-trend`, { params: this.params(f, { months }), headers: this.opts().headers }));
  }

  suggestBudgets(): Observable<{ category_id: number; name: string; amount: number }[]> {
    return this.guard(this.http.post<{ category_id: number; name: string; amount: number }[]>(`${this.base}/budgets/suggest`, {}, this.opts()));
  }

  templates(): Observable<BudgetTemplate[]> {
    return this.guard(this.http.get<BudgetTemplate[]>(`${this.base}/budget-templates`, this.opts()));
  }

  saveTemplate(name: string, amounts: { category_id: number; amount: number }[]): Observable<void> {
    return this.guard(this.http.post<void>(`${this.base}/budget-templates`, { name, amounts }, this.opts()));
  }

  applyTemplate(name: string): Observable<{ applied: number }> {
    return this.guard(this.http.post<{ applied: number }>(`${this.base}/budget-templates/${encodeURIComponent(name)}/apply`, {}, this.opts()));
  }

  deleteTemplate(name: string): Observable<void> {
    return this.guard(this.http.delete<void>(`${this.base}/budget-templates/${encodeURIComponent(name)}`, this.opts()));
  }

  goals(): Observable<Goal[]> {
    return this.guard(this.http.get<Goal[]>(`${this.base}/goals`, this.opts()));
  }

  createGoal(goal: Goal): Observable<{ id: number }> {
    return this.guard(this.http.post<{ id: number }>(`${this.base}/goals`, goal, this.opts()));
  }

  updateGoal(goal: Goal): Observable<void> {
    return this.guard(this.http.patch<void>(`${this.base}/goals/${goal.id}`, goal, this.opts()));
  }

  deleteGoal(id: number): Observable<void> {
    return this.guard(this.http.delete<void>(`${this.base}/goals/${id}`, this.opts()));
  }

  createPerson(name: string): Observable<Person> {
    return this.guard(this.http.post<Person>(`${this.base}/people`, { name }, this.opts()));
  }

  createSource(name: string): Observable<Source> {
    return this.guard(this.http.post<Source>(`${this.base}/sources`, { name }, this.opts()));
  }

  importFiles(personId: number, sourceId: number, files: File[], extra?: { currency?: string; fxRate?: number; columnMap?: string }): Observable<ImportResult[]> {
    const form = new FormData();
    form.set('person_id', String(personId));
    form.set('source_id', String(sourceId));
    if (extra?.currency) form.set('currency', extra.currency);
    if (extra?.fxRate) form.set('fx_rate', String(extra.fxRate));
    if (extra?.columnMap) form.set('column_map', extra.columnMap);
    for (const f of files) form.append('files', f);
    return this.guard(this.http.post<ImportResult[]>(`${this.base}/import`, form, this.opts()));
  }

  previewImport(files: File[], source: string, columnMap?: string): Observable<PreviewFile[]> {
    const form = new FormData();
    form.set('source', source);
    if (columnMap) form.set('column_map', columnMap);
    for (const f of files) form.append('files', f);
    return this.guard(this.http.post<PreviewFile[]>(`${this.base}/import/preview`, form, this.opts()));
  }

  transactions(f: Filters, limit: number, offset: number): Observable<TransactionPage> {
    return this.guard(this.http.get<TransactionPage>(`${this.base}/transactions`, {
      params: this.params(f, { limit, offset }), headers: this.opts().headers,
    }));
  }

  createTransaction(body: Partial<Transaction> & { installments?: number }): Observable<{ created: number[] }> {
    return this.guard(this.http.post<{ created: number[] }>(`${this.base}/transactions`, body, this.opts()));
  }

  updateTransaction(id: number, body: Record<string, unknown>): Observable<void> {
    return this.guard(this.http.patch<void>(`${this.base}/transactions/${id}`, body, this.opts()));
  }

  deleteTransaction(id: number): Observable<void> {
    return this.guard(this.http.delete<void>(`${this.base}/transactions/${id}`, this.opts()));
  }

  bulkCategory(ids: number[], categoryId: number | null): Observable<{ updated: number }> {
    return this.guard(this.http.post<{ updated: number }>(`${this.base}/transactions/bulk-category`, { ids, category_id: categoryId }, this.opts()));
  }

  splitTransaction(id: number, splits: { category_id?: number; amount: number; note?: string }[]): Observable<void> {
    return this.guard(this.http.post<void>(`${this.base}/transactions/${id}/split`, { splits }, this.opts()));
  }

  pairRefund(expenseId: number, refundId: number, pair: boolean): Observable<void> {
    return this.guard(this.http.post<void>(`${this.base}/transactions/pair-refund`, { expense_id: expenseId, refund_id: refundId, pair }, this.opts()));
  }

  duplicates(): Observable<DuplicatePair[]> {
    return this.guard(this.http.get<DuplicatePair[]>(`${this.base}/transactions/duplicates`, this.opts()));
  }

  exportUrl(f: Filters): string {
    const p = this.params(f).toString();
    return `${this.base}/transactions/export?${p}`;
  }

  installmentPlan(id: number): Observable<Parcel[]> {
    return this.guard(this.http.get<Parcel[]>(`${this.base}/transactions/${id}/installment-plan`, this.opts()));
  }

  uploadReceipt(id: number, file: File): Observable<void> {
    const form = new FormData();
    form.append('file', file);
    return this.guard(this.http.post<void>(`${this.base}/transactions/${id}/receipt`, form, this.opts()));
  }

  receiptUrl(id: number): string {
    return `${this.base}/transactions/${id}/receipt`;
  }

  aliases(): Observable<{ alias: string; canonical: string }[]> {
    return this.guard(this.http.get<{ alias: string; canonical: string }[]>(`${this.base}/merchants/aliases`, this.opts()));
  }

  createAlias(alias: string, canonical: string): Observable<void> {
    return this.guard(this.http.post<void>(`${this.base}/merchants/aliases`, { alias, canonical }, this.opts()));
  }

  deleteAlias(alias: string): Observable<void> {
    return this.guard(this.http.delete<void>(`${this.base}/merchants/aliases/${encodeURIComponent(alias)}`, this.opts()));
  }

  backup(): Observable<Blob> {
    return this.guard(this.http.get(`${this.base}/backup`, { headers: this.opts().headers, responseType: 'blob' }));
  }

  restore(file: File): Observable<Record<string, number>> {
    const text = file.text();
    // read text then post JSON
    return new Observable((sub) => {
      text.then((content) => {
        this.http.post<Record<string, number>>(`${this.base}/restore`, JSON.parse(content), this.opts()).subscribe({
          next: (v) => sub.next(v),
          error: (e) => sub.error(e),
          complete: () => sub.complete(),
        });
      }).catch((e) => sub.error(e));
    });
  }

  summary(f: Filters): Observable<Summary> {
    return this.guard(this.http.get<Summary>(`${this.base}/dashboard/summary`, { params: this.params(f), headers: this.opts().headers }));
  }

  monthly(f: Filters): Observable<MonthlyPoint[]> {
    return this.guard(this.http.get<MonthlyPoint[]>(`${this.base}/dashboard/monthly`, { params: this.params(f), headers: this.opts().headers }));
  }

  topEstablishments(f: Filters): Observable<EstablishmentTotal[]> {
    return this.guard(this.http.get<EstablishmentTotal[]>(`${this.base}/dashboard/top-establishments`, { params: this.params(f), headers: this.opts().headers }));
  }

  byHolder(f: Filters): Observable<HolderTotal[]> {
    return this.guard(this.http.get<HolderTotal[]>(`${this.base}/dashboard/by-holder`, { params: this.params(f), headers: this.opts().headers }));
  }

  byWeekday(f: Filters): Observable<WeekdayPoint[]> {
    return this.guard(this.http.get<WeekdayPoint[]>(`${this.base}/dashboard/by-weekday`, { params: this.params(f), headers: this.opts().headers }));
  }

  invoiceTotals(f: Filters): Observable<InvoiceTotal[]> {
    return this.guard(this.http.get<InvoiceTotal[]>(`${this.base}/dashboard/invoices`, { params: this.params(f), headers: this.opts().headers }));
  }

  byCategory(f: Filters): Observable<CategorySpend[]> {
    return this.guard(this.http.get<CategorySpend[]>(`${this.base}/dashboard/by-category`, { params: this.params(f), headers: this.opts().headers }));
  }

  budgetStatus(month: string, f: Filters): Observable<BudgetStatus[]> {
    return this.guard(this.http.get<BudgetStatus[]>(`${this.base}/dashboard/budget-status`, {
      params: this.params(f).set('month', month), headers: this.opts().headers,
    }));
  }

  recurring(f: Filters): Observable<RecurringItem[]> {
    return this.guard(this.http.get<RecurringItem[]>(`${this.base}/dashboard/recurring`, { params: this.params(f), headers: this.opts().headers }));
  }

  installments(f: Filters): Observable<InstallmentItem[]> {
    return this.guard(this.http.get<InstallmentItem[]>(`${this.base}/dashboard/installments`, { params: this.params(f), headers: this.opts().headers }));
  }

  anomalies(): Observable<Anomaly[]> {
    return this.guard(this.http.get<Anomaly[]>(`${this.base}/insights/anomalies`, this.opts()));
  }

  priceChanges(): Observable<PriceChange[]> {
    return this.guard(this.http.get<PriceChange[]>(`${this.base}/insights/price-changes`, this.opts()));
  }

  funFacts(): Observable<FunFacts> {
    return this.guard(this.http.get<FunFacts>(`${this.base}/insights/fun-facts`, this.opts()));
  }

  weekly(week?: string): Observable<WeeklyDigest> {
    const params = week ? { params: { week } } : {};
    return this.guard(this.http.get<WeeklyDigest>(`${this.base}/insights/weekly`, { ...params, headers: this.opts().headers }));
  }

  query(q: string): Observable<{ total: number; count: number; label: string; period: string; answer: string }> {
    return this.guard(this.http.get(`${this.base}/insights/query`, { params: { q }, headers: this.opts().headers })) as Observable<{ total: number; count: number; label: string; period: string; answer: string }>;
  }

  hourly(): Observable<{ weekday: number; hour: number; total: number }[]> {
    return this.guard(this.http.get<{ weekday: number; hour: number; total: number }[]>(`${this.base}/insights/hourly`, this.opts()));
  }

  setInvoicePaid(id: number, paid: boolean): Observable<{ id: number; paid: boolean }> {
    return this.guard(this.http.patch<{ id: number; paid: boolean }>(`${this.base}/invoices/${id}/paid`, { paid }, this.opts()));
  }
}
