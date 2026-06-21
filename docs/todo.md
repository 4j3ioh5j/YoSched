# YoSched — TODO

This is the working task list, in plain English. **Keep it current:** when David asks to add or
remove a task, update this file in the same session. Detailed open items are at the top; the shipped
archive is at the bottom for traceability (full technical detail lives in the numbered handoffs in
`~/Projects/handoffs/`, and `HANDOFFS.md` is the complete log).

---

## Other open items

- [ ] **Day-off fulfillment-strategy ordering (My Requests)** — let staff rank *how* a requested day
  off is produced, to conserve their leave pool. A day off is an outcome manufacturable several ways:
  `ORC_ADJACENT` (ORC the day before → post-call off, free), `ORL_PAIR` (2 ORLs anywhere in the PP →
  frees one 8h day, placeable on the requested date, free), and one-to-many ranked specific leave
  types (`LEAVE:<shiftTypeId>`, burns the pool). Engine-aware (it tries the order top-down, stops at
  first feasible) but every strategy is a **soft hint at the lowest objective priority** — never
  disrupts coverage, scheduler can override. Order = department default + per-user override (settings);
  default ships `ORC_ADJACENT → ORL_PAIR → leave types`. 3 slices: (1) schema `offStrategyOrder
  String[]` + settings + `/my-requests` reorder UI + scheduler-facing display; (2) engine LEAVE +
  ORC_ADJACENT; (3) engine ORL_PAIR (hours-math, touches the 3 hour-computation sites). Separate cheap
  win surfaced same convo: receipt "Reference" = request cuid PK, persisted but not lookup-able — add
  `r.id` to the admin `/requests` search haystack.
- [ ] **Multi-cell drag / batch in all modes** — dragging a *selection* of cells as a group does not
  exist in either normal or Live mode (base drag is single-cell). Batch via picker/keyboard already
  works in both modes; this adds group DRAG. Open design questions first: offset axis (shift dates vs
  staff?), normal-mode swap-vs-displace, collision/off-grid rules. See handoff **#239**.
- [ ] **Multi-editor coordination — Slice 3: presence** — `SchedulePresence` table + ~5s heartbeat poll
  (TTL-reaped); page banner of active editors + per-cell focus outline. Advisory only. (Slices 1 & 2 —
  focus-refresh + optimistic conflict detection — already shipped.) See handoffs #152–#155.

---

## Shipped (archive)

- [x] **Requests page: sortable headers + search field** — every data-column header on `/requests` is click-to-sort (1st click asc, same header again reverses; different header starts asc; ▲/▼/↕ indicators); a search box filters across everything visible in a row (multi-term AND, case-insensitive). Client-side, session-only. New pure tested `lib/request-list.ts` (null-approved rows sort last in both directions). `bd776b9`, #245.
- [x] **Alerts collapsed by default, grouped by category** — the Alerts modal now opens fully collapsed (compact category overview: Pending requests / Pay period hours / Daily staffing); the user expands the category they want. New `ALERT_CATEGORIES` single-source constant; `useLayoutEffect` resets to all-collapsed on every open (no pre-paint flash). `55f15f6`, #244.

> One-liners for quick scanning — full detail is in the linked handoffs. This archive starts at
> 2026-06-09; for everything shipped since (recurrence rework, request reconciliation, per-staff
> weekday/weekend hours #225, the multi-option 4a/4b engine, and the 4c "Options" UI that was added
> then rolled back), see handoffs **#190–#230** and `HANDOFFS.md`.

