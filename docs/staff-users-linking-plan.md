# Staff ↔ Users linking — design & pickup spec

Status: **design locked (revised direction), not yet built.** `docs/todo.md` item #3.
Supersedes the earlier "keep manual link" draft. Foundation shipped: Provider→Staff
rename (#130); unused `Staff.email` removed (#131).

## Goal

Eliminate the manual, easy-to-forget Staff↔User linking. Every active staff member
should *automatically* have a login that the admin only has to **complete** (email +
password) and **enable** — no creating a second entity, no picking a link from a
dropdown.

## Locked direction (Eager auto-provisioning + three gates)

1. **Two tables, 1:1 link via `User.staffId` — column stays, UI link field goes.**
   The FK is how a User row knows which Staff it is (powers name sync + self-service
   `session.staffId`). We are NOT merging tables / sharing a PK (would re-key the
   existing login and its NextAuth session rows — too invasive for the payoff). What's
   removed is the **manual link dropdown on `/users`**, not the column.
2. **Eager shell provisioning.** Creating an active Staff auto-creates a paired,
   **disabled** `User`: `staffId` = staff id, `name` = `staff.name`, `email` = NULL,
   `passwordHash` = NULL, `isActive` = false.
3. **Three gates to authenticate — ALL required:**
   1. email set, 2. password set, 3. admin has toggled the account Disabled→**Active**.
   The admin's explicit toggle is the final human gate; email+password alone do NOT
   auto-activate. **Already enforced by `auth.ts`:** `if (!user.isActive) return null`
   (gate 3), password compare (gate 2), email lookup never matches a NULL-email shell
   (gate 1). Only change needed: a defensive `if (!user.passwordHash) return null`
   since the field becomes nullable.
4. **`Staff.name` is canonical; write-through sync to `User.name` on rename.** Keep the
   `User.name` column (still needed for staff-less admin logins). Resolves the old
   "canonical name" open question.
5. **One email per person, on `User`.** `Staff.email` already removed (#131). No
   Staff-side email.
6. **Admin sets the initial password** at activation (no invite/self-set flow now;
   possible later enhancement).

## Lifecycle rules

- **Deactivate staff** (`isActive=false`, the soft-delete path when assignments exist)
  → also set the linked `User.isActive=false`. **Re-activating staff does NOT
  auto-re-enable the login** — admin re-toggles gate 3 deliberately.
- **Hard-delete staff** (only when no assignments) → delete the linked `User`, **via the
  shared user-lifecycle module** so it inherits the same guards and cleanup as `/users`
  DELETE — refuse if the user is an admin / would break the last-admin invariant, and
  **delete the user's private saved graph views first** (`users/route.ts:147`,
  `onDelete: SetNull` would otherwise orphan private views). "Shell" is not special-cased
  on delete: whether the login is an un-completed shell or a fully completed non-admin
  login, the same guarded routine runs.
- **Activate guard:** the Disabled→Active toggle is blocked until email + password are
  set, so "Active" never lies.

## Admin-safety guards (a staff-linked admin must not be lockable out)

The admin-is-also-staff case makes the lifecycle side-effects dangerous. Verified
current protections (users `DELETE` route): self-delete blocked (`id === userId`);
equal-or-higher group level blocked (`targetUser.group.level >= groupLevel`) — so admins
can't delete each other (Admin is the top level). **Two gaps (CR #525):** (a) that guard
is group-based and is *skipped* when the target's `groupId` is null; (b) `/api/users`
**PUT** can change `role`/`groupId` (`users/route.ts:96`), so the last admin can be
*demoted* to zero-admins without any delete. The new staff-lifecycle side-effects also
bypass the DELETE route entirely. So:

1. **One shared, tested user-lifecycle module** (`src/lib/user-lifecycle.ts`) is the
   single chokepoint for the dimensions that affect the invariant only: **`isActive`,
   `role`, `groupId`, and existence (create/delete)**. Every path that changes those goes
   through it — `/api/users` POST/PUT/DELETE **and** the staff lifecycle hooks. **Out of
   scope (CR #527): credential/security writes stay as direct writes** — they can't change
   who can administer: `passwordHash` (password change), `failedAttempts`/`lockedUntil`
   (login throttling), `totpSecret`/`totpEnabled` (reset-totp). The module is about
   "who can administer," not "all User writes."
2. **"Administrator" = effective `users:edit`, resolved like `getSession` (CR #527).**
   NOT a `role` string. Permissions come from `group.permissions` when the user has a
   group, else the role default (`auth-guard.ts:64–80`); both `admin` and `manager`
   defaults include `users:edit`. Extract that resolution into a shared pure helper
   `effectivePermissions(role, group)` reused by `getSession` AND the invariant check —
   so a grouped user, a `groupId=null` user, and a manager are all counted correctly.
   This closes both the `groupId=null` gap and the role-vs-effective-permission gap.
3. **Staff-lifecycle never touches an administrator's login.** Staff deactivate/hard-delete
   skips the linked-`User` side-effect when that user has effective `users:edit` —
   administrator logins are managed only from `/users`, never coupled to staff state.
4. **Last-active-administrator invariant — ALL paths, incl. GROUP edits (CR #529).** The
   property is system-wide: *there is always ≥1 active user with effective `users:edit`*.
   The guard is one shared function `assertUsersAdminSurvives(tx, change)` that applies a
   described change in-memory, recomputes the set of active users with effective
   `users:edit` (via `effectivePermissions`), and returns 409 if that set would be empty.
   Every mutation that can shrink the set calls it — not just User writes:
   - **`/api/users`** DELETE; PUT (`role` / `groupId` / `isActive`); the Disabled⇄Active toggle.
   - **staff-lifecycle** disable/delete side-effects.
   - **`/api/settings/groups`** PUT (a `permissions` edit can strip `users:edit` from the
     group the last admin is in — `groups/route.ts:78`) and DELETE (removing a group flips
     its members to the role-default, changing their effective perms — `groups/route.ts:89`).
   So the invariant guard is exported for the groups route to call too; it is NOT only a
   User-mutation concern.
5. **Backfill skips already-linked staff** — the admin keeps their existing login; no
   duplicate shell is created (slice 1).

## Schema change

- `User.email` → **nullable**; `User.passwordHash` → **nullable**. Postgres allows many
  NULL emails under the `@unique` index (NULLs aren't equal) — shells coexist;
  uniqueness enforced once a real email is set.

## Current model (verified pointers — still accurate)

- `User.staffId String? @unique` → `Staff.id`, `onDelete: SetNull` (`prisma/schema.prisma`).
- Link set only from `/users` today (`src/app/api/users/route.ts` — `normalizeStaffId` +
  `staffLinkConflict` in `src/lib/user-link.ts`; 409 on conflict). **This dropdown gets removed.**
- Self-service consumer: `src/lib/auth-guard.ts` resolves `session.staffId`;
  `src/app/api/my-requests/route.ts` self-scopes to it (403 "ask an administrator" if no
  staffId). With eager provisioning every staff has a login, so the 403 path becomes rare
  (only staff-less admins / not-yet-activated).
- Login: `src/lib/auth.ts` (authorize — isActive/lockedUntil/password checks).

## Slice plan (small, reviewable, CR each)

1. **Schema + nullability + backfill.** `User.email`/`passwordHash` → nullable; migration.
   **All `passwordHash` consumers guarded for null (CR #525):** `auth.ts:48`
   (`!passwordHash → null`), login **pre-check** (`api/auth/pre-check/route.ts:40`), and
   **password-change** (`api/auth/password/route.ts:19`) — a shell with no password can't
   pre-check, log in, or "change" a non-existent password. Nullable-`email` type/UI
   handling where `User.email` is read as non-null today. One-time **idempotent** backfill:
   disabled shells for active staff lacking a login, **assigned the Staff group**, skipping
   any staff already linked (no dup), with `staffId` conflict protection. No new UX. Tests:
   backfill idempotency + Staff-group + skip-linked; null-password guards on all three auth paths.
2. **Auto-provision + name sync + lifecycle.** Staff POST → create disabled shell (Staff
   group); Staff PUT → write-through `User.name`; staff deactivate → disable linked user;
   staff hard-delete → delete linked user. **All User mutations go through
   `src/lib/user-lifecycle.ts`** (admin-skip + last-active-admin guard + saved-graph-view
   cleanup on delete). Tests incl. hostile cases: deactivating a staff-linked admin (no-op
   on the login), deleting/demoting the last admin (409), sole-admin self-deactivate.
3. **`/staff` read-only login status.** Each staff row shows a badge — *Disabled /
   Needs email+password / Active* — derived from the linked `User`. **No credential
   editing on `/staff`** (DECIDED: activation lives entirely on `/users`). Read-only, so
   `staff:view` gating is sufficient; a "Set up login →" deep-link points at `/users`.
4. **`/users` is the activation home.** Complete a shell here: set email + password, set
   role/group, flip Disabled⇄Active (blocked until email+password present). All gated on
   `users:edit` (already the case) and routed through the user-lifecycle module
   (last-active-admin guard on role/group/active changes). Remove the now-pointless
   `staffId` link dropdown (links are automatic); the list shows shells pre-named + linked
   to their staff. Keep staff-less admin login creation. Shells default to the Staff group.

## Open / flagged

- **Activation location** — DECIDED: all on `/users`; `/staff` shows read-only status
  only (slices 3–4). Reuses existing `users:edit`-gated machinery.

## Key files

`prisma/schema.prisma` (User/Staff) · `src/lib/auth.ts` (gates) · `src/lib/auth-guard.ts`
(`session.staffId`) · `src/app/api/staff/route.ts` (provision + sync hooks) ·
`src/app/staff/staff-page.tsx` + `src/app/staff/page.tsx` (activation UX) ·
`src/app/api/users/route.ts` + `src/app/users/users-page.tsx` (drop link dropdown) ·
`src/lib/user-link.ts` (conflict helpers — may shrink) · `prisma/seed.ts` (shell seeding).
