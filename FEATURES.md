# YoSched — Feature List

A comprehensive, web-based staff scheduling system for departments that manage call
shifts, coverage minimums, leave, and workload fairness. See
[`docs/USER-MANUAL.md`](docs/USER-MANUAL.md) for how to use each feature.

---

## Schedule Grid

- Calendar grid: staff in columns, days in rows; padded to whole pay periods.
- Color-coded shift assignments with shift-code badges; per-shift colors and bold/print
  styling.
- **Assigning:** click-to-open shift picker, single-letter quick-key hotkeys,
  right-click/Tab to open the picker, drag-to-move/swap between cells.
- **Multi-cell selection:** Shift+click / Shift+drag rectangular ranges, Ctrl/Cmd+click
  to toggle cells, arrow-key navigation, bulk assign/clear.
- **Excel-style copy/paste:** Ctrl+C / Ctrl+V blocks in and out of the grid, with a
  detailed result summary (set / locked / unknown code / conflict / day-cap).
- **Delete/Backspace** clears selected cells; per-day shift caps enforced with snap-back
  and an explanatory popover.
- **Lock assignments** to protect them from the auto-generator and accidental edits;
  manual cells are protected inside Auto-Generate.
- **Dedicated columns** (e.g., ICU, CARD): a shift shown as its own column; edit the
  day's roster inline by typing initials; atomic all-or-nothing validation; column
  copy/paste.
- **PP Totals row:** per-staff +/- hours vs. target per pay period, color-coded;
  preference persisted in localStorage.
- **Count columns:** configurable per-day tallies of chosen shift codes; turn red on
  coverage shortfall.
- **Alerts panel:** pending requests, pay-period hour divergence, and zero-coverage
  warnings; color/severity badge, jump-to-day, and team-shared muting.
- Pay-period boundaries, weekend shading, holiday highlighting, and a "today" marker.
- **Month/pay-period navigation:** prev/next/today, month+year picker dropdown,
  range rounded to whole pay periods, "Show all staff" for past months.
- **Versions:** save named snapshots per month, view diffs (added/removed/changed/
  locked), and restore (auto-backs-up current state first).
- Undo/redo (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y).
- Assignment provenance shown in tooltips (source + editor attribution).

## Auto-Generate (interactive scheduling)

- One-click schedule generation that reproduces the current grid with zero ripple on
  entry, then re-solves around your edits live.
- Every edit is a **pin** (keep) or **free** (empty); the engine refills to stay legal
  and balanced, highlighting changed ("ripple") cells in amber.
- **Scope control:** Limited / Day(s) / Pay period / Whole range — how far the engine
  may rebalance.
- **Rejections** with reasons (ineligible, unavailable, request-blocked, manual-locked,
  day-full) and **soft warnings** for allowed-but-non-ideal states.
- Sandbox **undo/redo** separate from the saved grid.
- **Accept** commits WYSIWYG (your edits + engine fills); **Cancel** discards.
- **Clear Auto** removes a run's auto-generated cells (including adjacent-month spill).

## Scheduling Engine

- Multi-step constraint solver: standing commitments → coverage minimums → FTE-hour
  targets → day-off fill.
- Configurable **priority ordering** of competing goals (drag-to-rank), with always-
  enforced invariants pinned (one-per-day, eligibility, locks/manual, approved hard
  requests, per-day caps).
- **Named priority profiles** (snapshotted with author and timestamp; apply/save).
- Fairness optimization (fewest-in-run, longest-gap-since-last, fewest-historical) and
  desirability weighting per shift per weekday.
- Weekend pattern preferences (3-day / 4-day weekends), sequential off-day grouping.
- Per-staff shift min/max **count targets** per window (week / pay period / month /
  rolling days).
- **Shift follow rules** (allow/block what follows a shift) and **required followers**
  (auto-place a shift after another, per-day or per-run; e.g., ADM after CALL).
- Weekend-paired shifts (Sat+Sun as a unit, optionally including an adjacent holiday).
- Recovery/day-off auto-assignment with a configurable fulfillment-strategy order.
- Per-staff shift-hour overrides (weekday/weekend/holiday) and standing commitments.
- Historical assignment context for fairness baselines; confidence/step attribution and
  warnings (understaffing, FTE shortfall, cap breaches, follow-rule violations).

## Requests

- **Self-service (My Requests):** request a shift (OR semantics) or avoid a shift (AND),
  with a date range, work/leave/day-off selection, flexibility (hard vs. soft), and
  notes.
- **Leave queue** feedback showing how many already requested leave and your position,
  with a soft (non-blocking) per-day cap.
- **Day-off fulfillment order** per request (drag to rank strategies; per-staff
  override).
- Printable **confirmation receipt** with a reference ID; withdraw pending requests.
- **Grid request mode** ("/" toggle): keyboard entry of want/avoid (hard/soft) requests,
  plus approve (+), deny (!), reset (^); request overlay with status/kind coloring and
  filters (all / approved / pending / denied).
