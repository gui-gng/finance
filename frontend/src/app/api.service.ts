import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

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
}

export interface ImportResult {
  filename: string;
  invoice: string;
  transactions: number;
  skipped: number;
}

export interface Filters {
  person_id?: number;
  source_id?: number;
  import_id?: number;
  category_id?: number | string;
  holder?: string;
  search?: string;
  type?: string;
  from?: string;
  to?: string;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private base = 'http://localhost:8080/api';

  private params(f: Filters, extra: Record<string, number> = {}): HttpParams {
    let p = new HttpParams();
    if (f.person_id) p = p.set('person_id', f.person_id);
    if (f.source_id) p = p.set('source_id', f.source_id);
    if (f.import_id) p = p.set('import_id', f.import_id);
    if (f.category_id) p = p.set('category_id', String(f.category_id));
    if (f.holder) p = p.set('holder', f.holder);
    if (f.search) p = p.set('search', f.search);
    if (f.type) p = p.set('type', f.type);
    if (f.from) p = p.set('from', f.from);
    if (f.to) p = p.set('to', f.to);
    for (const [k, v] of Object.entries(extra)) p = p.set(k, v);
    return p;
  }

  people(): Observable<Person[]> {
    return this.http.get<Person[]>(`${this.base}/people`);
  }

  sources(): Observable<Source[]> {
    return this.http.get<Source[]>(`${this.base}/sources`);
  }

  holders(): Observable<string[]> {
    return this.http.get<string[]>(`${this.base}/holders`);
  }

  invoices(): Observable<Invoice[]> {
    return this.http.get<Invoice[]>(`${this.base}/invoices`);
  }

  categories(): Observable<Category[]> {
    return this.http.get<Category[]>(`${this.base}/categories`);
  }

  createCategory(name: string, color: string): Observable<Category> {
    return this.http.post<Category>(`${this.base}/categories`, { name, color });
  }

  deleteCategory(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/categories/${id}`);
  }

  createRule(categoryId: number, pattern: string): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${this.base}/category-rules`, { category_id: categoryId, pattern });
  }

  deleteRule(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/category-rules/${id}`);
  }

  recategorize(): Observable<{ categorized: number; uncategorized: number }> {
    return this.http.post<{ categorized: number; uncategorized: number }>(`${this.base}/categorize`, {});
  }

  setBudget(categoryId: number, monthlyAmount: number): Observable<void> {
    return this.http.put<void>(`${this.base}/categories/${categoryId}/budget`, { monthly_amount: monthlyAmount });
  }

  createPerson(name: string): Observable<Person> {
    return this.http.post<Person>(`${this.base}/people`, { name });
  }

  createSource(name: string): Observable<Source> {
    return this.http.post<Source>(`${this.base}/sources`, { name });
  }

  importFiles(personId: number, sourceId: number, files: File[]): Observable<ImportResult[]> {
    const form = new FormData();
    form.set('person_id', String(personId));
    form.set('source_id', String(sourceId));
    for (const f of files) form.append('files', f);
    return this.http.post<ImportResult[]>(`${this.base}/import`, form);
  }

  transactions(f: Filters, limit: number, offset: number): Observable<TransactionPage> {
    return this.http.get<TransactionPage>(`${this.base}/transactions`, {
      params: this.params(f, { limit, offset }),
    });
  }

  summary(f: Filters): Observable<Summary> {
    return this.http.get<Summary>(`${this.base}/dashboard/summary`, { params: this.params(f) });
  }

  monthly(f: Filters): Observable<MonthlyPoint[]> {
    return this.http.get<MonthlyPoint[]>(`${this.base}/dashboard/monthly`, { params: this.params(f) });
  }

  topEstablishments(f: Filters): Observable<EstablishmentTotal[]> {
    return this.http.get<EstablishmentTotal[]>(`${this.base}/dashboard/top-establishments`, { params: this.params(f) });
  }

  byHolder(f: Filters): Observable<HolderTotal[]> {
    return this.http.get<HolderTotal[]>(`${this.base}/dashboard/by-holder`, { params: this.params(f) });
  }

  byWeekday(f: Filters): Observable<WeekdayPoint[]> {
    return this.http.get<WeekdayPoint[]>(`${this.base}/dashboard/by-weekday`, { params: this.params(f) });
  }

  invoiceTotals(f: Filters): Observable<InvoiceTotal[]> {
    return this.http.get<InvoiceTotal[]>(`${this.base}/dashboard/invoices`, { params: this.params(f) });
  }

  byCategory(f: Filters): Observable<CategorySpend[]> {
    return this.http.get<CategorySpend[]>(`${this.base}/dashboard/by-category`, { params: this.params(f) });
  }

  budgetStatus(month: string, f: Filters): Observable<BudgetStatus[]> {
    return this.http.get<BudgetStatus[]>(`${this.base}/dashboard/budget-status`, {
      params: this.params(f).set('month', month),
    });
  }

  recurring(f: Filters): Observable<RecurringItem[]> {
    return this.http.get<RecurringItem[]>(`${this.base}/dashboard/recurring`, { params: this.params(f) });
  }

  installments(f: Filters): Observable<InstallmentItem[]> {
    return this.http.get<InstallmentItem[]>(`${this.base}/dashboard/installments`, { params: this.params(f) });
  }

  setInvoicePaid(id: number, paid: boolean): Observable<{ id: number; paid: boolean }> {
    return this.http.patch<{ id: number; paid: boolean }>(`${this.base}/invoices/${id}/paid`, { paid });
  }
}
