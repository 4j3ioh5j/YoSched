# YoSched — TODO

## Open

- [ ] **Consolidate request modal Off + Leave tabs** — the request modal currently has separate "Off" and "Leave" tabs that should be merged into one. (Requested 2026-06-10.)

## Done

- [x] **Users page + permissions admin overhaul** (`18bbef0`, CR #577 BLOCK→#583 APPROVED, deployed 2026-06-10) — Widened `/users` (`max-w-7xl`→`max-w-screen-2xl`); converted Groups & Permissions list + its edit form from inline downward accordions to **centered modals**. New **`requests:view`** permission; editor categories now mirror the nav tabs (split **My Requests** = `requests:self` and **Requests** = `requests:view` out of Schedule). `/requests` inbox re-gated `schedule:view`→`requests:view` (Staff excluded). New pure `isRequestVisibleToViewer` + server-side filter on the schedule page so users without `requests:view` never receive **others' pending** requests (own + approved only) — closes the grid-chrome leak; leave-queue standing (counts-only) untouched. Collapsed 4 drifting permission lists into one `src/lib/permission-catalog.ts` (fixes CR #578: API validator had dropped `requests:view`). See handoff #139.

- [x] **Rethink Staff ↔ Users linking** — eager auto-provisioning: every active staff gets a disabled shell login (3 gates: email, password, admin Active toggle), kept 2 entities 1:1 via `User.staffId`, manual link dropdown removed, `/users` is the activation home, `/staff` shows read-only login status. Last-active-admin invariant + shared `effectivePermissions`. Also dropped the unused `Staff.email` field and hardened the seed admin. 4 slices + seed, all CR-approved & deployed 2026-06-10. See handoffs #131, #132 + `docs/staff-users-linking-plan.md`.

- [x] **Statistics page truncated staff names** — `/equity` Staff Member column capped names at `max-w-[60px]` ("Corey Do…", "David He…"). Dropped the cap (whitespace-nowrap) + widened column w-44→w-56. Commit `c75ddcb`, deployed 2026-06-09.
- [x] **Staff modals email field** — optional `Provider.email` (nullable) + Email input on the staff add/edit modal, validated via pure `normalizeOptionalEmail` (empty→null, else plausible-address, trimmed+lowercased), enforced in the staff API. Independent of the linked login User's email (see Staff↔Users rework). Migration `20260609170000_add_provider_email`. Commit `b7a487d`, deployed 2026-06-09.
