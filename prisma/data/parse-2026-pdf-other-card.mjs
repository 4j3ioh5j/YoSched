/**
 * parse-2026-pdf-other-card.mjs — Phase 2 generator. Parses the OTHER and CARD
 * summary columns of the Jan-Jul 2026 PDF into per-provider assignments, per the
 * user-confirmed rules:
 *   - OTHER: split on ':'; bare name -> OR; Name(SHIFT) -> SHIFT.
 *   - CARD : single bare name -> CARD; multi-name cell -> bare name -> OR,
 *            Name(SHIFT) -> SHIFT.
 *   - name variants: CWr->CW, PNw->PN, STa->ST.
 * Tail tokens (between the last provider column and '#') are assigned to the
 * nearest of the OTHER / CARD / ICU header columns by center. ICU is ignored
 * here (already reconciled). Aborts on any token that is not Name or Name(SHIFT),
 * or any unknown provider/code — nothing is guessed.
 *
 * Run from YoSched/:  node prisma/data/parse-2026-pdf-other-card.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

const PDF = "/home/david/Projects/_scratch/schedules.pdf";
const FULLMON = { JANUARY:"01", FEBRUARY:"02", MARCH:"03", APRIL:"04", MAY:"05", JUNE:"06", JULY:"07" };
const PROVMAP = { STa:"ST", CWr:"CW", PNw:"PN" };
const CODEMAP = { POC:"PRE", PREOP:"PRE", "POC/C":"ORC", "POC/L":"ORL", "ADM/C":"ORC", "ADM/L":"ORL", CUO:"ILD", ORIENT:"ADM", SL12:"SL", SL16:"SL", ILD4:"ILD", CALL2:"CALL", "ILD/CARD":"ILD" };
const KNOWNCODE = new Set("AA ADM AL CALL CARD CB CITC HOL ICU ILD JD OR ORC ORL PAIN PPL PRE QA RS SL TEL UCLA X".split(" "));
const mapProv = p => PROVMAP[p] || p;
const mapCode = c => CODEMAP[c] || c;

const KNOWNPROV = new Set();
for (const l of readFileSync("_scratch/db_providers.txt","utf8").trim().split("\n")) KNOWNPROV.add(l.split("|")[0]);

const bad = [];
// Parse "Name" or "Name(SHIFT)" -> {prov, code|null}
function parsePart(part){
  let m;
  if ((m = part.match(/^([A-Za-z]+)\(([A-Za-z/0-9-]+)\)$/))) return { prov: mapProv(m[1]), code: mapCode(m[2].toUpperCase()) };
  if (/^[A-Za-z]+$/.test(part)) return { prov: mapProv(part), code: null };  // bare
  return null;  // unparseable
}

const out = []; // {date, initials, code, col}
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
  const cIdx = cols.findIndex(c => c.label === "CARD");
  const iIdx = cols.findIndex(c => c.label === "ICU");
  const hIdx = cols.findIndex(c => c.label === "#");
  const lastProv = cols[oIdx-1];
  const anchors = [ {name:"OTHER", c:(cols[oIdx].start+cols[oIdx].end)/2}, {name:"CARD", c:(cols[cIdx].start+cols[cIdx].end)/2}, {name:"ICU", c:(cols[iIdx].start+cols[iIdx].end)/2} ];
  const lastProvCenter = (lastProv.start + lastProv.end)/2;
  const leftBound = (lastProvCenter + anchors[0].c) / 2;  // midpoint between last provider col and OTHER
  const rightBound = cols[hIdx].start;

  for (let r = hi+1; r < lines.length; r++){
    const line = lines[r];
    const dm = line.match(/^\s*(\d{2})-(\d{2})\s+(MON|TUE|WED|THU|FRI|SAT|SUN)\b/);
    if (!dm) continue;
    const date = `${year}-${dm[1]}-${dm[2]}`;
    // collect tail tokens (after last provider, before '#') grouped by column
    const grp = { OTHER: [], CARD: [], ICU: [] };
    for (const m of line.matchAll(/\S+/g)){
      const center = m.index + m[0].length/2;
      if (center <= leftBound || center >= rightBound) continue;
      if (/^\d+$/.test(m[0])) continue; // stray count
      let best = anchors[0], bd = Infinity;
      for (const a of anchors){ const d = Math.abs(center - a.c); if (d < bd){ bd = d; best = a; } }
      grp[best.name].push(m[0]);
    }
    // Re-join a parenthetical that pdftotext split off (e.g. "HC (ORC)" -> "HC(ORC)"),
    // while keeping genuinely separate names (e.g. "RD  LM") apart.
    const mergeParens = (toks) => {
      const m = [];
      for (const t of toks){ if (t.startsWith("(") && m.length) m[m.length-1] += t; else m.push(t); }
      return m;
    };
    grp.OTHER = mergeParens(grp.OTHER);
    grp.CARD = mergeParens(grp.CARD);
    // OTHER: each token may itself be colon-joined
    for (const tok of grp.OTHER){
      for (const part of tok.split(":")){
        if (!part) continue;
        const r2 = parsePart(part);
        if (!r2){ bad.push(`${date} OTHER "${part}" (in "${tok}")`); continue; }
        out.push({ date, initials: r2.prov, code: r2.code ?? "OR", col: "OTHER" });
      }
    }
    // CARD: single bare token -> CARD; otherwise per-name (bare->OR)
    const cardParts = grp.CARD.flatMap(t => t.split(":")).filter(Boolean);
    const single = cardParts.length === 1 && /^[A-Za-z]+$/.test(cardParts[0]);
    for (const part of cardParts){
      if (part.toUpperCase() === "X") continue;
      const r2 = parsePart(part);
      if (!r2){ bad.push(`${date} CARD "${part}"`); continue; }
      const code = r2.code ?? (single ? "CARD" : "OR");
      out.push({ date, initials: r2.prov, code, col: "CARD" });
    }
  }
}

// validate
const badProv = out.filter(o => !KNOWNPROV.has(o.initials)).map(o => `${o.date} ${o.col} ${o.initials}`);
const badCode = out.filter(o => !KNOWNCODE.has(o.code)).map(o => `${o.date} ${o.col} ${o.initials}=${o.code}`);
if (bad.length) { console.error("ABORT — unparseable tokens:\n  " + bad.join("\n  ")); process.exit(1); }
if (badProv.length) { console.error("ABORT — unknown providers:\n  " + [...new Set(badProv)].join("\n  ")); process.exit(1); }
if (badCode.length) { console.error("ABORT — unknown codes:\n  " + [...new Set(badCode)].join("\n  ")); process.exit(1); }

out.sort((a,b)=> a.date<b.date?-1 : a.date>b.date?1 : a.initials.localeCompare(b.initials));
writeFileSync("prisma/data/other-card-2026-jan-jul.json", JSON.stringify(out));
const byCol = {}, byCode = {}; for (const o of out){ byCol[o.col]=(byCol[o.col]||0)+1; byCode[o.code]=(byCode[o.code]||0)+1; }
console.log("Wrote prisma/data/other-card-2026-jan-jul.json —", out.length, "assignments");
console.log("By column:", byCol, "\nBy code:", byCode);
console.log("\nDistinct people:", [...new Set(out.map(o=>o.initials))].sort().join(" "));
console.log("\nSpot checks:");
const show = (d) => console.log(`  ${d}: ${out.filter(o=>o.date===d).map(o=>`${o.initials}=${o.code}(${o.col})`).join(", ")}`);
["2026-06-02","2026-05-25","2026-06-19","2026-07-27","2026-05-05","2026-06-09"].forEach(show);
