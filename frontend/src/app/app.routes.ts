import { Routes } from '@angular/router';
import { DashboardComponent } from './dashboard/dashboard.component';
import { ImportComponent } from './import/import.component';
import { TransactionsComponent } from './transactions/transactions.component';
import { CategoriesComponent } from './categories/categories.component';
import { InvoicesComponent } from './invoices/invoices.component';
import { InsightsComponent } from './insights/insights.component';
import { BudgetsComponent } from './budgets/budgets.component';
import { SettingsComponent } from './settings/settings.component';
import { LoginComponent } from './login/login.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: 'dashboard', component: DashboardComponent },
  { path: 'transactions', component: TransactionsComponent },
  { path: 'invoices', component: InvoicesComponent },
  { path: 'insights', component: InsightsComponent },
  { path: 'budgets', component: BudgetsComponent },
  { path: 'categories', component: CategoriesComponent },
  { path: 'import', component: ImportComponent },
  { path: 'settings', component: SettingsComponent },
];