- **Review (Requests page):** status tabs with counts, full-text search, sortable table;
  approve/decline/unapprove/reopen/delete; approval places the shift and auto-reconciles
  related pending requests.
- **Policies:** how pending requests influence auto-scheduling (off / soft / full) and
  conflict resolution (reconcile first-come / honor always); human approvals never
  revoked.
- Optional **email confirmations** (SMTP).

## Staff Management

- Staff directory with sortable columns and a mini availability grid; active/inactive and
  auto-schedule indicators; per-row login status with management link.
- Profiles: initials, full name, employment type, FTE %, active and auto-schedule flags.
- **Eligibility** per shift per weekday with recurrence patterns; hard vs. prefer
  strength.
- **Availability:** quick day-of-week toggles plus advanced recurrence rules
  (every / pay-period week / ordinal weeks / every-N cycles), hard vs. soft, and
  **conditional availability** (based on another staffer working/not working).
- Per-staff shift **count targets** per window, and **shift-hour overrides**.
- **Standing commitments** (recurring pre-assignments, incl. an "any day" option).
- Unified recurrence picker with a live plain-English summary.
- Drag-to-reorder; safe delete (deactivates instead of deleting when assignments exist);
  undo toast.

## Settings

- **Shift types:** code, name, hours (weekday/weekend/holiday), color, category,
  leave/FTE/holiday-work flags, auto-schedulable, scheduling order, weekend & holiday
  pairing, day-off/fill-shift/off-shift flags, dedicated-column, max-per-day, follow
  rules, required follower, quick key, print styling, reordering.
- **Employment types:** default FTE, auto-schedule, eligible shifts, and default
  availability for new staff.
- **Staffing rules:** minimum staff per shift per weekday (and holidays).
- **Scheduling preferences:** weekend/off-day weights, soft leave-per-day limit, default
  Live scope, pending-request handling, conflict policy, day-off fulfillment order.
- **Pay-period preferences:** department-wide per-1.0-FTE shift targets with soft/hard
  strength.
- **Shift desirability:** −5…+5 per shift per weekday.
- **Equity factors:** weighted, enable/disable, reorderable (FTE-normalized).
- **Auto-generation priority:** drag-to-rank goal ordering with named profiles
  (permission-gated).
- **Printed-schedule columns:** staff-column include/exclude rules, aggregate columns
  (catch-all, member suppression), and count columns.
- **Pay periods:** hours-per-1.0-FTE and biweekly batch creation/regeneration.
- **Holidays:** auto-populate US federal (observed dates) or manual entry.
- **Date format:** nine app-wide format options.
- **Email (SMTP):** outbound mail config with a test-send.
- **Groups & permissions:** manage role groups and fine-grained permissions.

## Statistics / Equity Analytics

- Per-staff metrics: desirability (z-score), opportunity-adjusted score, holidays,
  per-shift counts, FTE hours, work days, leave days.
- Sortable table with deviation color-coding and a tallies toggle (raw counts of every
  shift code).
- Charts: stacked **bar** (shift distribution, optionally per-1.0-FTE), **pie/donut**
  (department share), and **heatmap** (staff × shift z-scores).
- **Radar** detail panel per staff vs. department average (z-scores, FTE-normalized).
- Filters: date range (all / pay periods / years / custom), employment type, minimum
  FTE, and by-name selection.
- **Saved views** (private or shared) and **CSV / PNG export**.
- Department-average summary cards per 1.0 FTE.

## Authentication & Security

- Email + password login (bcrypt, cost 12).
- **TOTP two-factor** (RFC 6238) with QR-code setup and manual key entry.
- TOTP secret encrypted at rest; **device trust** (remember device, configurable
  1–365 days, default 30).
- Account lockout (5 failures → 15 minutes) and per-email rate limiting.
- Login logging (result, reason, IP, user agent, timestamp) with a viewer.
- JWT sessions (NextAuth).
- **Group-based, fine-grained permissions** across Schedule, Requests, Staff,
  Statistics, Settings, Users, and Groups.

## User Management

- Create, edit, activate/deactivate, and delete login accounts; group assignment.
- Password management (min 8, upper/lower/number) and **TOTP reset** (admin).
- **Staff ↔ login linking** (auto-provisioned login shells; reset keeps the staff
  record).
- Sortable users table (status: active / disabled / needs-setup; 2FA state).
- Login activity log; safety guards (e.g., never leave zero active administrators).

## Account

- Change password (requires current); enable/disable TOTP; view profile and group.

## Printing

- Print-optimized schedule (chrome hidden, titled), shaped by printed-schedule column
  rules, aggregate/count columns, and per-shift print colors/bold.
- Printable request confirmation receipts.
