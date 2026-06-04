# Historical Schedule Import — Rules, Parsing & Algorithms

Reference for importing printed/exported MD schedules into the `assignments`
table. Captures the source formats, name/code mappings, the parsing algorithms
(and the bugs they fix), and the verification approach. Written after the
Jan–Jul 2026 column-shift recovery (June 2026).

> **Data model reminder:** an assignment is `(providerId, date, shiftTypeId)`
> with `@@unique([providerId, date])` — **one shift per provider per day**. A
> grid "ICU column" is *derived* from `provider → ICU` assignments; you fix data
> by assigning the shift to the right provider, never by writing a derived column.

---

## 1. Sources

| Period | Format | Location (not all committed) | Importer |
|--------|--------|------------------------------|----------|
| 2022–2025 | 4 Excel workbooks `MDSCHEDULE_YYYY.xlsx` | `_scratch/historical/` (gitignored) | `prisma/data/parse-historical-xlsx.mjs` → `historical-2022-2025.json` → `seed-historical-import.ts` |
| 2026 Jan–Jul | 7-page PDF `schedules.pdf` | `~/Projects/_scratch/schedules.pdf` (gitignored) | `parse-2026-pdf-grid.mjs` + `parse-2026-pdf-other-card.mjs` → JSON → `seed-reimport-2026-*.ts` |
| May 2026 (orig.) | hand-transcribed from PDF | inline | `prisma/seed-may.ts` (explicit provider list — the only originally-correct 2026 month) |
| Aug 2026 → | **live** (auto-scheduler) | DB | **do not re-import / never touch** |

Generated JSON artifacts are committed under `prisma/data/`; the seeds read them
on the VM (the DB is localhost-only there, and the source files are not in git).

**Rule of thumb:** everything before August is *historical* and must match the
printed schedule exactly (revert inadvertent edits to print). August onward is
the working schedule — leave it alone.

---

## 2. Grid layout (both xlsx and PDF)

```
DATE  DAY  <provider columns…>  OTHER  CARD  ICU  #
```

- **Provider columns**: one per active provider that period (header = initials).
- **OTHER / CARD / ICU**: *summary* columns naming people who do that duty but
  who often have **no provider column** (e.g. PN, CW, HC, NH, LS, AD, JM, MF, DB,
  GL, ADh). The original importers ignored these → those people's shifts were
  dropped entirely. **Always parse the summary columns.**
- **`#`**: a trailing integer (staffing count). Useful as a right anchor.

---

## 3. Name substitutions (header/cell initials → DB `provider.initials`)

```
STa → ST     CWr → CW     PNw → PN     Shi → SHi
```
`CWa`, `STs`, `ADh` are **distinct real providers** — do not fold them.
Validate every parsed name against the live provider list and **abort on any
unknown** rather than guessing.

---

## 4. Shift-code substitutions (printed label → `shift_types.code`)

```
POC, PREOP          → PRE        (PREOP/POC = pre-op clinic)
POC/C, ADM/C        → ORC
POC/L, ADM/L        → ORL
CUO, ILD4, ILD/CARD → ILD
ORIENT              → ADM
SL12, SL16          → SL
CALL2               → CALL
T-ICU, ICU/OR       → ICU
```
After mapping, every main-grid code must be in the known set
(`AA ADM AL CALL CARD CB CITC HOL ICU ILD JD OR ORC ORL PAIN PPL PRE QA RS SL TEL UCLA X`).
**Abort on any unmapped code.**

---

## 5. Parsing algorithm

Use `pdftotext -layout` (PDF) or `sheet_to_json(header:1)` (xlsx). Per page,
find the header line (contains `DATE` and `ICU`); record each column label's
character offset.

### 5a. Provider (main) grid — MONOTONIC nearest-column

The original PDF import broke because a wide value (`PREOP`) or a collapsed
blank shifted whitespace-split tokens left by one, corrupting runs of cells.
Robust approach:

1. Take row tokens left-of-`OTHER`, skipping the DATE/DAY tokens and any token
   containing `:` or `(` (those are OTHER-column bleed).
2. Tokens are in column order. Assign each to the nearest provider column **by
   center distance, but strictly to the right of the previous token's column**
   (monotonic). This prevents a wide value from double-booking a column and
   naturally handles blanks (a missing value just leaves its column empty — no
   left-shift).

