# Staff ↔ Users linking — design & pickup spec

Status: **design locked, not yet built.** This is `docs/todo.md` item #3. Foundation (Provider→Staff rename, `staffId`) shipped in handoff #130. Read this before coding.

## Goal

Make the Staff↔Users relationship coherent and manageable. Today it's a one-directional, admin-only, easy-to-forget link with duplicated identity fields and a just-shipped `Staff.email` that nothing reads. Fix the link UX and the email/name canonicity — **without merging the two entities.**

## Locked decisions (from the design discussion)

1. **Keep two entities.** `Staff` (scheduling person, ~39 rows) and `User` (login, ~2 rows) stay separate tables, linked **1:1-optional** by `User.staffId`. We did NOT merge into one "Person" table — only 1 of 41 people is both, so a merge serves almost no one and bolts auth columns onto 39 staff rows. This was the user's explicit choice ("go with your recommendation" = option A+).
2. **Staff cuid `id` is the stable UID.** Names/initials/email are mutable attributes; the `id` is the permanent identifier and the link key. No new UID scheme needed — already in place.
3. **Direction A+** = keep separate, fix the linking UX + the email/name canonicity. Not B (Provider-as-source-of-truth refactor), not C (merge).

## Current model (verified, with pointers)

- **Schema:** `User.staffId String? @unique` → `Staff.id`, `onDelete: SetNull` (`prisma/schema.prisma`, User model). Nullable, unique ⇒ a staff member backs **at most one** login; a login may have no staff (admin/assistant).
- **Link is set ONLY from the Users page** (`/users`): admin picks a staff member in the user add/edit form. The Staff page (`/staff`) has **no awareness** of the link.
  - API: `src/app/api/users/route.ts` — `normalizeStaffId` + `staffLinkConflict` (helper in `src/lib/user-link.ts`); returns 409 on conflict; `staffId` only touched when the key is present.
- **Only consumer = self-service requests (#119):**
  - `src/lib/auth-guard.ts` resolves `session.staffId` from the logged-in user (line ~96).
  - `src/app/api/my-requests/route.ts` self-scopes everything to `result.staffId`; returns **403 "ask an administrator"** if the login has `requests:self` but no `staffId` (`notLinked()`, lines 81/89/102/138). `src/app/my-requests/page.tsx` shows a friendly notice in the same case.
- **Identity duplication:**
  - **Email stored twice:** `User.email` (login, unique, required) AND `Staff.email` (optional, shipped in handoff #129/commit `b7a487d`). **`Staff.email` is currently read by NOTHING** — confirmation emails on self-submit go to `User.email` (`my-requests/route.ts:52`, `to: user.email`). This is the most concrete inconsistency.
  - **Name stored twice:** `User.name` vs `Staff.name` (can diverge; the stats page often shows initials as the "name"). `my-requests` greets with `staff?.name ?? user.name`.

## Friction this is meant to fix

1. `Staff.email` is dead weight — an admin sets a staff contact email and it does nothing.
2. Enabling self-service is 3 manual steps (create Staff, create User, remember to link) → forgotten links → silent 403s. No linked/unlinked indicator anywhere on `/staff`.
3. No single source of truth for a person's identity (name/email) across schedule/stats/login/notifications.

## Open decisions — NEED USER INPUT before/while building

These were surfaced but not resolved. Don't guess; confirm with the user:

1. **Notification recipient:** should self-service confirmation email go to `Staff.email` when set, falling back to `User.email`? (Recommended — otherwise `Staff.email` stays dead.) Or keep `User.email` only and repurpose `Staff.email` for something else?
2. **Canonical display name:** when a Staff is linked to a User and the names differ, which wins for (a) schedule/stats display, (b) self-service greeting, (c) notifications? (Recommended: `Staff.name` for scheduling/stats; greeting/notifications follow the same.)
3. **Linking UX:** add link status + a "create/link login" affordance on the **Staff** page so the link is manageable from both sides? Add an unlinked-but-`requests:self` warning surfaced to admins? (Recommended: yes.)
4. **Cardinality:** keep 1:1-optional (confirmed yes in discussion — restate to be safe).
5. **Reduce duplication now or defer?** Dropping `User.name` for linked users (derive from Staff) is a bigger refactor; recommend **defer** — first make linking painless + email canonical.

## Proposed slice plan (small, reviewable, CR each)

1. **Staff-page link visibility** — show linked/unlinked status per staff row + a warning for staff who'd need self-service but have no login. (Read-only; no schema change.)
2. **Link/create-login from the Staff page** — affordance to link an existing User or create one prefilled from Staff name/email. Reuse `user-link.ts` conflict checks. (Decision #3.)
3. **`Staff.email` → notifications** — route confirmation email to `Staff.email` ?? `User.email`; thread through `my-requests/route.ts`. Add the rule as a tested pure helper. (Decision #1.)
4. **Canonical name rule** — centralize the display-name choice; apply to stats/grid/greeting. (Decision #2.)

Out of scope (explicitly): merging Staff+User; dropping `User.name`; changing the 1:1-optional cardinality.

## Key files

`prisma/schema.prisma` (User/Staff) · `src/lib/user-link.ts` · `src/app/api/users/route.ts` · `src/app/users/users-page.tsx` (link dropdown) · `src/app/staff/staff-page.tsx` (where link UX would go) · `src/lib/auth-guard.ts` (`session.staffId`) · `src/app/api/my-requests/route.ts` (consumer + email recipient) · `src/lib/email.ts` (`normalizeOptionalEmail`, SMTP).
