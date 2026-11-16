import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private key = 'finance-token';

  get token(): string | null {
    return localStorage.getItem(this.key);
  }

  get loggedIn(): boolean {
    return !!this.token;
  }

  setToken(token: string): void {
    localStorage.setItem(this.key, token);
  }

  logout(): void {
    localStorage.removeItem(this.key);
    window.location.href = '/login';
  }
}
