# YoSched — TODO

This is the working task list, in plain English. **Keep it current:** when David asks to add or
remove a task, update this file in the same session. Detailed open items are at the top; the shipped
archive is at the bottom for traceability (full technical detail lives in the numbered handoffs in
`~/Projects/handoffs/`, and `HANDOFFS.md` is the complete log).

---

## Other open items

- [ ] **Configurable & transparent auto-generation factor priority — CORE SHIPPED (Slices 0–2); 3–4 optional.**
  Settings → Auto-Generation Priority is admin-reorderable (drag-to-rank lexicographic tiers).
  - **Slice 0+1 SHIPPED** (3f0fd88 panel, 9066023 + 1d3a167 persist/reorder/drag) — reordering affected GRADING only.
  - **Slice 2a SHIPPED** (5d8e676) — split the aggregate factors into `hardLimits / coverage / overHours /
    underHours` (+ requests, fairness); expand-in-place migration; default `hardLimits > coverage >
    overHours > underHours > requests > fairness`.
  - **Slice 2b SHIPPED** (c13b3c3) — the greedy BUILDER now honors the order: coverage>overHours exceeds a
    soft PP target to cover; coverage>hardLimits exceeds a hard per-staff MAX to cover; feasibility floor is
    a lexicographic compare over [coverage, hardLimits]. Default order = byte-identical to pre-2b.
  - **KEY EMPIRICAL FINDING (handoff #377):** the original 8/4-ORL motivation NO LONGER reproduces — an
    August dry-run showed all current coverage gaps are genuine BODY SHORTAGES (0 are hours- or cap-blocked),
    so 2b is a deliberate no-op on today's data; payoff is future-facing. **Prioritizing which shift wins
    scarce staff is ALREADY handled** by each shift's `schedulePriority` (engine fills in that order; OR=lowest
    is the one that goes short) — editable in the shift-type editor. No new feature needed there.
  - **Optional remaining:** (3) unify the scattered soft weights (sequentialOff/3-4-day-weekend, equity) into
    the panel — where the dropped `weight` column returns; (4) dry-run preview before save. Design: handoffs #252/#376/#377.

