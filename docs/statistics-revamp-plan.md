# Statistics Graphing Revamp — Implementation Plan

Status: **COMPLETE** — all slices 1–6 shipped & deployed (2026-06-01)
Owner: yosched
Last updated: 2026-06-01

---

## 1. Goal

Replace the fixed Statistics page (`/equity`) with a configurable graphing tool. The user
picks a **date range**, **which staff** to include (by name, by employment type FTE vs Fee
Basis, by FTE %), a **chart type** (bar, pie, radar, heatmap, line), and **transforms**
(FTE‑normalized vs raw, opportunity‑weighted vs not). Configurations are **savable per user
and re‑runnable**, and graphs can be **exported to PNG/CSV**.

## 2. Principles

- **One source of truth: `GraphSpec`.** Every control reads/writes a single serializable
  object. The chart is a pure function of it. Saving a view = persisting that object.
- **Client‑side compute.** Ship raw data to the browser once; re‑run the metric engine on
  every spec change. No per‑interaction API calls. Justified because `computeFairness()`
  (`src/lib/fairness.ts:86`) is already a pure function over plain arrays, and the dataset is
  small (~30 providers × 365 days ≈ 10–15k assignment rows/year).
- **Logic in pure, tested modules; views stay thin.** Charts/DOM remain view‑only (untested,
  as today); all real logic lives in unit‑tested helpers (template: the `src/lib/alerts.ts`
  extraction).
- **Small, independently shippable slices**, each through test → Code‑Review → deploy.

## 3. Architecture — the pipeline

```
raw data (loaded once)
  → filter(spec.dateRange, spec.staff)        → scoped data
  → computeFairness(...) + shift tally          → per‑provider metrics
  → transform(spec.metric, spec.normalize,
              spec.weighting)                    → series
  → bucketByTime(spec.timeBucket)  [line only]   → time series
  → render(spec.chart)                           → chart
```

Each arrow is a small pure module, independently unit‑testable.

## 4. `GraphSpec` type

```ts
type GraphSpec = {
  version: 1;
  dateRange:
    | { kind: "payPeriods"; payPeriodIds: string[] }
    | { kind: "custom"; start: string; end: string };
  staff: {
    all?: boolean;
    names?: string[];                 // explicit provider ids
    employmentType?: string | null;   // "FTE" | "Fee Basis"
    minFtePct?: number | null;
  };
  metric: "shiftCount" | "hours" | "holidays" | "desirability" | "equityDeviation";
  groupByShiftCode?: boolean;         // stacked breakdowns
  chart: "bar" | "pie" | "radar" | "heatmap" | "line";
  normalize: "raw" | "fte";           // ÷ ftePercentage
  weighting: "none" | "opportunity";  // opportunity‑adjusted vs plain
  timeBucket?: "payPeriod" | "month"; // line/trend only
};
```

`DEFAULT_SPEC` reproduces today's bar chart so the new pipeline can ship invisibly first.

## 5. File / component layout

```
src/lib/graph/
  spec.ts        # GraphSpec type, DEFAULT_SPEC, encode/decode (URL), validate (zod)
  filter.ts      # filterAssignments(raw, spec) -> scoped
  series.ts      # shapeSeries(metrics, spec) -> chart-ready data
  buckets.ts     # bucketByTime(assignments, spec) for line charts
  compat.ts      # valid chart types per metric (+ greying rules)
src/app/equity/
  equity-page.tsx          # orchestrator: holds spec state, runs pipeline via useMemo
  controls/
    PickerBar.tsx, DateRangePicker.tsx, StaffPicker.tsx,
    MetricPicker.tsx, ChartTypePicker.tsx, TransformToggles.tsx
  charts/
    BarView.tsx, PieView.tsx, RadarView.tsx, HeatmapView.tsx, LineView.tsx
  saved/
    SavedViews.tsx          # dropdown + save / save-as / rename / delete / share
  export/
    exportPng.ts, exportCsv.ts
```

