# YoSched — TODO

## Open

_(none)_

## Done

- [x] **Rethink Staff ↔ Users linking** — eager auto-provisioning: every active staff gets a disabled shell login (3 gates: email, password, admin Active toggle), kept 2 entities 1:1 via `User.staffId`, manual link dropdown removed, `/users` is the activation home, `/staff` shows read-only login status. Last-active-admin invariant + shared `effectivePermissions`. Also dropped the unused `Staff.email` field and hardened the seed admin. 4 slices + seed, all CR-approved & deployed 2026-06-10. See handoffs #131, #132 + `docs/staff-users-linking-plan.md`.

- [x] **Statistics page truncated staff names** — `/equity` Staff Member column capped names at `max-w-[60px]` ("Corey Do…", "David He…"). Dropped the cap (whitespace-nowrap) + widened column w-44→w-56. Commit `c75ddcb`, deployed 2026-06-09.
- [x] **Staff modals email field** — optional `Provider.email` (nullable) + Email input on the staff add/edit modal, validated via pure `normalizeOptionalEmail` (empty→null, else plausible-address, trimmed+lowercased), enforced in the staff API. Independent of the linked login User's email (see Staff↔Users rework). Migration `20260609170000_add_provider_email`. Commit `b7a487d`, deployed 2026-06-09.
