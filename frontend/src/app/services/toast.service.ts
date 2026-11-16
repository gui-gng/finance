import { Injectable } from '@angular/core';

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  toasts: Toast[] = [];
  private nextId = 1;

  show(message: string, action?: { label: string; run: () => void }): void {
    const id = this.nextId++;
    this.toasts.push({ id, message, action });
    setTimeout(() => this.dismiss(id), 6000);
  }

  dismiss(id: number): void {
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }
}
