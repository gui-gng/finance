import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { ApiService } from '../api.service';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="login-wrap">
      <div class="card login-card">
        <h1 class="page-title">Finance</h1>
        <p class="page-sub">Sign in to continue</p>
        <form (ngSubmit)="submit()">
          <label>Password</label>
          <input type="password" [(ngModel)]="password" name="password" autofocus>
          <p class="error" *ngIf="error">{{ error }}</p>
          <button type="submit" [disabled]="loading || !password">{{ loading ? 'Signing in…' : 'Sign in' }}</button>
        </form>
      </div>
    </div>
  `,
  styles: [`
    .login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .login-card { width: 340px; }
    .login-card input { width: 100%; margin-bottom: 1rem; }
    .login-card button { width: 100%; }
  `],
})
export class LoginComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private router = inject(Router);

  password = '';
  error = '';
  loading = false;

  submit(): void {
    this.loading = true;
    this.error = '';
    this.api.login(this.password).subscribe({
      next: ({ token }) => {
        this.auth.setToken(token);
        this.router.navigate(['/dashboard']);
      },
      error: () => {
        this.error = 'Wrong password';
        this.loading = false;
      },
    });
  }
}
