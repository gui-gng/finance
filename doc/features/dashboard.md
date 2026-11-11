# Dashboard Ideas

## Implemented

- [x] **Widget visibility toggles** — each dashboard section can be shown/hidden via the "Customize" panel; persisted in `localStorage`.
- [x] **Widget reordering** — sections move up/down in the "Customize" panel; persisted in `localStorage`.
- [x] **Budget month selector** — budget widget shows a month picker to inspect any month's budget status.

## More dashboard features

- [ ] **Layout presets** — one-click layouts: Default, Compact (KPIs only), Analyst (all charts).
- [ ] **Custom KPI cards** — pick any metric for a stat card (e.g., avg ticket, biggest expense, uncategorized total, payment ratio) in addition to the fixed ones.
- [ ] **Chart type switcher** — toggle each chart between bar/line/doughnut without leaving the dashboard.
- [ ] **Previous-period overlay** — dashed-line overlay of the previous period on the monthly-flow chart for instant comparison.
- [ ] **Chart zoom / date brush** — drag to zoom the monthly-flow chart into a date range.
- [ ] **Fullscreen widget** — expand any widget to full width for detailed inspection.
- [ ] **Per-widget filters** — pin a specific category or holder to a single widget (e.g., a doughnut that always shows only "Alimentação" breakdown by establishment).
- [ ] **Dashboard export** — render the current dashboard to PDF/PNG for sharing or records.
- [ ] **Auto-refresh** — poll the API on an interval so an open dashboard reflects new imports.
- [ ] **Mobile widget stacking preference** — choose whether paired charts stack or stay side-by-side on narrow screens.
