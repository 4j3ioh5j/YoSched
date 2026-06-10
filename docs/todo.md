# YoSched — TODO

## Open

- [ ] **Rethink Staff ↔ Users linking** — revisit how Staff records are linked to User accounts; the current model needs reconsideration.

## Done

- [x] **Statistics page truncated staff names** — `/equity` Staff Member column capped names at `max-w-[60px]` ("Corey Do…", "David He…"). Dropped the cap (whitespace-nowrap) + widened column w-44→w-56. Commit `c75ddcb`, deployed 2026-06-09.
- [x] **Staff modals email field** — optional `Provider.email` (nullable) + Email input on the staff add/edit modal, validated via pure `normalizeOptionalEmail` (empty→null, else plausible-address, trimmed+lowercased), enforced in the staff API. Independent of the linked login User's email (see Staff↔Users rework). Migration `20260609170000_add_provider_email`. Commit `b7a487d`, deployed 2026-06-09.
