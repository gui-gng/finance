import { Component, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuthService } from './services/auth.service';
import { I18nService } from './services/i18n.service';
import { SettingsService } from './services/settings.service';
import { ToastService } from './services/toast.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <button class="ghost nav-toggle" (click)="navOpen = !navOpen">☰</button>
    <div class="layout" *ngIf="auth.loggedIn || isLoginPage">
      <aside class="sidebar" [class.open]="navOpen">
        <div class="brand"><span class="dot"></span>Finance</div>
        <a routerLink="/dashboard" routerLinkActive="active" (click)="navOpen = false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="12" width="4" height="8" rx="1"/><rect x="10" y="7" width="4" height="13" rx="1"/><rect x="17" y="3" width="4" height="17" rx="1"/>
          </svg>
          {{ i18n.t('dashboard') }}
        </a>
        <a routerLink="/transactions" routerLinkActive="active" (click)="navOpen = false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="14" y2="18"/>
          </svg>
          {{ i18n.t('transactions') }}
        </a>
        <a routerLink="/invoices" routerLinkActive="active" (click)="navOpen = false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="6" y1="15" x2="10" y2="15"/>
          </svg>
          {{ i18n.t('invoices') }}
        </a>
        <a routerLink="/insights" routerLinkActive="active" (click)="navOpen = false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v4"/><path d="m19 6-3 3"/><path d="M22 13h-4"/><circle cx="12" cy="14" r="7"/>
          </svg>
          {{ i18n.t('insights') }}
        </a>
        <a routerLink="/budgets" routerLinkActive="active" (click)="navOpen = false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="9"/><path d="M12 3v9l6 3"/>
          </svg>
          {{ i18n.t('budgets') }}
        </a>
        <a routerLink="/categories" routerLinkActive="active" (click)="navOpen = false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
            <circle cx="7" cy="7" r="1.5"/>
          </svg>
          {{ i18n.t('categories') }}
        </a>
        <a routerLink="/import" routerLinkActive="active" (click)="navOpen = false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/>
          </svg>
          {{ i18n.t('import') }}
        </a>
        <a routerLink="/settings" routerLinkActive="active" (click)="navOpen = false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          {{ i18n.t('settings') }}
        </a>
        <div style="flex: 1"></div>
        <a (click)="toggleTheme()" style="cursor: pointer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>
          </svg>
          {{ settings.s.theme === 'light' ? i18n.t('darkTheme') : i18n.t('lightTheme') }}
        </a>
        <a (click)="i18n.toggle()" style="cursor: pointer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.9 5.7 3.9 9S14.5 18.4 12 21c-2.5-2.6-3.9-5.7-3.9-9S9.5 5.6 12 3z"/>
          </svg>
          {{ i18n.t('language') }}
        </a>
        <a (click)="auth.logout()" style="cursor: pointer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          {{ i18n.t('logout') }}
        </a>
      </aside>
      <main>
        <router-outlet />
      </main>
    </div>

    <div class="toast-container">
      <div class="toast" *ngFor="let t of toasts.toasts">
        <span>{{ t.message }}</span>
        <button *ngIf="t.action" (click)="t.action.run(); toasts.dismiss(t.id)">{{ t.action.label }}</button>
        <button class="ghost" (click)="toasts.dismiss(t.id)">✕</button>
      </div>
    </div>
  `,
})
export class AppComponent {
  auth = inject(AuthService);
  i18n = inject(I18nService);
  settings = inject(SettingsService);
  toasts = inject(ToastService);
  private router = inject(Router);

  navOpen = false;

  get isLoginPage(): boolean {
    return this.router.url.startsWith('/login');
  }

  toggleTheme(): void {
    this.settings.update({ theme: this.settings.s.theme === 'light' ? 'dark' : 'light' });
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const go = (path: string) => this.router.navigate([path]);
    switch (e.key) {
      case 'g':
        this.pendingG = true;
        setTimeout(() => (this.pendingG = false), 800);
        break;
      case 'd': if (this.pendingG) { go('/dashboard'); this.pendingG = false; } break;
      case 't': if (this.pendingG) { go('/transactions'); this.pendingG = false; } break;
      case 'i': if (this.pendingG) { go('/invoices'); this.pendingG = false; } break;
      case 'a': if (this.pendingG) { go('/insights'); this.pendingG = false; } break;
      case 'b': if (this.pendingG) { go('/budgets'); this.pendingG = false; } break;
      case 'c': if (this.pendingG) { go('/categories'); this.pendingG = false; } break;
    }
  }

  private pendingG = false;
}
