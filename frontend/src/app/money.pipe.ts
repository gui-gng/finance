import { Pipe, PipeTransform } from '@angular/core';
import { SettingsService } from './services/settings.service';

@Pipe({ name: 'money', standalone: true })
export class MoneyPipe implements PipeTransform {
  private settings = new SettingsService();

  transform(amount: number | null | undefined): string {
    if (amount === null || amount === undefined) return '—';
    return this.settings.fmt(amount);
  }
}
