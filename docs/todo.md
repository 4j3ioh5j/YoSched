# YoSched — TODO

This is the working task list, in plain English. **Keep it current:** when David asks to add or
remove a task, update this file in the same session. Detailed open items are at the top; the shipped
archive is at the bottom for traceability (full technical detail lives in the numbered handoffs in
`~/Projects/handoffs/`, and `HANDOFFS.md` is the complete log).

---

## Other open items

- [ ] **Multi-cell drag / batch in all modes** — dragging a *selection* of cells as a group does not
  exist in either normal or Live mode (base drag is single-cell). Batch via picker/keyboard already
  works in both modes; this adds group DRAG. Open design questions first: offset axis (shift dates vs
  staff?), normal-mode swap-vs-displace, collision/off-grid rules. See handoff **#239**.
- [ ] **Verify the staging DB credential was rotated** — a since-deleted scratch file had a hardcoded
  staging DB password that is still in git history (flagged in handoff #147). Confirm it was rotated; if
  not, rotate it.
- [ ] **Multi-editor coordination — Slice 3: presence** — `SchedulePresence` table + ~5s heartbeat poll
  (TTL-reaped); page banner of active editors + per-cell focus outline. Advisory only. (Slices 1 & 2 —
  focus-refresh + optimistic conflict detection — already shipped.) See handoffs #152–#155.

---

## Shipped (archive)

> One-liners for quick scanning — full detail is in the linked handoffs. This archive starts at
> 2026-06-09; for everything shipped since (recurrence rework, request reconciliation, per-staff
> weekday/weekend hours #225, the multi-option 4a/4b engine, and the 4c "Options" UI that was added
> then rolled back), see handoffs **#190–#230** and `HANDOFFS.md`.

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
