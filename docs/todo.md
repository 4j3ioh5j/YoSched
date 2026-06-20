# YoSched — TODO

This is the working task list, in plain English. **Keep it current:** when David asks to add or
remove a task, update this file in the same session. Detailed open items are at the top; the shipped
archive is at the bottom for traceability (full technical detail lives in the numbered handoffs in
`~/Projects/handoffs/`, and `HANDOFFS.md` is the complete log).

---

## To do — before "Live" mode

### 1. Settings → Shift types: split "Hours per shift" into weekday / weekend / holiday
Today each shift type has a single **Hours per shift** field. Replace it with **three** fields:
- **Hours per shift (weekdays)**
- **Hours per shift (weekends)**
- **Hours per shift (holidays)**

Then integrate all three into the code so every place that computes a shift's hours uses the right
value for the kind of day (weekday vs weekend vs holiday).

*Implementation notes:* shift types currently store one `defaultHours`; this adds the weekend + holiday
split at the shift-type level. The engine's hour math already distinguishes weekday vs weekend (from the
per-staff overrides in handoff #225) but does **not** handle holidays yet. Needs a schema change +
migration with back-compat (existing `defaultHours` → the weekday value). Keep the three hour-math sites
in sync — engine `getShiftHours`, equity `graph/model.ts`, and `schedule-grid.tsx` (PP totals/alerts);
see #225 / the three-sites note.

### 2. Staff modal: "Override shift hours" toggle → per-staff, per-shift hours
Add a boolean **Override shift hours** to the Staff add/edit modal. When it's ON, open a shift picker
that lets you set a **different number of hours for each shift, for that one staff member**, by day
type. Example: **CARD (weekdays) = 8**.

*Implementation notes:* per-staff weekday/weekend overrides already exist (`StaffShiftOverride`, handoff
#225); this puts them behind the new boolean toggle and extends them to **holidays** to match item 1.
Builds on item 1's weekday/weekend/holiday model.

---

## Other open items

- [ ] **Verify the staging DB credential was rotated** — a since-deleted scratch file had a hardcoded
  staging DB password that is still in git history (flagged in handoff #147). Confirm it was rotated; if
  not, rotate it.
- [ ] **Multi-editor coordination — Slice 3: presence** — `SchedulePresence` table + ~5s heartbeat poll
  (TTL-reaped); page banner of active editors + per-cell focus outline. Advisory only. (Slices 1 & 2 —
  focus-refresh + optimistic conflict detection — already shipped.) See handoffs #152–#155.

---

## Next big feature (after the two items above)

- **"Live" mode — interactive what-if scheduling.** Turn on Live, then edit any cell however you like
  (drag, shift picker, keyboard, paste) and the engine **instantly re-solves** the rest to keep the
  schedule feasible, **highlighting every cell it had to change**. Revert/advance arrows = undo/redo;
  Accept commits, Cancel discards. Fully planned and de-risked (engine runs in-browser <5 ms; a real
  edit ripples ~3 of 20 cells, not a rebuild). See handoff **#231** for the full plan and decisions.

---

## Shipped (archive)

> One-liners for quick scanning — full detail is in the linked handoffs. This archive starts at
> 2026-06-09; for everything shipped since (recurrence rework, request reconciliation, per-staff
> weekday/weekend hours #225, the multi-option 4a/4b engine, and the 4c "Options" UI that was added
> then rolled back), see handoffs **#190–#230** and `HANDOFFS.md`.

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
