# YoSched — User Manual

*A complete guide to scheduling staff with YoSched.*

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Core Concepts](#2-core-concepts)
3. [Getting Started](#3-getting-started)
4. [Roles & Permissions](#4-roles--permissions)
5. [The Schedule Grid](#5-the-schedule-grid)
6. [Auto-Generate](#6-auto-generate)
7. [Requests](#7-requests)
8. [Staff Management](#8-staff-management)
9. [Statistics & Equity](#9-statistics--equity)
10. [Settings](#10-settings)
11. [User Management](#11-user-management)
12. [Your Account](#12-your-account)
13. [Printing](#13-printing)
14. [Appendix A — Keyboard Shortcuts](#appendix-a--keyboard-shortcuts)
15. [Appendix B — Glossary](#appendix-b--glossary)
16. [Appendix C — Permission Reference](#appendix-c--permission-reference)

---

## 1. Introduction

YoSched is a web application for building and managing staff work schedules for a
department — particularly clinical/medical teams that juggle call shifts, coverage
minimums, leave requests, and fairness across people.

It gives you:

- A **spreadsheet-style schedule grid** with click, keyboard, and drag editing.
- An **auto-generator** that fills the schedule for you while respecting coverage
  rules, eligibility, requests, and hour targets — and lets you steer it interactively.
- A **request workflow** so staff can ask for shifts or time off, and schedulers can
  review and approve them.
- **Equity analytics** that show, with charts and z-scores, whether undesirable work
  is being shared fairly.
- Deep **settings** for shift types, staffing minimums, pay periods, holidays,
  desirability, and the scheduling engine's priorities.

The app uses a dark theme throughout. Most screens save automatically or show a
clear **Save** button with a "Saving… / Saved / Error" status.

---

## 2. Core Concepts

Understanding these terms makes the rest of the manual easier to follow.

| Term | Meaning |
|------|---------|
| **Staff member** | A person who can be scheduled. Identified by **initials** (a 2–4 character code shown on the grid). |
| **Shift type** | A code such as `CALL`, `ORC`, `ORL`, `ADM`, or a leave type. Each has hours, a color, and scheduling rules. |
| **Assignment** | One staff member working one shift on one day (a single cell on the grid). |
| **Pay period** | A 14-day biweekly window. Hours are totaled and compared to targets per pay period. |
| **FTE** | Full-Time Equivalent. A 1.0 FTE works the full pay-period hours target (e.g., 80); a 0.5 FTE targets half. |
| **Coverage / staffing requirement** | The minimum number of staff that must work a given shift on a given day. |
| **Eligibility** | Whether a staff member is qualified/allowed to work a given shift. |
| **Availability** | The days/patterns a staff member is willing or able to work. |
| **Request** | A staff member's wish to work — or avoid — certain shifts on certain dates. |
| **Equity / desirability** | A fairness measure of how much undesirable work each person carries. |
| **Source** | Where an assignment came from: **Manual** (hand-placed), **Auto** (auto-generated), **Imported**, or **Request-placed**. |
| **Lock** | A flag that protects an assignment from being changed by the auto-generator or accidental edits. |

---

## 3. Getting Started

### 3.1 Signing in

1. Open the app; you'll land on the **Sign in** page.
2. Enter your **Email** and **Password**.
3. Click **Sign in**.

If your credentials are wrong you'll see **"Invalid email or password."**

### 3.2 Two-factor authentication (2FA)

If your account has 2FA enabled and you're on a new device, you'll be asked for a
**6-digit code** after your password:

- The prompt reads *"Enter the 6-digit code from your authenticator app."*
- Type the code from your authenticator app (Google Authenticator, Authy, 1Password,
  etc.). The six boxes auto-advance as you type, and the form submits automatically
  once all six are filled. You can also paste a full code.
- A wrong code shows **"Invalid verification code"** and clears the boxes.
- Check **"Remember this device for 30 days"** to skip 2FA on this device next time.
  (An admin can change the trusted-device duration; default is 30 days.)
- **Back to sign in** returns you to the password step.

See [Your Account](#12-your-account) for how to turn 2FA on or off for yourself.

### 3.3 Account lockout & rate limiting

To protect against guessing:

- **5 failed attempts** lock the account for **15 minutes**.
- Repeated rapid attempts are also rate-limited per email.

Both bad passwords and bad 2FA codes count toward the limit. If you're locked out,
wait or ask an admin.

### 3.4 The navigation bar

Across the top you'll find links to the areas you have permission to see:

- **Schedule** — the grid (everyone).
- **My Requests** — submit your own requests.
- **Requests** — review everyone's requests (schedulers).
- **Staff** — the staff directory.
- **Statistics** — equity analytics.
- **Settings** — configuration (admins/schedulers).
- **Users** — login accounts (admins).

On the right, your name and group badge link to your **Account** page, and there's a
**Sign out** button.

---

## 4. Roles & Permissions

Access is controlled by **groups**. Each group grants a set of fine-grained
permissions. Four groups exist out of the box:

| Group | Badge | What they can do |
|-------|-------|------------------|
| **Admin** | amber | Everything, including managing users and groups. |
| **Super User** | blue | Everything except (typically) user administration. |
| **Scheduler** | emerald | View/edit/auto-generate the schedule, view & approve requests, view/edit staff, manage statistics views, edit settings. |
| **Staff** | gray | View the schedule, submit their own requests, view statistics and settings. |

Admin and Super User are **system groups** with a locked, full permission set.
Scheduler and Staff are editable, and admins can create additional custom groups
(see [Groups & Permissions](#1011-groups--permissions)).

Individual permissions include things like *View Schedule*, *Edit Schedule*,
*Auto-Scheduler*, *Submit Own Requests*, *View All Requests*, *Edit Staff*,
*Manage Statistics Views*, *Edit Settings*, *Edit Auto-Generation Priority*,
*Edit Users*, and *Edit Groups*. The full list is in
[Appendix C](#appendix-c--permission-reference).

> **Tip:** If a nav link or button is missing for you, it's almost always a
> permission your group doesn't have. Ask an admin.

---

## 5. The Schedule Grid

The grid is the heart of YoSched. It's at **Schedule** (the home page).

### 5.1 Layout

- **Rows are days.** The view is padded out to whole pay periods, so you'll see a few
  dimmed days from the surrounding weeks. Each row shows the weekday and date.
- **Columns are staff members,** left to right in roster order. After the staff
  columns come optional **dedicated columns** (e.g., ICU, CARD) and **count columns**.
- The **date column** on the left is sticky. Click a date to highlight (focus) the row.
- **Staff headers** show initials. Hover a header for a tooltip of that person's
  equity numbers (overall deviation, desirability, holiday count, and key shift
  counts). Manual-only staff (not auto-scheduled) show their initials in **amber**.

**Visual cues on the grid:**

- Weekends have a slightly lighter row background; **holidays** get an amber tint
  (hover the date to see the holiday name).
- **Today** is ringed in light blue.
- A blue top-border marks the **first day of each pay period**.
- Each assigned cell is tinted in its shift's color, with the shift code shown.

### 5.2 Selecting and moving around

- **Click** a cell to make it active (blue ring). Click an already-selected cell to
  open the shift picker.
- **Arrow keys** move the active cell. Movement wraps between the staff columns and
  dedicated columns.
- **Shift+Click** selects a rectangular range from the last cell to the clicked cell.
- **Shift+Drag** selects a range by dragging.
- **Ctrl/Cmd+Click** toggles individual cells in/out of the selection (within a single
  staff column).
- Selected cells are highlighted green; the count appears as **"N selected"** in the
  toolbar.
- **Escape** closes a picker or clears the selection.

### 5.3 Assigning shifts

There are four ways to assign:

1. **Quick keys (fastest).** Each shift type can have a single-letter hotkey
   (configured in Settings). Press that letter to assign the shift to the active cell
   or to the entire selection.
2. **The shift picker.** Open it by clicking a selected cell, **right-clicking** a
   cell, or pressing **Tab**. The picker shows colored buttons for each shift, grouped
   into Work / Leave / Off. The current assignment has a white ring. A red dot on a
   button means a hard conflict; an amber dot means a soft warning. With a multi-cell
   selection, the picker shows **"Assign N cells"** and applies to all of them.
3. **Drag-to-swap.** Drag a shift from one cell to another. If the target is empty the
   shift moves; if it's occupied the two **swap**.
4. **Copy/paste from Excel.** Select a block, **Ctrl/Cmd+C** to copy, **Ctrl/Cmd+V**
   to paste a block (it fills down and right from the active cell). A summary toast
   reports what happened: *"N set · M locked · K unknown code · X conflict · Y day-cap."*

**Clearing:** Press **Delete** or **Backspace** to clear the active cell or the whole
selection. The **Clear** button in the picker does the same. Locked cells are skipped.

**Per-day caps:** Some shifts allow only one (or a few) per day (e.g., one `ORC`). If
you try to exceed the cap, the edit snaps back with a red popover:
*"Only one ORC allowed per day — {date} is already full."*

### 5.4 Locking assignments

Locking protects an assignment. A **locked** cell shows a yellow ring and:

- Can't be dragged, dropped into, deleted, or overwritten via the picker.
- Is never changed by the auto-generator.

Use locks to pin hand-placed assignments you don't want the auto-generator to touch.
(Manually-placed cells are also protected inside Auto-Generate even without an explicit
lock — see [§6.4](#64-why-an-edit-was-rejected).)

### 5.5 Dedicated columns (e.g., ICU, CARD)

Shift types flagged as **dedicated columns** appear as their own columns on the right.
Each cell lists the **initials** of everyone covering that shift that day.

- Click to select; click again (or press **Enter** / **F2**) to edit inline.
- Type a comma-separated list of initials (e.g., `JD, AB, SM`). Adding initials
  assigns the shift; removing them clears it. Unknown initials are flagged.
- Edits are **all-or-nothing**: if any part is blocked (a locked person, a day-cap),
  the whole edit is rejected.
- **Delete/Backspace** clears the whole roster for that day.
- Copy/paste works column-wise too.

### 5.6 Totals, counts, and indicators

- **PP Totals** button toggles a pay-period totals row at the end of each period. Each
  staff cell shows the **+/- hours versus their target**, color-coded: green = on
  target, red = under, amber = over, gray = no hours. Hover for the exact
  *"hours / target (±Δ)."* This preference is remembered in your browser.
- **Count columns** (right side) tally specific shift codes per day. A count turns red
  when that day is short of its staffing requirement.

### 5.7 Alerts

The **Alerts** button (with a count and color) opens a panel of issues for the current
month, in three categories:

1. **Pending requests** — requests still awaiting a decision.
2. **Pay-period hours** — staff meaningfully under or over their target (amber).
3. **Staffing coverage** — a day with nobody covering a required role (red — the most
   serious).

The button is **red** if there are any coverage gaps, **amber** for hours issues, and
gray when everything is muted or clear. Each alert has a **jump-to-day** link (it
scrolls to the day and flashes it) and a **mute** toggle. Muting is shared across all
schedulers and persists, so muted, known issues stop nagging the whole team.

### 5.8 Navigating months and pay periods

- **←**, **Today**, **→** move between months.
- Click the **month/year label** to open a picker: use the year arrows and the month
  grid to jump anywhere.
- The date range shown always rounds out to whole pay periods.
- For **past months**, a **Show all staff** toggle reveals people who have no
  assignments that month (hidden by default for a cleaner view).

### 5.9 Versions (save & restore)

The **Versions** button (shows `v{N}`, with `*` if there are unsaved edits) opens the
version history for the current month:

- Add an optional comment and **Save version** to snapshot the month.
- Each version lists its number, time, and comment, with badges for *current* and
  *auto-backup*.
- **Changes** shows a diff against the previous version (added / removed / changed /
  locked, with colored before→after chips).
- **Restore** reverts the month to that version (it confirms first and auto-saves your
  current state before restoring).

> Versions can't be saved or restored while you're in Auto-Generate (see below).

### 5.10 Copy, undo, redo

- **Ctrl/Cmd+Z** undoes; **Ctrl/Cmd+Shift+Z** or **Ctrl+Y** redoes.
- The toolbar's **↩ / ↪** arrows do the same.

---

## 6. Auto-Generate

Auto-Generate builds (or rebalances) the schedule for you, honoring coverage,
eligibility, locks, approved requests, and hour targets — and it does so
**interactively**, so you can nudge it and watch it adapt.

Requires the *Auto-Scheduler* and *View All Requests* permissions. Click the violet
**Auto-generate** button to enter.

### 6.1 How it works

1. On entry, YoSched loads the full rule set (staff, shifts, existing assignments,
   requests, availability) and reproduces your current grid exactly — **no changes yet**.
2. Every edit you make — a hotkey, a picker choice, a drag, a delete — is treated as a
   **pin** (something you want kept) or a **free** (something you emptied).
3. The engine re-solves: it keeps your pins and any locked/manual cells fixed, and
   refills the rest to keep the schedule legal and balanced.
4. Cells the engine changed to compensate are ringed in **amber** ("ripple").

The banner at the top shows the status (*"matches the current grid (no changes yet)"*
or *"N cell(s) changed"*), any soft warnings, and rejected edits.

### 6.2 Controlling how far it ripples (Scope)

Use the scope buttons in the Auto-Generate banner to control how aggressively the
engine rebalances:

| Scope | Effect |
|-------|--------|
| **Limited** | Smallest possible change — only what's needed to restore coverage. Least disruption. (Default; configurable in Settings.) |
| **Day(s)** | Re-solve the touched day(s) and rebalance their hours. |
| **Pay period** | Rebalance the whole affected pay period(s). |
| **Whole range** | Re-solve the entire visible month. Maximum rebalance. |

### 6.3 Sandbox undo/redo

While in Auto-Generate, **↩ / ↪** (and Ctrl+Z / Ctrl+Y) undo and redo within the
sandbox only — they don't touch your saved schedule until you Accept.

### 6.4 Why an edit was rejected

If an edit isn't allowed, the whole edit snaps back and a red popover explains why:

- **Ineligible** — the person isn't qualified for that shift.
- **Unavailable** — their availability rules forbid it.
- **Request-blocked** — an approved hard time-off/leave request forbids work, or an
  approved request forbids that specific shift.
- **Manual-locked** — a cell you placed by hand before entering can't be changed by the
  engine.
- **Day-full** — the shift's per-day cap is already reached.

**Soft warnings** (amber, in the banner) flag things that are allowed but not ideal
(e.g., coverage slightly below the floor, hours drifting). You can accept them.

### 6.5 Accept or Cancel

- **Accept** commits the result. What you see is what you save (WYSIWYG): every cell
  that differs from the saved schedule — your edits *and* the engine's fills — is
  written, tagged with source **Auto** for the run's month.
- **Cancel** discards everything and restores the saved grid.

### 6.6 Clear Auto

The red **Clear Auto** button removes all auto-generated cells for the current month
(including any that spilled into adjacent months from the same run). Hand-placed and
locked cells are left alone.

---

## 7. Requests

Requests let staff ask to work — or avoid — shifts, and let schedulers decide.

### 7.1 For staff: the *My Requests* page

Open **My Requests** (requires the *Submit Own Requests* permission and a login that's
linked to your staff record). If your login isn't linked yet, you'll see a note asking
you to contact an administrator.

**To submit a request:**

1. Choose a category:
   - **Request a shift** — "Shift(s) I'd like — work, a leave type, or the day off.
     Scheduling any one of them satisfies the request." (Selecting several is an
     **OR** — any one fulfills it.)
   - **Avoid a shift** — "Please don't assign me these shift(s)." (An **AND** — none
     should be assigned.)
2. Pick a **Start date** and, optionally, an **End date** (same day if blank).
3. Select one or more **shifts** (work shifts and/or leave types, including the day-off
   shift). Selected chips are highlighted.
4. *(For time-off requests)* a **leave-queue** note tells you how many people already
   requested leave on the busiest day in your range and where you'd sit in the queue.
   If you're over the department's suggested limit, you can still submit — *"the
   scheduler will decide."*
5. *(For a pure day-off request)* set **"How should we give you this day off?"** — drag
   the strategies into your preferred order (e.g., place an `ORC` the day before, pair
   two `ORL`s, or use a specific leave type). It's a best-effort preference, not a
   guarantee.
6. Toggle **"I'm flexible — treat this as a preference, not a firm request"** to make
   it a soft request rather than a firm (hard) one.
7. Add an optional **note**.
8. Click **Submit request**.

**After submitting,** a printable **confirmation receipt** appears (with your name, the
request, dates, status, timestamp, and a reference ID) — you can **Print** or **Close**
it.

**Your requests** are listed below the form, newest first, each with its status badge
(pending / approved / declined / withdrawn / fulfilled), a **Receipt** link, and — for
pending ones — a **Withdraw** button.

### 7.2 Entering requests on the grid (Request Mode)

Schedulers can enter requests directly on the grid. Press **`/`** to toggle **Request
Mode** (a violet banner appears). Now keyboard letters create *requests* instead of
assignments:

| Keys | Meaning |
|------|---------|
| *letter* | Want this shift (hard) |
| **Shift** + *letter* | Avoid this shift (hard) |
| **Alt** + *letter* | Want this shift (soft preference) |
| **Shift+Alt** + *letter* | Avoid this shift (soft) |
| **+** | Approve every pending request on the cell/selection |
| **!** | Deny every pending request on the cell/selection |
| **^** | Reset approved/denied requests back to pending |
| **Delete/Backspace** | Remove the request(s) — the shift on the schedule stays |

Press **`/`** again to leave Request Mode. The **RQ** toolbar button (with its filter
menu: All / Approved only / Pending only / Denied only) controls the request overlay
on the grid. In the overlay, a solid ring is an approved request, a faint ring is
pending, and struck-through rose text is denied; colors indicate want (green), avoid
(rose), leave (amber), off (sky), or mixed (violet).

### 7.3 For schedulers: the *Requests* page

Open **Requests** (requires *View All Requests*). The page lists every request with:

- **Status tabs** across the top (all / pending / approved / declined / withdrawn /
  fulfilled) with live counts.
- A **search box** ("Search requests…") that matches across staff, dates, shift codes,
  status, notes, approver, and more.
- A sortable table: **Staff, Dates, Request, Status, Source, Received, Approved**.

**Acting on requests** (requires *Edit Schedule*):

- Pending → **Approve** (places the shift if it can) or **Decline** or **Delete**.
- Approved → **Unapprove** (back to pending) or **Delete**.
- Declined/Withdrawn → **Reopen** or **Delete**.

When you **Approve** a single-shift request, the shift is placed on the schedule
immediately (if no locked day blocks it). Approving also **reconciles**: if the placed
shift now satisfies another pending request, that one auto-approves too. If you
unapprove something whose shift is still on the grid, an amber prompt warns you and
offers **Clear shift(s)** or **Keep**.

> **Viewers** (those with *View All Requests* but not *Edit Schedule*) see all requests
> and statuses but no action buttons, and the approver's name stays hidden.

### 7.4 How pending vs. approved requests affect auto-generation

Admins set two policies in **Settings → Scheduling Preferences**:

- **Pending requests in the auto-schedule:** *Only approved* (ignore pending) /
  *As preferences* (pending count as soft nudges) / *Full strength* (pending honored
  like approved). **Approved** requests always apply at their stated strength.
- **Conflicting shift requests:** *Reconcile (first-come)* — place tentatively, keep
  only if conflict-free, earliest request wins a contested slot — or *Honor always* —
  force every requested shift and keep it. Human-approved placements are never revoked
  either way.

---

## 8. Staff Management

Open **Staff** (requires *View Staff*; editing requires *Edit Staff*).

### 8.1 The directory

A sortable table of staff, with columns: **ID** (initials), **Name**, **Type**
(employment type), **FTE**, **Availability** (a mini Sun–Sat grid; an amber dot means
advanced rules also apply that day), **Auto** (✓ if auto-scheduled), and **Login**
(account status with a *manage →* link).

The top shows counts ("N auto-scheduled, M manual", plus inactive). Use **Show/Hide
inactive** to toggle archived staff and **+ Add Staff** to create someone. After a
save or delete, an 8-second **Undo** toast lets you reverse it.

### 8.2 Creating and editing a staff member

**+ Add Staff** creates a record (defaults: name "New Staff", initials "NEW", the first
employment type) and opens the editor. Click any row to edit. The editor has four
sections.

**Identity:**

- **Initials** — the 2–4 character grid code.
- **Full name.**
- **Employment type** — choosing a type applies *that type's defaults* (auto-schedule,
  FTE, eligible shifts, availability), replacing existing custom values.
- **FTE** — for FTE types, a value like 0.75 or 1.0 (up to three decimals). Drives hour
  targets and statistics normalization.
- **Active** — uncheck to archive (hidden from the schedule, excluded from
  auto-scheduling).
- **Auto-schedule** — uncheck to make this person manual-only.

**Scheduling — Auto-schedule these shifts:** Toggle which shifts this person is
eligible for (grouped Work / Leave). Each eligible shift can expand to configure:

- **Eligibility rules** — add rules making the person *eligible* or *ineligible* on
  certain dates, as a **Hard** rule (must obey) or **Prefer** (try to). Each rule uses
  the [recurrence picker](#84-the-recurrence-picker).
- **Count target** — how often they should work the shift: a mode (*at least / at most
  / exactly / between*), a count, and a window (*week / pay period / month / rolling
  N days*). Example: "at least 2 CALL per pay period."

**Scheduling — Override shift hours:** Turn on to set custom weekday/weekend/holiday
hours for specific shifts for this person (blank means "use the shift's default"). A
**reset** link clears a shift's overrides.

**Scheduling — Availability:**

- **Working days** — seven quick toggle buttons (Sun–Sat) for simple "every week"
  availability. An amber dot marks days also governed by an advanced rule.
- **Rules** — richer patterns. Each rule sets *Available* or *Not available*, a
  recurrence pattern, an enforcement level (*Hard* / *Soft preference*), and an
  optional **condition** ("only when {another staffer} is working / is not working").
  A plain-English summary appears under each rule.

**Scheduling — Standing commitments:** Recurring shifts the auto-generator pre-assigns
before anything else (e.g., a weekly leadership shift). Each commitment picks a shift,
a recurrence (including an **Any day** option), and optional notes.

### 8.3 Removing a staff member

In the editor, **Delete** asks to confirm. If the person has **no assignments** they're
permanently deleted; if they **have assignments** they're **deactivated** instead
(reversible by editing them and re-checking *Active*). An undo toast appears either way.

### 8.4 The recurrence picker

Used by eligibility rules, availability rules, and standing commitments to say *which
occurrences* a rule covers:

1. **Pick weekday(s)** — one or more of Sun–Sat (standing commitments also offer
   **Any day**).
2. **Pick an occurrence pattern:**
   - **Every week** — every occurrence of those weekdays.
   - **Pay-period week 1 / week 2** — only the first or second week of the pay period.
   - **Specific weeks of the month** — 1st / 2nd / 3rd / 4th / 5th / Last (multi-select).
   - **Specific weeks of the pay period** — the same ordinals within the pay period.
   - **Every N weeks** — a cycle length and slot (e.g., "every other Monday").
   - **Every N pay periods** — the same, indexed by pay periods.

A live plain-English sentence (e.g., *"1st and 3rd Fridays of the month"*) confirms
what you've built.

---

## 9. Statistics & Equity

Open **Statistics** (requires *View Statistics*). This page shows per-staff workload and
fairness metrics with interactive charts.

### 9.1 Filters and controls

- **Date range** — *All dates*, specific **Pay periods**, **Years**, or a **Custom**
  from/to range. Everything recomputes over the chosen range.
- **Staff picker** — filter by **employment type**, a **minimum FTE**, and/or specific
  people **by name** (chips). Filters combine.
- **Metric** — what to chart/measure: *All shifts*, a specific shift code, *Holiday*,
  or *Desirability*. Only equity factors your admin has enabled appear.
- **Chart type** — *Bar*, *Pie* (donut), or *Heatmap*. Incompatible metric/chart
  combinations are disabled and fall back to Bar.
- **Hide/Show Charts** and **Hide/Show Tallies** declutter the view; tallies add raw
  count columns for every shift code.

### 9.2 The table

Each row is a staff member. Columns depend on the enabled equity factors and the
tallies toggle, and may include:

- **Desirability** — an FTE-normalized z-score of undesirable-shift burden. Green
  (> +0.3) means *less* burden than average; red (< −0.3) means *more*; gray is near
  average. (Positive = treated favorably; negative = overburdened.)
- **Opp. Adj.** — opportunity-adjusted desirability, which accounts for people having
  different eligible shifts so they aren't unfairly flagged.
- **Holidays** — holidays worked.
- **Shift-code columns** — counts per tracked shift.
- **Hours** — FTE-counted hours.
- **Work Days / Leave Days.**

Click any header to sort. Click a row to open the **detail panel**.

### 9.3 The staff detail panel (radar)

Clicking a row opens a side panel with a **radar chart** comparing that person (solid
blue) to the **department average** (dashed gray, the 0σ ring). Axes are the enabled
factors (Undesirable, Holidays, each shift code). Outward = more burden than average;
inward = less. Hover an axis for the exact z-score and a description.

### 9.4 The charts

- **Bar — Shift Distribution:** stacked bars per staff by shift code (and Holidays).
  Toggle codes on/off via the legend chips. Can be shown per 1.0 FTE.
- **Pie — Department Share:** a donut of each person's share of the chosen metric.
- **Heatmap — Equity Grid:** staff (columns) × shift codes (rows); each cell shows the
  raw count colored by z-score (yellow = below average, red = well above).

Summary cards above the charts show department averages per 1.0 FTE.

### 9.5 Saved views & export

- **Saved views** (requires *Manage Statistics Views*) store a full filter/metric/chart
  configuration. **Save as…** creates one (optionally **Shared** with everyone, or
  private). You can **Save** (overwrite), **Rename**, toggle **Share/Make private**, or
  **Delete**. **↺ Reset** returns all controls to defaults.
- **Export CSV** downloads the current table (filters and visible columns applied).
- **Export PNG** downloads the current chart as a high-resolution image.

### 9.6 Reading the numbers

- A **negative, red** desirability score means that person is carrying *more*
  undesirable work than peers — a fairness flag worth acting on.
- Deviations beyond **±0.3** are highlighted; beyond **±2σ** on the radar is a
  statistical outlier worth investigating.
- Use **Opportunity-Adjusted** when people have very different eligible-shift sets.

---

## 10. Settings

Open **Settings** (requires *View Settings*; most changes need *Edit Settings*). Without
edit permission you'll see a **"View-only"** banner and disabled controls. Sections are
collapsible (state remembered in your browser); use **Reveal all** / **Collapse all** at
the top. Each section shows a *Saving… / Saved / Error* status, and many actions offer
an **Undo** toast.

### 10.1 Shift Types

*Configure shift codes, durations, and rules.* The core building block. For each shift:

- **Code**, **Name**, **Color**, **Category** (Work / Leave / Other).
- **Hours per shift** for **weekdays**, **weekends**, and **holidays** (holiday
  overrides weekend; set 0 where a shift doesn't accrue).
- **Quick key** — the single letter that assigns it on the grid.
- Flags: **This is a leave type**, **Counts toward FTE hours**, **Counts as holiday
  work**.
- Auto-scheduling: **Auto-schedulable**, **Scheduling order** (lower = placed first),
  **Pair Saturday and Sunday**, **Pair with leading/following holiday**, **Can be
  assigned on days off**, **Default shift for filling hours**, **Represents a day off**,
  **Dedicated column**, **Maximum per day**.
- **Shift follow rules** (per shift) — restrict what may be scheduled the *next* day, in
  **Allow** or **Block** mode, with an *any off-shift* toggle and per-shift checkboxes
  (e.g., after `CALL`, only `ADM` is allowed).
- **Required follower** — automatically place another shift after this one (e.g., `ADM`
  after `CALL`, or a day off after `ORC`), either *after each day* or *after a run*, and
  optionally counting toward staffing/targets.
- Printing options: **Print background** color and **Bold on schedule**.

Drag rows to reorder; **Add Shift Type** / **Delete Shift Type** (delete is disabled
while a shift is in use).

### 10.2 Employment Types

*Define employment categories and their default scheduling values.* Each type sets the
defaults applied to new staff of that type: **auto-schedule** on/off, **FTE
percentage**, **default eligible shifts**, and **default availability** (quick working
days plus advanced rules). Delete is allowed only when no staff use the type.

### 10.3 Staffing Rules

*Minimum staff per shift type per day of the week.* A grid of days (Mon–Sun plus a
**Holiday** row) × shift codes; each cell is the minimum required count. The
auto-generator always satisfies these first. Add/replace/remove columns via the header
menu; **Save Staffing Rules** to apply.

### 10.4 Scheduling Preferences

*Controls how the auto-scheduler places days off — staffing is always respected first.*

- **Prefer 3-day weekends**, **Prefer 4-day weekends**, **Prefer sequential days off**
  (all on by default).
- **Soft leave limit per day** — warn (don't block) when this many people already have
  leave on a date (0 = no limit).
- **Default scope of Live changes** — Limited / Day / Pay Period / Range (the default
  ripple scope for [Auto-Generate](#62-controlling-how-far-it-ripples-scope)).
- **Pending requests in the auto-schedule** — Only approved / As preferences / Full
  strength.
- **Conflicting shift requests** — Reconcile (first-come) / Honor always.
- **Default day-off fulfillment order** — a reorderable list of strategies (e.g., ORC
  adjacent, ORL pair, then specific leave types) the engine tries in order.

### 10.5 Pay-period Preferences

*Department-wide shift targets, expressed per 1.0 FTE.* One target per auto-schedulable
work shift (a frequency such as "2–4 CALL per pay period"), with a **Soft** or **Hard**
strength. The engine scales each target to a person's FTE; per-staff targets override
these.

### 10.6 Shift Desirability

*Rate how desirable each shift is per day of week.* A grid (work shifts × Sun–Sat) of
weights from **−5 (terrible)** to **+5 (great)**, color-coded red→green. The equity
engine and auto-generator use these to bias placement and measure fairness.

### 10.7 Equity Factors

*Which metrics factor into the equity score, and their weights.* Enable/disable factors
(built-in **Desirability** and **Holiday Work**, plus per-shift **counts**), set each
factor's weight (auto-normalized to a percentage), and reorder them. All values are
FTE-normalized.

### 10.8 Auto-Generation Priority

*How auto-generation decides what to schedule when goals compete.* Requires the *Edit
Auto-Generation Priority* permission (admin-only; others see a lock).

Some constraints are **always enforced** and shown pinned/read-only: one shift per
person per day, eligibility, locked & manual cells, approved hard requests, and per-day
caps.

Below those, a **drag-to-rank** list orders the competing goals (e.g., hard per-staff
limits, coverage, over-hours, under-hours, requests, fairness). Higher items win — a
factor is never traded away to improve one ranked below it. Dragging updates a **local
draft**; **Save** to apply or **Cancel** to revert. You can also store named
**profiles** (snapshotted with who saved them and when) and **Apply** them later.

### 10.9 Printed-schedule columns

Three sections shape the **printed** schedule only (the on-screen grid always shows all
staff):

- **Staff Columns on Printed Schedule** — include/exclude rules deciding who gets their
  own column (by employment type, FTE bounds, and shift conditions).
- **Additional Columns on Printed Schedule** — extra aggregate columns listing the
  initials of matching staff per day, with a **Catch-all** option and a **Suppress
  members** option.
- **Count Columns** — columns that count specific shifts per day (these also appear on
  the on-screen grid).

### 10.10 Calendar: Pay Periods & Holidays

- **Pay Periods** — set **Hours per Pay Period (1.0 FTE)** (e.g., 80), then batch-create
  periods from a **First Period Start** date and a **Number of Periods**. **Regenerate**
  replaces all periods (it confirms first). A preview table lists them.
- **Holidays** — **Auto-populate federal holidays** for the configured years (with
  observed-date handling), or add custom holidays by date and name. Remove any from the
  list.

### 10.11 General & System

- **Date Format** — choose one of nine formats (default *MMMM D, YYYY*); it applies
  everywhere dates appear.
- **Email (SMTP)** — configure outbound mail for request confirmations: enable, host,
  port, implicit-TLS toggle, username, password, and from-address. **Send test email**
  verifies it. Nothing sends until this is filled in and enabled.
- **Groups & Permissions** — manage the groups described in
  [§4](#4-roles--permissions). View each group's permission count and member count;
  create custom groups with a permission grid; edit non-system groups. System groups
  (Admin, Super User, Scheduler, Staff) have locked names; system groups can't be
  deleted, and a group with members can't be deleted.

---

## 11. User Management

Open **Users** (requires *View Users*; editing requires *Edit Users*). This manages
**login accounts**, which are distinct from staff records (a login can be *linked* to a
staff member).

### 11.1 The users table

Sortable columns: **Name, Email, Group, Staff** (linked staff member), **Status**
(*Active* / *Disabled* / *Needs setup*), **2FA** (On/Off), and **Actions**. Your sort
choice is saved to your profile.

At the top, admins with *Edit Settings* can set how long **2FA trusted devices** are
remembered (1–365 days; default 30).

### 11.2 Creating and editing users

**Add User** opens a form: **Name**, **Email**, **Password**, **Confirm password**, and
**Group**. Passwords must be at least 8 characters with upper- and lower-case and a
number. **Edit User** pre-fills the fields; leave the password blank to keep the current
one.

### 11.3 Activating, resetting, and deleting

- **Status** toggles Active/Disabled. A login **can't be activated** until it has both
  an email and a password (*"Set an email and password (Edit) before this login can be
  activated."*).
- **Reset 2FA** clears the user's 2FA so they can set it up again.
- For **staff-linked** logins, **Reset** disables the login and clears its
  email/password while keeping the staff member. For **standalone** logins, **Delete**
  removes the account.
- **Safety guard:** any change that would leave **no active administrator** is blocked.

### 11.4 Linking staff to logins

When a staff member is created, a disabled "Staff" login shell is provisioned
automatically. An admin completes it (adds email + password) and activates it from this
page; the **Staff** column then shows the linked person.

### 11.5 Login activity log

The collapsible **Login Activity** section lists recent attempts: **Time, Email,
Result** (Success/Failed), **Detail** (e.g., bad password, bad TOTP, unknown email,
rate limited, locked, disabled, trusted device, TOTP verified), **IP**, and **Browser**,
newest first.

---

## 12. Your Account

Open **Account** (your name in the top-right). You'll see your **Profile** (name, email,
group) and two actions:

- **Change Password** — enter your current password, then a new one (min 8 chars, upper,
  lower, and a number) twice. **Update password** confirms with *"Password updated."*
- **Two-Factor Authentication** — if disabled, **Set up 2FA** shows a **QR code** to
  scan with your authenticator app (or a manual key under *"Can't scan?"*); after
  **I've scanned it**, enter a 6-digit code to confirm. If enabled, **Disable 2FA**
  turns it off after a confirmation.

---

## 13. Printing

Click **Print** on the grid (or Ctrl/Cmd+P). The printout hides all chrome (toolbar,
banners, pickers, tooltips) and adds a centered **YoSched** title with the month. What
appears is shaped by the **printed-schedule** settings in [§10.9](#109-printed-schedule-columns):
staff-column include/exclude rules, aggregate columns (with optional member
suppression), count columns, and per-shift print background colors and bold codes.
Confirmation receipts on the **My Requests** page print the same way.

---

## Appendix A — Keyboard Shortcuts

**Navigation & selection**

| Key | Action |
|-----|--------|
| Arrow keys | Move the active cell |
| Click | Make a cell active |
| Click a selected cell | Open the shift picker |
| Shift + Click | Select a rectangular range |
| Shift + Drag | Select a range by dragging |
| Ctrl/Cmd + Click | Add/remove a cell from the selection |
| Right-click / Tab | Open the shift picker |
| Escape | Close the picker or clear the selection |

**Assigning**

| Key | Action |
|-----|--------|
| *letter* | Assign the shift mapped to that quick key |
| Drag a shift | Move it (swap if the target is occupied) |
| Delete / Backspace | Clear the cell(s) |
| Enter / F2 (dedicated column) | Edit the day's roster inline |
| Ctrl/Cmd + C / V | Copy / paste a block (Excel-compatible) |
| Ctrl/Cmd + Z | Undo |
| Ctrl/Cmd + Shift + Z, or Ctrl + Y | Redo |

**Request Mode** (toggle with `/`)

| Key | Action |
|-----|--------|
| / | Toggle Request Mode |
| *letter* | Want this shift (hard) |
| Shift + *letter* | Avoid this shift (hard) |
| Alt + *letter* | Want (soft) |
| Shift + Alt + *letter* | Avoid (soft) |
| + | Approve pending request(s) on the cell/selection |
| ! | Deny pending request(s) |
| ^ | Reset request(s) to pending |
| Delete / Backspace | Remove the request(s) (shift stays) |

---

## Appendix B — Glossary

- **Assignment** — one staff member, one shift, one day (a grid cell).
- **Auto / Manual / Imported / Request-placed** — the *source* of an assignment.
- **Coverage / staffing requirement** — the minimum staff a shift needs on a day.
- **Dedicated column** — a shift shown as its own column listing its roster's initials.
- **Desirability** — a −5…+5 rating of how pleasant a shift is on a given weekday.
- **Equity / z-score** — an FTE-normalized fairness measure vs. the department average.
- **FTE** — Full-Time Equivalent; scales hour targets and normalizes statistics.
- **Follow rule** — a restriction on what shift may come the day after another.
- **Hard vs. soft** — a hard rule/request must be honored; a soft one is a preference.
- **Lock** — protects a cell from auto-generation and accidental edits.
- **Pay period** — a 14-day window for hour targets and totals.
- **Required follower** — a shift automatically placed after another (e.g., `ADM` after
  `CALL`).
- **Ripple** — cells the auto-generator changed (amber) to keep the schedule legal after
  your edit.
- **Standing commitment** — a recurring shift pre-assigned before other scheduling.

---

## Appendix C — Permission Reference

| Permission | Category | Grants |
|------------|----------|--------|
| View Schedule | Schedule | See the grid |
| Edit Schedule | Schedule | Assign/clear/approve on the grid |
| Auto-Scheduler | Schedule | Use Auto-Generate / Clear Auto |
| Submit Own Requests | My Requests | Use the My Requests page |
| View All Requests | Requests | See & filter everyone's requests |
| View Staff | Staff | See the staff directory |
| Edit Staff | Staff | Create/edit/remove staff |
| View Statistics | Statistics | See equity analytics |
| Manage Statistics Views | Statistics | Save/share statistics views |
| View Settings | Settings | Open Settings (read-only) |
| Edit Settings | Settings | Change settings |
| Edit Auto-Generation Priority | Settings | Reorder auto-gen priority |
| View Users | Users | See the users list |
| Edit Users | Users | Create/edit/disable logins |
| View Groups | Groups | See groups |
| Edit Groups | Groups | Create/edit groups |
| View User Manual | Help | Open the in-app user manual (granted to level-1+ groups by default) |

Default group assignments are in [§4](#4-roles--permissions).

---

*This manual reflects YoSched's current behavior. Some settings note that finer
enforcement (e.g., soft/hard pay-period targets) is still being expanded; the UI labels
in those areas indicate when a control feeds existing logic versus newer behavior.*
