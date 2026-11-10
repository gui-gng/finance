import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';

import { ApiService, ImportResult, Person, Source } from '../api.service';

@Component({
  selector: 'app-import',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <h1 class="page-title">Import</h1>
    <p class="page-sub">Upload statement files for a person and source</p>

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
        <strong>Drop .csv files here</strong> or click to browse
        <input #fileInput type="file" multiple accept=".csv" hidden (change)="onFiles($event)">
      </div>

      <ul class="file-list" *ngIf="files.length">
        <li *ngFor="let f of files">
          <span>{{ f.name }}</span>
          <span class="muted">{{ (f.size / 1024) | number:'1.1-1' }} KB</span>
        </li>
      </ul>

      <div style="margin-top: 1rem; display: flex; gap: 0.75rem; align-items: center">
        <button (click)="upload()" [disabled]="!canUpload() || uploading">
          {{ uploading ? 'Importing...' : 'Import ' + (files.length ? files.length + ' file(s)' : '') }}
        </button>
        <span class="error" *ngIf="error">{{ error }}</span>
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
  error = '';
  dragging = false;
  uploading = false;

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
    this.error = '';
  }

  canUpload(): boolean {
    return this.personId > 0 && this.sourceId > 0 && this.files.length > 0;
  }

  upload(): void {
    this.error = '';
    this.uploading = true;
    this.api.importFiles(this.personId, this.sourceId, this.files).subscribe({
      next: (r) => {
        this.results = r;
        this.uploading = false;
        this.files = [];
      },
      error: (e) => {
        this.error = e.error?.error ?? 'Import failed';
        this.uploading = false;
      },
    });
  }
}
