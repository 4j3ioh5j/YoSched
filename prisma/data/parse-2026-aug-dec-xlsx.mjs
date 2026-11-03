/**
 * parse-2026-aug-dec-xlsx.mjs — generator for aug-dec-2026.json.
 *
 * Reads the AUG..DEC 2026 sheets of David's MDSCHEDULE_2026.xlsx (not committed) and writes the
 * flat {date, initials, code, col} list consumed by seed-aug-dec-2026.ts. Rules follow
 * docs/historical-schedule-import.md §3–§6, with David's 2026-11-03 decisions:
 *   - blank cells stay blank (no row); X is stored as X (off), as for Jan–Jul 2026;
 *   - LY ("time off award") is a real code (the seed creates the shift type);
 *   - a specialty column (CARD / ICU) wins over the person's own column (only case: 2026-10-08 RD
 *     grid SL vs CARD RD -> CARD, confirmed by David);
 *   - JM in these months is the current JM (the 2022 JM becomes JMo in the seed).
 * Any unknown name or code, unparsable summary cell or unresolved double-booking ABORTS.
 *
 * Usage: node prisma/data/parse-2026-aug-dec-xlsx.mjs <path/to/MDSCHEDULE_2026.xlsx>
 *        (writes prisma/data/aug-dec-2026.json)
 */
import * as XLSX from "xlsx";
import { readFileSync, writeFileSync } from "fs";

const SHEETS = ["AUG 2026", "SEP 2026", "OCT 2026", "NOV 2026", "DEC 2026"];
const PROV = { STa: "ST", CWr: "CW", PNw: "PN", Shi: "SHi" };
const CODE = {
  POC: "PRE", PREOP: "PRE", "POC/C": "ORC", "POC/L": "ORL", "ADM/C": "ORC", "ADM/L": "ORL",
  CUO: "ILD", ILD4: "ILD", "ILD/CARD": "ILD", ORIENT: "ADM", SL12: "SL", SL16: "SL",
  CALL2: "CALL", "T-ICU": "ICU", "ICU/OR": "ICU",
};
const KNOWN_CODES = new Set("AA ADM AL CALL CARD CB CITC HOL ICU ILD JD LY OR ORC ORL PAIN PPL PRE QA RS SL TEL UCLA X".split(" "));
// Live roster (2026-11-03) plus the two new staff the seed creates.
const KNOWN_PROV = new Set("YA CC SC BC CD RD DH SH AH CL RM LM KO AR SR SS ST KZ CW NH PN HC LS AD MF ADh DB GL JM RMc BR".split(" "));
const RANK = { main: 0, OTHER: 1, CARD: 2, ICU: 3 }; // higher wins

const src = process.argv[2];
if (!src) { console.error("usage: node parse-2026-aug-dec-xlsx.mjs <xlsx>"); process.exit(2); }
const wb = XLSX.read(readFileSync(src));
const errors = [];
const cells = new Map(); // `${initials}|${date}` -> {date, initials, code, col}
const overrides = [];

const mapProv = (p) => PROV[p] || p;
const mapCode = (c) => { const u = String(c).trim().toUpperCase(); return CODE[u] || u; };

function put(date, rawInitials, rawCode, col) {
  const initials = mapProv(rawInitials);
  const code = mapCode(rawCode);
  if (!KNOWN_PROV.has(initials)) { errors.push(`${date} ${col}: unknown name ${rawInitials}`); return; }
  if (!KNOWN_CODES.has(code)) { errors.push(`${date} ${col} ${initials}: unknown code ${rawCode}`); return; }
  const key = `${initials}|${date}`;
  const prev = cells.get(key);
  if (!prev) { cells.set(key, { date, initials, code, col }); return; }
  if (prev.code === code) { if (RANK[col] > RANK[prev.col]) prev.col = col; return; }
  if (RANK[col] === RANK[prev.col]) { errors.push(`${date} ${initials}: ${prev.col}=${prev.code} vs ${col}=${code}`); return; }
  const [win, lose] = RANK[col] > RANK[prev.col] ? [{ date, initials, code, col }, prev] : [prev, { date, initials, code, col }];
  cells.set(key, win);
  overrides.push(`${date} ${initials}: ${win.col}=${win.code} wins over ${lose.col}=${lose.code}`);
}

for (const sheet of SHEETS) {
  const ws = wb.Sheets[sheet];
  if (!ws) { errors.push(`missing sheet ${sheet}`); continue; }
  const month = String(SHEETS.indexOf(sheet) + 8).padStart(2, "0");
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
  const h = rows[1].map((c) => String(c).trim());
  if (h[0] !== "DATE" || h[1] !== "DAY") { errors.push(`${sheet}: unexpected header ${h.slice(0, 2)}`); continue; }
  const oi = h.indexOf("OTHER"), ci = h.indexOf("CARD"), ii = h.indexOf("ICU");
  if (!(oi > 2 && ci === oi + 1 && ii === ci + 1)) { errors.push(`${sheet}: OTHER/CARD/ICU not found in order`); continue; }
  const prov = h.slice(2, oi);
  let days = 0;
  for (const raw of rows.slice(2)) {
    const row = raw.map((c) => String(c).trim());
    const m = row[0].match(/^(\d\d)-(\d\d)$/);
    if (!m) continue; // title, footer (date stamp / VER) rows
    if (m[1] !== month) { errors.push(`${sheet}: row date ${row[0]} not in month ${month}`); continue; }
    const date = `2026-${m[1]}-${m[2]}`;
    days++;
    prov.forEach((p, i) => { const v = row[2 + i]; if (v) put(date, p, v, "main"); });
    for (const [col, idx] of [["OTHER", oi], ["CARD", ci], ["ICU", ii]]) {
      const v = row[idx];
      if (!v || v === "X") continue;
      const parts = v.split(/[:/]/).map((s) => s.trim()).filter(Boolean);
      for (const part of parts) {
        const pm = part.match(/^([A-Za-z]+)\s*(?:\(\s*([A-Za-z0-9/]+)\s*\))?$/);
        if (!pm) { errors.push(`${date} ${col}: unparsable "${v}"`); continue; }
        const [, name, paren] = pm;
        let code;
        if (col === "OTHER") code = paren || "OR";
        else if (col === "CARD") code = paren || (parts.length === 1 ? "CARD" : "OR");
        else code = paren && !/^(AM|PM)$/i.test(paren) ? paren : "ICU";
        put(date, name, code, col);
      }
    }
  }
  const expected = new Date(Date.UTC(2026, Number(month), 0)).getUTCDate();
  if (days !== expected) errors.push(`${sheet}: ${days} day rows, expected ${expected}`);
}

if (errors.length) { console.error("ABORT:\n  " + errors.join("\n  ")); process.exit(1); }
const out = [...cells.values()].sort((a, b) => a.date.localeCompare(b.date) || a.initials.localeCompare(b.initials));
writeFileSync(new URL("./aug-dec-2026.json", import.meta.url), JSON.stringify(out, null, 0).replace(/},{/g, "},\n{") + "\n");
const byMonth = {};
for (const r of out) byMonth[r.date.slice(0, 7)] = (byMonth[r.date.slice(0, 7)] || 0) + 1;
console.log(`wrote ${out.length} cells`, byMonth);
console.log("specialty overrides:\n  " + (overrides.join("\n  ") || "(none)"));
