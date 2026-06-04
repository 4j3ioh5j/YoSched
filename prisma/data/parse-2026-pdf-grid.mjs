/**
 * parse-2026-pdf-grid.mjs — generator for grid-2026-jan-jul.json (Phase 1 of the
 * 2026 column-shift re-import). Reads the source PDF and emits the corrected
 * MAIN-GRID provider shifts for Jan-Jul 2026, parsed by NEAREST header-column
 * position (robust to the blank-collapse that shifted the original import).
 *
 * ICU cells are EXCLUDED on purpose — ICU coverage is governed by the dedicated
 * ICU summary column and was already reconciled (seed-icu-backfill / -shift-
 * repair); this re-import must never touch it. OTHER/CARD columns are also out of
 * scope here (Phase 2 — they need clarification).
 *
 * The .pdf source is NOT committed (lives outside the repo). To regenerate:
 *   node prisma/data/parse-2026-pdf-grid.mjs
 *
 * Run from YoSched/. Validates provider headers + codes against the live DB dump
 * (_scratch/db_providers.txt) and aborts on anything unmapped.
 */
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

const PDF = "/home/david/Projects/_scratch/schedules.pdf";
const FULLMON = { JANUARY:"01", FEBRUARY:"02", MARCH:"03", APRIL:"04", MAY:"05", JUNE:"06", JULY:"07" };
const PROVMAP = { STa:"ST" };
const CODEMAP = { POC:"PRE", PREOP:"PRE", "POC/C":"ORC", "POC/L":"ORL", "ADM/C":"ORC", "ADM/L":"ORL", CUO:"ILD", "T-ICU":"ICU", ORIENT:"ADM", "ICU/OR":"ICU", SL12:"SL", SL16:"SL", ILD4:"ILD", CALL2:"CALL", "ILD/CARD":"ILD" };
const KNOWNCODE = new Set("AA ADM AL CALL CARD CB CITC HOL ICU ILD JD OR ORC ORL PAIN PPL PRE QA RS SL TEL UCLA X".split(" "));
const mapProv = p => PROVMAP[p] || p;
const mapCode = c => CODEMAP[c] || c;

const KNOWNPROV = new Set();
for (const l of readFileSync("_scratch/db_providers.txt","utf8").trim().split("\n")) KNOWNPROV.add(l.split("|")[0]);

const out = [];           // {date, initials, code}
const badProv = new Set(), badCode = new Set();
const txt = execSync(`pdftotext -layout ${PDF} -`).toString();

for (const page of txt.split("\f")){
  const tm = page.match(/\b([A-Z]+)\s+(\d{4})\s+MD SCHEDULE/i);
  if (!tm) continue;
  const mm = FULLMON[tm[1].toUpperCase()]; const year = tm[2];
  if (!mm) continue;
  const lines = page.split("\n");
  const hi = lines.findIndex(l => /\bDATE\b/.test(l) && /\bICU\b/.test(l));
  if (hi < 0) continue;
  const cols = [...lines[hi].matchAll(/\S+/g)].map(m => ({ label: m[0], start: m.index, end: m.index + m[0].length }));
  const oIdx = cols.findIndex(c => c.label === "OTHER");
  const dayStart = cols[1].start, otherStart = cols[oIdx].start;
  const providerCols = cols.slice(2, oIdx).map(c => ({ label: c.label, center: (c.start + c.end) / 2 }));
  for (const pc of providerCols){ const p = mapProv(pc.label); if (!KNOWNPROV.has(p)) badProv.add(`${pc.label}->${p}`); }
  for (let r = hi+1; r < lines.length; r++){
    const line = lines[r];
    const dm = line.match(/^\s*(\d{2})-(\d{2})\s+(MON|TUE|WED|THU|FRI|SAT|SUN)\b/);
    if (!dm) continue;
    const date = `${year}-${dm[1]}-${dm[2]}`;
    // Tokens are left-to-right in column order; assign each to its nearest column
    // by CENTER, but strictly to the right of the previous token's column
    // (MONOTONIC) so a wide value (PREOP/CARD) can't double-book a column.
    const toks = [...line.matchAll(/\S+/g)].filter(m => m.index > dayStart + 2 && m.index < otherStart - 1 && !/[:(]/.test(m[0]));
    let prev = -1;
    for (const m of toks){
      const center = m.index + m[0].length / 2;
      let best = -1, bestd = Infinity;
      for (let c = prev + 1; c < providerCols.length; c++){ const d = Math.abs(center - providerCols[c].center); if (d < bestd){ bestd = d; best = c; } }
      if (best < 0) best = providerCols.length - 1;
      prev = best;
      const initials = mapProv(providerCols[best].label);
      const code = mapCode(m[0].toUpperCase());
      if (code === "ICU") continue;               // ICU handled separately
      if (!KNOWNCODE.has(code)) { badCode.add(`${m[0]}->${code}`); continue; }
      out.push({ date, initials, code });
    }
  }
}

if (badProv.size) { console.error("ABORT — unknown providers:", [...badProv]); process.exit(1); }
if (badCode.size) { console.error("ABORT — unmapped codes:", [...badCode]); process.exit(1); }

out.sort((a,b)=> a.date<b.date?-1 : a.date>b.date?1 : a.initials.localeCompare(b.initials));
writeFileSync("prisma/data/grid-2026-jan-jul.json", JSON.stringify(out));
const byMonth = {}; for (const a of out){ const m=a.date.slice(0,7); byMonth[m]=(byMonth[m]||0)+1; }
console.log("Wrote prisma/data/grid-2026-jan-jul.json —", out.length, "main-grid cells (ICU excluded)");
console.log("By month:", byMonth);
console.log("Validation 2026-06-04:", out.filter(a=>a.date==="2026-06-04" && ["BC","CD","RD","DH","SH"].includes(a.initials)).map(a=>`${a.initials}=${a.code}`).join(" "));