This yielded **zero collisions** and matched the print on every spot check.
(`nearest-start` and `fixed-char-slice` both failed on wide values — don't use.)

### 5b. Summary columns (OTHER / CARD / ICU) — nearest-of-three + paren merge

1. Take tokens between the last provider column and `#`.
2. Assign each to the nearest of the **OTHER / CARD / ICU** header centers.
3. **Merge a parenthetical** pdftotext split off: a token starting with `(` is
   appended to the previous token (`HC` `(ORC)` → `HC(ORC)`). Genuinely separate
   names (`RD   LM`) stay apart.
4. Watch the left boundary: put it at the **midpoint between the last provider
   column and OTHER**, or the last provider's value (often `X`) bleeds in.

> Caution: a wide CARD value next to a wide gap can push the *ICU* name far
> right. `… HC(AL)  RD  LM  6` is **CARD=RD, ICU=LM** (two columns), not a single
> "RD LM" cell. Confirm against the raw row before treating multi-name as one cell.

---

## 6. Summary-column semantics (per cell, split on `:` then `/`)

Each part is `Name` or `Name(SHIFT)`.

| Column | bare `Name` | `Name(SHIFT)` |
|--------|-------------|----------------|
| **OTHER** | that person → **OR** | that person → SHIFT |
| **CARD**  | **single** bare → **CARD**; in a **multi-name** cell → **OR** | that person → SHIFT |
| **ICU**   | that person → **ICU**; `(AM)`/`(PM)` time-qualifier → still **ICU** | `(real shift)` → that shift, **NOT ICU** |

Examples: `PN:CWr` → PN=OR, CW=OR · `PN(ILD):CWr` → PN=ILD, CW=OR ·
`HC (ORC)` → HC=ORC · `JM:AD(ADM)` → JM=OR, AD=ADM · `HZ/SS` → both ICU ·
`Shi(AM):DB(PM)` → both ICU · `LM:ADh(ADM)` → LM=ICU, **ADh=ADM**.

**Precedence:** if a person appears in both their provider column and a specialty
summary column (CARD/ICU) the same day, the **specialty** shift wins. ICU is the
top specialty — never overwrite an already-correct ICU.

---

## 7. Applying (seed) rules

- Run seeds **on the VM** (`pnpm tsx prisma/seed-*.ts`); DB is localhost-only.
- Support `DRY_RUN=1`; always dry-run and eyeball before writing.
- **Idempotent**: skip cells already equal to target.
- **Never delete**; create missing; set `source="imported"`; date as
  `new Date("YYYY-MM-DD" + "T00:00:00Z")`.
- **Scope-guard** to the intended date range (throw if a row is out of range) so
  the live (Aug+) schedule is never touched.
- Replace only what you intend: when filling, overwrite an off-shift (`X`,
  `isOffShift`) — **not** a real shift — unless you explicitly mean to.
- Take a pre-run backup dump of the affected range for rollback.

---

## 8. Known pitfalls (learned the hard way)

1. **Column shift** — whitespace parsing + a wide/blank cell slides a run of
   shifts one column left. Fix with the monotonic parser (§5a).
2. **Dropped summary people** — importers that only read the main grid lose
   everyone who appears solely in OTHER/CARD/ICU (DB, GL, ADh, PN, HC, …).
3. **"preserve ICU" is not always safe** — if the shift mislocated an ICU onto
   the wrong provider, a blanket preserve-ICU keeps the wrong one. After any
   re-import, **audit days with ≥2 ICU** (or any specialty) against the printed
   truth = *(main-grid cells of that code) ∪ (summary-column names)*.
4. **Off vs missing** — January 2026's original import stored no `X` cells at
   all; matching the print may mean *creating* hundreds of off-cells.
5. **Holidays** — holiday rows mix `HOL`/`X`/`CARD`; parse them like any row.
6. **ICU-column parens** — `Name(SHIFT)` in the ICU column means that shift, not
   ICU (e.g. `ADh(ADM)`); a naive paren-strip wrongly marks them ICU.

---

## 9. Verification

- Re-parse the source and diff every `(date, provider)` against the DB; expect
  **0 mismatches** for the historical range.
- Audit `≥2`-of-a-specialty days vs the printed truth (§8.3).
- Edits made in the app are stamped `source="manual"`; imported rows are
  `source="imported"`, auto-scheduler rows `source="auto"`. Deletions leave no
  trace (no per-cell history), so "what changed" = the current `manual` set.

---

## 10. Scripts & artifacts

| File | Role |
|------|------|
| `prisma/data/parse-historical-xlsx.mjs` | xlsx 2022–2025 → `historical-2022-2025.json` |
| `prisma/data/parse-2026-pdf-grid.mjs` | PDF main grid (monotonic) → `grid-2026-jan-jul.json` |
| `prisma/data/parse-2026-pdf-other-card.mjs` | PDF OTHER/CARD → `other-card-2026-jan-jul.json` |
| `prisma/seed-reimport-2026-grid.ts` | apply main-grid correction (preserve ICU) |
| `prisma/seed-reimport-2026-other-card.ts` | apply OTHER/CARD + the one ICU paren fix |
| `prisma/seed-icu-backfill.ts` / `seed-icu-shift-repair.ts` | ICU restoration |
| `prisma/seed-fix-mislocated-icu.ts` | correct false 2nd-ICU from §8.3 |

Diagnostic/throwaway scripts lived in `_scratch/` (gitignored) — recreate from
the rules above if needed.