- [x] **Verify the staging DB credential was rotated (#147)** — RESOLVED: David rotated the staging DB credential and notified the agent (2026-06-21). The old password leaked in git history (`_scratch/test-autoschedule.ts`, deleted commit `b000686`) is now invalid; optional `git filter-repo` history scrub remains available but isn't required post-rotation. #243.
- [x] **Re-enter auto-arrange (Live) on an already-Accepted auto run** — RESOLVED by design, no new code needed: the Auto-generate button IS the Live entry point (merged #241), and `enterLive()` seeds the sandbox from the current saved DB grid (which contains the accepted auto cells) + a no-op re-solve → re-clicking Auto-generate on an accepted run resumes the interactive rearrange (edit → engine compensates → Accept), exactly the pre-Accept experience. Re-Accept re-stamps `source=auto`+`autoMonth` so Clear Auto still wipes the run. (Not a literal restore of the pre-Accept undo history — a fresh Live session seeded from the saved grid — but functionally identical.) #242.
- [x] **Richer scheduler-cell hover tooltip (provenance + request approval detail)** — parallel cell tooltip (initials always; Assignment/Source/Requests) showing provenance (Auto / Manual / "Auto → Manual (was X)" via new nullable `Assignment.autoShiftTypeId` / Imported / Request-placed), request status (Auto-/Manually-approved/-denied, Pending, Fulfilled, Withdrawn) + approver name (2b-1) + editor "changed by X" (2b-2, wired `Assignment.updatedBy` across all write paths); names schedule:edit-gated. Preview cells show Source:Auto; tooltip shows ALL requests regardless of RQ toggle/status filter. 4 commits `3ef6e2c`/`340dac1`/`3da6ed2`/`a575cce`, #242.
- [x] **"Live" mode — interactive what-if scheduling** — toggle Live, edit any cell (picker / keyboard / drag-displace / paste, single or selection-batch) and the engine instantly re-solves the rest to compensate (amber ripple), scoped Day / Pay period (default) / Whole range; live breach flags; Ctrl-Z + ↩/↪ sandbox; Accept saves the diff / Cancel discards; locked cells held fixed. New `scenario.ts` (`applyScenario`) + `build-auto-schedule-input.ts` + `GET /api/auto-schedule/inputs` + grid wiring. ~12 slices, `961992c`, handoffs #231/#235–#239. (Outstanding: multi-cell *drag* — see open items.)
- [x] **Staff modal: "Override shift hours" toggle → per-staff, per-shift hours by day type** — master toggle reveals a per-eligible-shift weekday/weekend/holiday editor; new `StaffShiftOverride.durationHrsHoliday` (nullable, mirrors weekend when unset); all 3 hour-math sites read the holiday column. `208ca9d`, #234.
- [x] **Shift types: split "Hours per shift" into weekday / weekend / holiday** — three per-day-type hour fields per shift type (`defaultHours` = weekday + new `defaultHoursWeekend`/`defaultHoursHoliday`); dropped the "Count hours on weekends" flag (0 vs non-zero now encodes it). All 3 hour-math sites holiday-aware (holiday wins over weekend). `28c738c`, #232.
- [x] **Refresh the requests inbox after a schedule change honors/un-honors a request** — focus/visibility revalidation, client-only. `873a9ce`, #151.
- [x] **Collapse fee-basis staff into one "OTHER" print column** — print-only, global Settings toggle, data-driven by `EmploymentType.collapsesIntoOther`. `b19bf31`, #149.
- [x] **Printed schedule polish + page-width fit** — brand header, bold black headers, fixed row height, `table-layout:fixed` to fit the page. `a2ec652`/`7f2d23b`/`22dce87`, #148/#149.
- [x] **Staff request form → Request / Avoid (OR semantics)** — dropped Time-off/Leave tabs; Request a shift / Avoid a shift with multi-select chips. `b000686`, #147.
- [x] **Sortable /users columns + per-login persisted sort** — click headers to sort, group sorts by hierarchy, sort saved per account. `76665ff`, #146.
- [x] **Printed schedule: month-only + B&W letters + "Bold on schedule" flag** — print-only; new `ShiftType.boldOnSchedule` + Settings checkbox. `0ac63a9`, #143.
- [x] **Users page + permissions admin overhaul** — widened page, centered modals, new `requests:view` permission, closed a pending-request grid leak. `18bbef0`, #139.
- [x] **Rethink Staff ↔ Users linking** — auto-provisioned disabled shell logins, 1:1 via `User.staffId`, `/users` is the activation home. #131/#132 + `docs/staff-users-linking-plan.md`.
- [x] **Statistics page: stop truncating staff names** — dropped the `/equity` name-width cap, widened the column. `c75ddcb`.
- [x] **Staff modal email field** — optional, validated, independent of the linked login's email. `b7a487d`.