`src/lib/fairness.ts` stays the engine. We only add a client‑callable path (it's already
pure) and the time‑bucketing loop.

## 6. Engine changes (minimal)

- **Expose raw data to the client.** `equity/page.tsx` currently pre‑computes on the server
  and ships derived `EquityRow[]`. Change it to also pass the normalized raw arrays:
  assignments (with shiftType), providers (with employmentType + FTE + eligibility),
  desirabilityWeights, holidays, equityFactors, payPeriods, **and
  `providerShiftOverride`**. All small.
  - **Overrides are required, not optional** (CR #313): the current hours metric depends on
    per‑provider shift‑hour overrides plus the `countsOnWeekend` logic at
    `src/app/equity/page.tsx:81`. Slice 1 must include `providerShiftOverride` in the client
    payload and the `series.ts`/hours tests must cover the override + weekend path, or the
    new pipeline will silently compute different hours than today.
- **Wrap `computeFairness` for client use** — call it inside a `useMemo` keyed on
  `(scopedAssignments, spec)`. No engine rewrite.
- **Time bucketing** (`buckets.ts`): for `chart === "line"`, split scoped assignments into
  per‑pay‑period or per‑month buckets and run `computeFairness` per bucket → a series of
  points. This is the only place the engine is looped.

## 7. Picker UI

A compact control bar above the chart; each control writes to `GraphSpec`:

- **Date range** — segmented: *Pay periods* (multiselect) | *Custom* (from/to). Reuses the
  existing pay‑period data.
- **Staff** — *All / By name / By type / By FTE %*, composable (e.g. Fee Basis AND ≥ 0.5).
  "By name" = multi‑select chips; "By FTE %" reuses the existing min‑FTE control
  (`equity-page.tsx:492`); "By type" reads `employmentType.name`.
- **Metric** dropdown, **Chart type** icon toggle, **Normalize** + **Weighting** toggles
  (promoted from today's radar‑only toggles to global).
- `compat.ts` greys out nonsensical combos (e.g. pie of equity z‑scores).

## 8. Chart types

| Chart | Best for | Status |
|------|---------|--------|
| **Bar** | per‑provider counts/hours, stacked by shift code | exists |
| **Radar** | one/few providers across metric axes; keep both toggles | exists |
| **Pie** | one provider's shift‑mix, or dept share of one shift | new |
| **Heatmap** | providers × shift‑codes (or × day‑of‑week), color via `fairnessColor()` | new — highest value |
| **Line/area** | trend over time via `buckets.ts` | new |

Recharts (already a dep, v3.8) covers bar/pie/radar/line. Heatmap: a lightweight CSS‑grid
component reusing `fairnessColor()`.

## 9. Saved views

Per the decisions: **begin saving per‑user now** (anticipating upcoming per‑user
settings/color profiles). New views **default to global/shared**, with a **user‑only
(private)** option. **Editing requires a new permission; regular staff cannot edit by
default.**

### 9.1 Data model — new Prisma model
```prisma
model SavedGraphView {
  id        String   @id @default(cuid())
  name      String
  spec      Json     // a GraphSpec
  ownerId   String?  // User id of creator
  isShared  Boolean  @default(true)   // default global; false = private to owner
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  owner     User?    @relation(fields: [ownerId], references: [id], onDelete: SetNull)
  @@index([ownerId])
  @@index([isShared])
}
```
Plus the **inverse relation on `User`** (CR #313): `savedGraphViews SavedGraphView[]`.

**Owner deletion (CR #313):** `onDelete: SetNull` alone would orphan *private* views —
`isShared = false` with `ownerId = null` is visible to nobody (dead rows). Resolution: keep
`SetNull` on the relation (so a deleted author's **shared** views survive as
department‑owned, `ownerId = null`), but the user‑deletion path must **delete the owner's
private views** (`isShared = false`) first so no invisible rows remain. Cover this in the
saved‑views slice (slice 5) tests.

Migration via `prisma migrate` (deploy.sh already runs `migrate deploy`).

### 9.2 Visibility / read rules
- A user sees: all `isShared = true` views **plus** their own `isShared = false` views.
- New view default: `isShared = true`. A "Private to me" toggle sets `isShared = false`.

### 9.3 New permission: `statistics:manage`
Controls create/update/delete of saved views (both shared and private). Without it a user can
**view and run** saved views but not create/edit/delete. Touch points:
- `prisma/seed.ts:352` — add `"statistics:manage"` to `ALL_PERMISSIONS`; grant to **Admin**
  and **Super User** groups (already get all). **Scheduler** gets it; **Staff** does not.
- `src/app/settings/groups-section.tsx:16` — add to the UI permission catalog (category
  "statistics").
- `src/lib/auth-guard.ts` — add to the hardcoded fallback lists for the appropriate levels.
- `src/app/api/settings/groups/route.ts:5` — **its own permission whitelist** (CR #313).
  Without adding `statistics:manage` here, custom groups cannot be granted the permission
  through the groups API even though the UI catalog lists it. Easy to miss; required.
- **Backfill migration** — grant `statistics:manage` to existing Admin/Super User/Scheduler
  groups (mirror `20260529120100_seed_groups_backfill_users`).

> Open sub‑question deferred to build time: should private‑view creation require
> `statistics:manage` too, or should any `statistics:view` user be able to save *their own*
> private views? The decision "editing not allowed by default for regular staff" is read here
> as **all saves require `statistics:manage`** for now (simplest, consistent). Revisit when
> the per‑user profiles feature lands.

### 9.4 API
`src/app/api/statistics/views/route.ts` (+ `[id]/route.ts`):
- `GET` — list visible views (shared + own). Requires `statistics:view`.
- `POST` / `PUT` / `DELETE` — require `statistics:manage`; non‑shared views editable only by
  their owner. Validate incoming `spec` against `GraphSpec` (zod) before persisting so a bad
  blob can't be stored.

### 9.5 UI — `SavedViews.tsx`
Dropdown of visible views; selecting one does `setSpec(view.spec)` and the pipeline re‑runs
instantly. Buttons: **Save** (overwrite current, if permitted), **Save as…** (name + shared/
private), **Rename**, **Delete**, **Share/Unshare**. Buttons hidden/disabled without
`statistics:manage`.

## 10. URL encoding (shareable links, free)

`spec.ts` provides `encode/decode` so the active spec can live in the URL (`?g=...`): gives
back/forward + copy‑link sharing with zero DB cost. Composes with saved views (a saved view
just seeds the spec). Low effort; include in slice 2.

## 11. Export (PNG + CSV)

- **CSV** (`exportCsv.ts`) — serialize the current `series` (the shaped data behind the
  chart) to CSV. Pure + unit‑testable.
- **PNG** (`exportPng.ts`) — Recharts renders SVG; serialize the chart SVG → canvas → PNG
  (no heavy new dep). Heatmap (CSS grid) exported via the same SVG/canvas path or
  `html-to-image` if needed (evaluate at build time, prefer no new dep).

## 12. Testing strategy

- Unit‑test the pure modules — `filter.ts`, `series.ts`, `buckets.ts`, `compat.ts`,
  `spec.ts` (encode/decode round‑trip), `exportCsv.ts`. These hold the real logic.
- API route: spec‑validation + owner‑scoping + permission tests.
- Charts/DOM stay view‑only (untested), kept thin so logic lives in tested modules.

## 13. Delivery slices (each: write tests → `PLAN:`/`REVIEW:` gate → deploy)

1. **Plumbing** — `GraphSpec` + `DEFAULT_SPEC`; reproduce today's bar chart + min‑FTE filter
   through pure `series`/`filter` helpers (no visible change; proves the spec→series→render
   shape). Tests for `filter`/`series`.
   - **Status: DONE** — commit `fa90982`, Code‑Review #315 APPROVED, deployed.
   - **Split:** "ship raw data client‑side" was descoped from this slice (server compute left
     untouched) and folded into slice 1b/2 below, where client recompute is actually
     introduced. **Carried‑forward requirement (CR #313 + #315):** that next slice MUST add
     `providerShiftOverride` to the client payload and cover the hours + `countsOnWeekend`
     path in tests — non‑negotiable parity check.
1b. **Client recompute** — move the compute to the browser; ship the raw payload
   (assignments, providers, weights, holidays, equityFactors, payPeriods, **and
   `providerShiftOverride`**); reproduce today's full Statistics view (table + hours +
   charts) from client‑side compute. Hours/`countsOnWeekend`/override parity tests required.
   - **1b‑i (DONE):** extracted `assembleEquityModel` (pure, isomorphic, 7 parity tests),
     server still calls it — byte‑identical output. Commit `7b7e46c`, CR #317 APPROVED,
     deployed. Satisfies the override/hours parity gate.
   - **1b‑ii (DONE, after RBAC fix):** moved the compute to the client via `computeStatsModel`;
     server ships the raw arrays. **RBAC:** because the raw per‑date assignment list (= the
     schedule) now reaches the browser, `/equity` requires **both** `statistics:view` AND
     `schedule:view` (CR #319 CRITICAL). All default groups with `statistics:view` already
     have `schedule:view`, so no current user is affected; a stats‑only‑without‑schedule role
     is intentionally no longer possible. **Do not drop `schedule:view` from the `/equity`
     gate** without moving raw‑data compute back to the server.
2. **Filters + URL** — date‑range (pay periods + custom) and staff picker; URL encode/decode.
   Already more capable than today.
   - **Status: DONE** — commit `4948dbb`, Code‑Review #322 APPROVED (NOTE folded in) +
     #324 APPROVED round 2, deployed (login=200). 255 tests passing.
   - `spec.ts`: `encodeSpec`/`decodeSpec` (`?g=`), defensive field‑by‑field coercion of
     untrusted URL input (no zod dep — hand‑rolled); `groupByShiftCode` defaults from
     `DEFAULT_SPEC` (NOTE #323 fix, before slice‑4 wires it).
   - `filter.ts`: `filterAssignmentsByDate` (payPeriods union / custom inclusive, lexical ISO
     compare, empty=no‑op) runs **before** `computeStatsModel`; `filterStaff`
     (names/type/minFte, AND, identity‑preserving) runs **after** as a display filter so
     dept‑relative z‑scores stay computed over everyone.
   - `page.tsx`: decodes `?g` server‑side from `searchParams` → `initialSpec` prop (no client
     mount‑effect, no hydration mismatch); passes `payPeriods` through. RBAC gate unchanged.
   - `equity-page.tsx`: holds spec, mirrors to `?g` via `replaceState`; new
     `controls/{DateRangePicker,StaffPicker}.tsx` (thin views).
3. **Transforms** — global normalize/weighting toggles across charts.
   - **Status: DONE** — commit `d75592c`, Code‑Review #330 APPROVED, deployed.
   - `spec.normalize` ("raw"|"fte") and `spec.weighting` ("none"|"opportunity") promoted from
     the radar panel's old local `useState` to a global `TransformToggles` control; the radar's
     inline buttons now write the spec (single source of truth, shareable via `?g=`).
   - Bar chart honors `normalize`: `shapeBarSeries(..., perFte)` shows per‑1.0‑FTE rates
     (`count/(fte||1)`, 0‑FTE→1.0), +3 tests. Radar maps `weighting` to `deviation`
     (opportunity‑adjusted) vs `displayDeviation` (plain z); weighting disabled under "raw".
   - Engine untouched (both deviation maps already existed). `compat.ts` grey‑out + weighting
     across more chart types deferred to slice 4 as planned.
4. **Chart types** — pie + heatmap, then line/trend (adds `buckets.ts`, both `payPeriod` and
   `month` buckets). **Split into 4a/4b/4c** (like 1b):
   - **4a (DONE)** — Equity **Heatmap** + `ChartTypePicker` (Bar | Heatmap). Commit `30d680f`,
     CR #332 APPROVED, deployed. `shapeHeatmap` (pure, +4 tests): providers × shift-codes,
     each cell = raw count tinted by the FTE-normalized per-shift z-score via `fairnessColor()`;
     honors `spec.weighting`. Additive — bar stays default; engine untouched.
   - **4b-i (DONE)** — `MetricPicker` (Shift count | Hours | Holidays) + **`compat.ts`** +
     scalar `shapeMetricBar` + `MetricBarView`. Commit `0afac39`, CR #336 APPROVED, deployed.
     First time `spec.metric` drives behavior; heatmap valid only for shiftCount; `coerceChart`
     keeps the spec from invalid combos. Signed z-score metrics (desirability/equityDeviation)
     deferred (debatable bar semantics) — table/radar-only for now.
   - **4b-ii (DONE)** — **Pie** (dept share by provider of the chosen count metric). Commit
     `a707736`, CR #338 APPROVED, deployed. Pure `shapePie` (+5 tests); `PieView` donut.
   - **4c (DONE)** — **Line/trend** + `buckets.ts` + `trend.ts`. Commit `fa48a00`, CR #342
     APPROVED, deployed. One line per filtered provider; `computeTrend` loops
     `computeStatsModel` per pay-period/month bucket (the single engine loop). `TimeBucketPicker`
     shown only for the line chart.
   - **Slice 4 COMPLETE.** Full chart matrix live: Bar / Pie / Heatmap / Line, driven by
     Metric (All shifts / per-code / Holiday / Desirability) × Transform × date/staff filters,
     `compat.ts` greying invalid combos. Also shipped this session: metric picker = equity
     factors; header dates use the configured date format; heatmap sizing fix.
5. **Saved views (DONE — pending CR/deploy)** — `SavedGraphView` Prisma model + migration +
   `User.savedGraphViews` inverse + new `statistics:manage` permission (5 touch points) +
   backfill migration + CRUD API (`/api/statistics/views` + `[id]`) + `SavedViews.tsx`
   dropdown. `coerceSpec` extracted from `decodeSpec` as the shared trust boundary (URL + API).
   Owner-deletion deletes the owner's PRIVATE views (CR #313); shared views survive as
   department-owned (`ownerId = null`). Ownership rules pure-tested in `view-access.ts`.
6. **Export + polish (DONE)** — shipped in two sub-slices:
   - **6a (DONE)** — CSV export of the data table. Pure `export-csv.ts` (`toCsvText` +
     `buildEquityCsvRows`, mirrors visible columns) + tests; "Export CSV" button. Commit
     `432e047`, CR #350 APPROVED, deployed.
   - **6b (DONE)** — PNG chart export (`html-to-image`; covers all 4 chart types incl. the
     div-grid heatmap, per §15 fallback) + chart empty-state. Commit `b59808b`, CR #354
     APPROVED, deployed.
   - Deferred (optional, not blocking): `compat`-driven metric grey-out in the picker; surfacing
     the signed z-score metrics as their own chart axes.

**Revamp complete:** `/equity` is the configurable graphing tool described in §1 —
date/staff filters, metric × chart × transform matrix, shareable `?g=` links, per-user saved
views (`statistics:manage`), and CSV + PNG export.

Saved views land in slice 5 but the spec is designed for them from slice 1, so nothing needs
reworking.

## 14. Decisions captured

- **Saved views**: per‑user from the start (anticipating per‑user profiles); default global,
  user‑only option available.
- **Editing**: gated by new `statistics:manage` permission; **Staff** group excluded by
  default.
- **Time axis**: support **both** pay‑period and month buckets (selectable).
- **Scope**: build the full pipeline through slice 4; nothing dropped from v1.
- **Export**: PNG **and** CSV in scope (slice 6).

## 15. Still‑open (resolve at build time, not blocking)

- Private‑view creation permission nuance (see 9.3) — default to "all saves need
  `statistics:manage`" for now.
- PNG export library choice — prefer SVG→canvas with no new dep; fall back to `html-to-image`
  only if the heatmap needs it.
- Exact metric list final naming and which become chart axes on radar.

## 16. Review history

- **Slice 6a — CR #350 APPROVED (2026‑06‑01).** CSV export of the data table; pure
  `export-csv.ts` + 8 tests. Deployed `432e047`.
- **Slice 6b — CR #354 APPROVED (2026‑06‑01).** PNG chart export (`html-to-image`, covers the
  div-grid heatmap) + chart empty-state. (First submission #352 timed out at the review infra —
  no verdict — and was resubmitted unchanged.) Deployed `b59808b`. **Revamp complete.**

- **Slice 5 PLAN — CR #344 APPROVED (2026‑06‑01).** Saved-views approach (DB migration + new
  `statistics:manage` permission) approved before coding, per the higher-risk gate. Implemented:
  model + 2 migrations (table; permission backfill), 5 permission touch points, `coerceSpec`
  trust boundary, CRUD API, owner-deletion orphan fix, `SavedViews.tsx`.
- **Slice 5 REVIEW — CR #346 BLOCKED → fixed (2026‑06‑01).** Finding: PUT making a *shared*
  view private left `ownerId` untouched, so a department-owned shared view (`ownerId = null`)
  became an invisible orphan and another user's shared view became private to its original
  owner (locking out the actor). Fix: `nextOwnerId` — the acting user claims ownership on a
  shared→private transition; ownership untouched otherwise. Pure-tested (5 regression cases).
  301 tests (was 287). *(REVIEW round 2 pending.)*

- **Slice 4c — CR #342 APPROVED.** Line/trend + buckets. Deployed `fa48a00`. (Slice 4 complete.)
- **Metric picker = equity factors + formatted header dates — CR #340 APPROVED.** Deployed `b69dc1b`.
- **Slice 4b-ii — CR #338 APPROVED.** Pie / department share. Deployed `a707736`.
- **Slice 4b-i — CR #336 APPROVED.** Metric picker + compat + scalar bars. Deployed `0afac39`.
- **Slice 4a — CR #332 APPROVED.** Equity heatmap + chart-type picker. Deployed `30d680f`.
- **Slice 3 — CR #330 APPROVED.** Global transform toggles. Deployed `d75592c`. (Follow-up
  UI fixes to slice 2 also shipped: CR #326 Custom-date inputs, CR #328 staff-list narrowing.)
- **Slice 2 — CR #322 APPROVED (one NOTE: `decodeSpec` should default `groupByShiftCode`
  from `DEFAULT_SPEC`), folded in and re‑approved CR #324 (round 2).** Deployed `4948dbb`.
- **PLAN review — Code‑Review #313 (2026‑06‑01): approved approach.** Client‑side recompute
  confirmed sound at this scale; no server graph‑query API needed. Three gaps folded into
  this doc: (1) `providerShiftOverride` added to the slice‑1 raw payload + hours/weekend
  tests (§6); (2) `src/app/api/settings/groups/route.ts` added to the RBAC touch points so
  custom groups can be granted `statistics:manage` (§9.3); (3) `User.savedGraphViews` inverse
  relation + owner‑deletion handling for orphaned private views (§9.1).
- **Slice 1 — Code‑Review #315 (2026‑06‑01): APPROVED.** Pure extraction (`shapeBarSeries`,
  `filterByMinFte`) + GraphSpec contract; zero behavior change; 224/224 tests. Descope of the
  client‑payload move accepted, with the `providerShiftOverride` parity check explicitly
  carried forward as a **required** gate for the recompute slice (1b).
```
