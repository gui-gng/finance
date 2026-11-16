import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';

import { ApiService, ImportResult, Person, PreviewFile, Source } from '../api.service';

@Component({
  selector: 'app-import',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <h1 class="page-title">Import</h1>
    <p class="page-sub">Upload statement files for a person and source — preview before committing</p>

    <div class="card">
      <div class="filters">
        <div>
          <label>Person</label>
          <select [(ngModel)]="personId">
            <option [ngValue]="0">Select...</option>
            <option *ngFor="let p of people" [ngValue]="p.id">{{ p.name }}</option>
          </select>
        </div>
        <div>
          <label>New person</label>
          <input type="text" [(ngModel)]="newPerson" placeholder="name">
        </div>
        <div>
          <label>&nbsp;</label>
          <button class="ghost" (click)="addPerson()" [disabled]="!newPerson">Add person</button>
        </div>
      </div>

      <div class="filters" style="margin-top: 1rem">
        <div>
          <label>Source</label>
          <select [(ngModel)]="sourceId">
            <option [ngValue]="0">Select...</option>
            <option *ngFor="let s of sources" [ngValue]="s.id">{{ s.name }}</option>
          </select>
        </div>
        <div>
          <label>New source</label>
          <input type="text" [(ngModel)]="newSource" placeholder="name">
        </div>
        <div>
          <label>&nbsp;</label>
          <button class="ghost" (click)="addSource()" [disabled]="!newSource">Add source</button>
        </div>
      </div>

      <div class="filters" style="margin-top: 1rem">
        <div>
          <label>Parser</label>
          <select [(ngModel)]="parser">
            <option value="xp">XP (fatura CSV)</option>
            <option value="nubank">Nubank CSV</option>
            <option value="mapped">Generic CSV (map columns)</option>
          </select>
        </div>
        <div *ngIf="parser === 'mapped'">
          <label>Date format</label>
          <select [(ngModel)]="map.date_format">
            <option value="2006-01-02">YYYY-MM-DD</option>
            <option value="02/01/2006">DD/MM/YYYY</option>
            <option value="01/02/2006">MM/DD/YYYY</option>
          </select>
        </div>
        <div *ngIf="parser === 'mapped'">
          <label>Decimal</label>
          <select [(ngModel)]="map.decimal_comma">
            <option [ngValue]="true">comma (1.234,56)</option>
            <option [ngValue]="false">point (1234.56)</option>
          </select>
        </div>
        <div *ngIf="parser === 'mapped'">
          <label>Amount sign</label>
          <select [(ngModel)]="map.expense_positive">
            <option [ngValue]="true">positive = expense</option>
            <option [ngValue]="false">negative = expense</option>
          </select>
        </div>
      </div>

      <ng-container *ngIf="parser === 'mapped'">
        <p class="muted" style="font-size: 0.82rem; margin: 0.5rem 0">Column indexes (0-based):</p>
        <div class="filters">
          <div><label>Date col</label><input type="number" min="0" [(ngModel)]="map.date" style="min-width: 70px"></div>
          <div><label>Establishment col</label><input type="number" min="0" [(ngModel)]="map.establishment" style="min-width: 70px"></div>
          <div><label>Amount col</label><input type="number" min="0" [(ngModel)]="map.amount" style="min-width: 70px"></div>
          <div><label>Holder col</label><input type="number" min="-1" [(ngModel)]="map.holder" style="min-width: 70px"></div>
          <div><label>Installment col</label><input type="number" min="-1" [(ngModel)]="map.installment" style="min-width: 70px"></div>
          <div><label>Delimiter</label>
            <select [(ngModel)]="map.delimiter">
              <option value=",">,</option>
              <option value=";">;</option>
              <option value="tab">tab</option>
            </select>
          </div>
        </div>
      </ng-container>

      <div class="filters" style="margin-top: 1rem">
        <div>
          <label>Currency</label>
          <input type="text" [(ngModel)]="currency" maxlength="3" style="min-width: 80px">
        </div>
        <div *ngIf="currency && currency !== 'BRL'">
          <label>FX rate to BRL</label>
          <input type="number" step="0.0001" [(ngModel)]="fxRate" style="min-width: 100px">
        </div>
      </div>
    </div>

    <div class="card">
      <div
        class="dropzone"
        [class.dragging]="dragging"
        (click)="fileInput.click()"
        (dragover)="onDragOver($event)"
        (dragleave)="dragging = false"
        (drop)="onDrop($event)"
      >
        <strong>Drop .csv files here</strong> or click to browse (a whole folder works too)
        <input #fileInput type="file" multiple accept=".csv" hidden (change)="onFiles($event)">
      </div>

      <ul class="file-list" *ngIf="files.length">
        <li *ngFor="let f of files">
          <span>{{ f.name }}</span>
          <span class="muted">{{ (f.size / 1024) | number:'1.1-1' }} KB</span>
        </li>
      </ul>

      <div style="margin-top: 1rem; display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap">
        <button class="ghost" (click)="preview()" [disabled]="!files.length || previewing">
          {{ previewing ? 'Parsing...' : 'Preview' }}
        </button>
        <button (click)="upload()" [disabled]="!canUpload() || uploading">
          {{ uploading ? 'Importing...' : 'Import ' + (files.length ? files.length + ' file(s)' : '') }}
        </button>
        <span class="error" *ngIf="error">{{ error }}</span>
      </div>

      <div *ngIf="previews.length" style="margin-top: 1.25rem">
        <p class="muted">Parsed preview — rows with flags need review:</p>
        <div *ngFor="let p of previews" style="margin-bottom: 1rem">
          <p style="margin: 0 0 0.4rem"><strong>{{ p.filename }}</strong> ({{ p.rows.length }} rows)</p>
          <div class="table-wrap preview-table">
            <table>
              <thead><tr><th>Date</th><th>Establishment</th><th>Holder</th><th class="num">Amount</th><th>Installment</th><th>Flags</th></tr></thead>
              <tbody>
                <tr *ngFor="let r of p.rows">
                  <td>{{ r.date }}</td>
                  <td>{{ r.establishment }}</td>
                  <td class="muted">{{ r.holder }}</td>
                  <td class="num" [class.negative]="r.amount > 0">{{ r.amount }}</td>
                  <td class="muted">{{ r.installment || '—' }}</td>
                  <td><span class="pill expense" *ngFor="let f of r.flags" style="margin-right: 0.25rem">{{ f }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div *ngIf="results.length" style="margin-top: 1.25rem">
        <p class="success">Import finished successfully:</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Invoice</th><th>File</th><th class="num">Imported</th><th class="num">Duplicates skipped</th></tr></thead>
            <tbody>
              <tr *ngFor="let r of results">
                <td><span class="pill neutral">{{ r.invoice }}</span></td>
                <td class="muted">{{ r.filename }}</td>
                <td class="num">{{ r.transactions }}</td>
                <td class="num" [class.muted]="!r.skipped">{{ r.skipped }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .preview-table { max-height: 300px; overflow-y: auto; }
  `],
})
export class ImportComponent implements OnInit {
  private api = inject(ApiService);

  people: Person[] = [];
  sources: Source[] = [];
  personId = 0;
  sourceId = 0;
  newPerson = '';
  newSource = '';
  files: File[] = [];
  results: ImportResult[] = [];
  previews: PreviewFile[] = [];
  error = '';
  dragging = false;
  uploading = false;
  previewing = false;
  parser = 'xp';
  currency = 'BRL';
  fxRate = 1;
  map = {
    date: 0, establishment: 1, amount: 2, holder: -1, installment: -1,
    delimiter: ',', date_format: '2006-01-02', decimal_comma: true, expense_positive: true,
  };

  ngOnInit(): void {
    this.reload();
  }

  private reload(): void {
    forkJoin({ people: this.api.people(), sources: this.api.sources() }).subscribe(({ people, sources }) => {
      this.people = people;
      this.sources = sources;
      if (!this.personId && people.length) this.personId = people[0].id;
      if (!this.sourceId && sources.length) this.sourceId = sources[0].id;
    });
  }

  addPerson(): void {
    this.api.createPerson(this.newPerson.trim()).subscribe((p) => {
      this.newPerson = '';
      this.personId = p.id;
      this.reload();
    });
  }

  addSource(): void {
    this.api.createSource(this.newSource.trim()).subscribe((s) => {
      this.newSource = '';
      this.sourceId = s.id;
      this.reload();
    });
  }

  onFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.setFiles(input.files ? Array.from(input.files) : []);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging = true;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging = false;
    const list = event.dataTransfer?.files;
    this.setFiles(list ? Array.from(list).filter((f) => f.name.endsWith('.csv')) : []);
  }

  private setFiles(files: File[]): void {
    this.files = files;
    this.results = [];
    this.previews = [];
    this.error = '';
  }

  columnMapJSON(): string | undefined {
    if (this.parser !== 'mapped') return undefined;
    return JSON.stringify({
      ...this.map,
      delimiter: this.map.delimiter === 'tab' ? '\t' : this.map.delimiter,
    });
  }

  preview(): void {
    this.error = '';
    this.previewing = true;
    this.api.previewImport(this.files, this.parser, this.columnMapJSON()).subscribe({
      next: (p) => {
        this.previews = p;
        this.previewing = false;
      },
      error: (e) => {
        this.error = e.error?.error ?? 'Preview failed';
        this.previewing = false;
      },
    });
  }

  canUpload(): boolean {
    return this.personId > 0 && this.sourceId > 0 && this.files.length > 0;
  }

  upload(): void {
    this.error = '';
    this.uploading = true;
    this.api.importFiles(this.personId, this.sourceId, this.files, {
      currency: this.currency || 'BRL',
      fxRate: this.fxRate || 1,
      columnMap: this.columnMapJSON(),
    }).subscribe({
      next: (r) => {
        this.results = r;
        this.uploading = false;
        this.files = [];
        this.previews = [];
      },
      error: (e) => {
        this.error = e.error?.error ?? 'Import failed';
        this.uploading = false;
      },
    });
  }
}