- [ ] **NEGATE-on-empty request satisfaction (latent semantics)** — `assignmentSatisfiesRequestOnDate`
  treats an empty/null cell as NOT satisfying any request kind, including `NEGATE_SHIFT`. So an approved
  "don't give me X" reverts to pending on an empty day even though *absence* arguably satisfies the
  negation. Surfaced during the restore-reconcile fix (handoff #253): of the 114 stranded approvals that
  the v2-restore created, ~18 were NEGATE that now show pending until a cell exists. Pre-existing, not
  caused by that fix. Decide intended semantics (does empty satisfy a negation?), then optionally
  special-case NEGATE in the satisfaction helper. Low urgency.

- [ ] **Auto-generate ripple reduction — Option 4 SHIPPED as "Limited" scope; Option 3 parked** — one
  manual edit reshuffled many cells; humans will trade a less-optimal schedule for less disruption.
  **Option 4 SHIPPED** (`0a13880` + `0bbfeb6`): minimal/expanding freeing, now a dedicated **"Limited"**
  scope button (`Scope: Limited | Day(s) | Pay period | Whole range`, default Pay period). Limited frees
  minimally and widens only as coverage needs (least churn, but does NOT rebalance PP hours — pick Pay
  period for that). Day/PP/Range keep the original full-freeing/hours-rebalancing behavior.
  **Option 3 (disruption↔optimality slider) PARKED** on branch `option3-stability-wip` — the dial must
  influence the off-day/hours-fill distribution (not just `pickStaff`), which is bigger/riskier than
  planned; alternative is a post-solve snap-back (handoff #248 Option 5). Decide after using Limited.
  OR-Tools deliberately NOT adopted (Live runs client-side). Full design: handoffs #248/#249.

- [ ] **Day-off fulfillment-strategy ordering — LEAVE fallback + ORL_PAIR (DEFERRED)** — let staff rank
  *how* a requested day off is produced, to conserve their leave pool. Soft hints at the **lowest
  objective priority** — never disrupts coverage, scheduler can override. **SHIPPED & deployed:** slice 1a
  (`c3af34f` — schema `offStrategyOrder` cols, validators, `/my-requests` reorder widget, Settings
  dept-default editor, `/requests` display, undo/restore) + slice 2 (`9ed5a17` — engine consumes
  `ORC_ADJACENT` as a soft `requestBias` tie-break toward the prior-day ORC slot → post-call frees the
  day; + holds the requested pure-off day off via `requestBlocksWork` AND a `placeFollowerAfter` work-
  follower guard). Today: orders are captured/displayed, ORC_ADJACENT is honored, the day is held off;
  `LEAVE:<id>` / `ORL_PAIR` tokens are captured-but-inert (the day is still held off, just not leave-
  credited/ORL-freed — scheduler applies those manually). **DEFERRED by David 2026-06-21 (chose to ship
  1a+2):** (3a) hours-aware LEAVE fallback — place a ranked leave on the held-off day only when it
  strictly fits PP hours (`current<target && current+leaveHrs<=target`, no overshoot/overage), scanning
  the order for the first *feasible* leave. **Gotcha for whoever picks this up:** it must also thread
  `offStrategyOrder` into `assignmentSatisfiesRequestOnDate`/request-reconciliation so a leave-placed day
  *satisfies/auto-approves* the OFF request (a leave shift isn't an off shift, so today it wouldn't) — and
  handle that the held cell is *empty* before STEP 4 for `kind:"OFF"` (use raw `grid`, not `getCell`).
  (3b) `ORL_PAIR` — bias ORL pair distribution so a freed 8h day lands on the requested date; touches the
  3 hour-computation sites. Codex blocked the 3a plan 4× surfacing these (#1200/#1202/#1204) — real,
  delicate reconciliation-engine work, hence deferred. Slice-2 follow-up (Codex #1186): restore route
  should pass `validLeaveShiftIds` to `parseOffStrategyOrder` so a crafted `schedule:edit` restore can't
  persist a stale `LEAVE:<id>`.
- [ ] **Make the request "Reference" lookup-able** — receipt/email "Reference" = the request cuid PK,
  persisted but not searchable anywhere. Cheap win: add `r.id` to the admin `/requests` search haystack
  (one line). Consider a short human-friendly `referenceCode` only if staff read it aloud.
- [ ] **Multi-cell drag / batch in all modes** — dragging a *selection* of cells as a group does not
  exist in either normal or Live mode (base drag is single-cell). Batch via picker/keyboard already
  works in both modes; this adds group DRAG. Open design questions first: offset axis (shift dates vs
  staff?), normal-mode swap-vs-displace, collision/off-grid rules. See handoff **#239**.
- [ ] **Multi-editor coordination — Slice 3: presence** — `SchedulePresence` table + ~5s heartbeat poll
  (TTL-reaped); page banner of active editors + per-cell focus outline. Advisory only. (Slices 1 & 2 —
  focus-refresh + optimistic conflict detection — already shipped.) See handoffs #152–#155.
- [ ] **Cell lock toggle (persist `isLocked`)** — add a user-facing per-cell lock/unlock control that
  writes `Assignment.isLocked` to the DB (currently nothing ever sets it true — the 🔒/🔓 in the cell
  tooltip is read-only, and the lock machinery is plumbed through the engine / Clear-Auto / Live but
  dormant). Opt-in pin: a locked cell is held fixed across auto-runs and rejected by edit/delete/swap
  until unlocked — works for *auto* cells too, not just manual. Needs a lock API (PATCH), grid affordance,
  and an unlock path. Complements the manual-cell protection shipped this session (manual cells are
  already safe by default; this lets you additionally freeze engine-placed cells).

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
