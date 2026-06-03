/**
 * parse-historical-xlsx.mjs — generator for historical-2022-2025.json (handoff #108).
 *
 * Reads the source workbooks (MDSCHEDULE_2022..2025.xlsx) from _scratch/historical/,
 * applies the LOCKED provider + shift-code mappings below, folds the workbook's
 * ICU/CARD role columns into per-provider assignments (deduped by provider+date),
 * and writes the flat {date, initials, code} list consumed by seed-historical-import.ts.
 *
 * The .xlsx sources are NOT committed (they live in _scratch/). To regenerate, drop
 * the workbooks back into _scratch/historical/ and run: node prisma/data/parse-historical-xlsx.mjs
 * then copy _scratch/historical.json to prisma/data/historical-2022-2025.json.
 */
import * as XLSX from "xlsx";
import { readdirSync, readFileSync, writeFileSync } from "fs";
const MONTHS=["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const MNUM=Object.fromEntries(MONTHS.map((m,i)=>[m,String(i+1).padStart(2,"0")]));
const files=readdirSync("_scratch/historical").filter(f=>f.endsWith(".xlsx")).sort();

// ---- LOCKED MAPPINGS (handoff #108) ----
const PROV = { STa:"ST", CWr:"CW", PNw:"PN" }; // rename to existing; others pass through
const CODE = {
  POC:"PRE", PREOP:"PRE", "POC/C":"ORC", "POC/L":"ORL", "ADM/C":"ORC", "ADM/L":"ORL",
  CUO:"ILD", "T-ICU":"ICU", ORIENT:"ADM", SL12:"SL", SL16:"SL", ILD4:"ILD",
  CALL2:"CALL", "ICU/OR":"ICU", "ILD/CARD":"ILD",
};
const mapProv = p => PROV[p] || p;
const mapCode = c => CODE[c] || c;
const KNOWN_CODES = new Set("AA ADM AL CALL CARD CITC HOL ICU ILD JD OR ORC ORL PAIN PPL PRE QA RS SL TEL UCLA X CB".split(" "));
const KNOWN_PROV = new Set("AD AH AR BC CC CD CL CW CWa DH HC KO KZ LM LS MF NH PN RD RM SC SH SR SS ST YA ADh DB GL STs JCS HZ JM SP VS AG CO MS SHi".split(" "));

function parseOther(other){
  if(!other) return [];
  const res=[];
  for(let part of String(other).split(":")){
    part=part.trim(); if(!part||part==="X") continue;
    let m;
    if((m=part.match(/^([A-Za-z]+)\s*\(\s*([A-Za-z]+)\??\s*\)$/))) res.push({p:m[1],s:m[2]});
    else if((m=part.match(/^([A-Za-z]+)\s*-\s*([A-Za-z/]+)$/))) res.push({p:m[1],s:m[2]});
    else if(/^[A-Za-z]+$/.test(part)) res.push({p:part,s:"OR"});
    else res.push({p:"__BAD__",s:part});
  }
  return res;
}

const assignments=[]; // {date, initials, code}
const seen=new Set();  // provider|date dedup
const unmatchedProv={}, unmatchedCode={}, badOther={};
let mainN=0, otherN=0, icuN=0, cardN=0, dupN=0;

function add(initials, code, date, src){
  const mi=mapProv(initials), mc=mapCode(String(code).toUpperCase());
  if(!/^[A-Za-z]+$/.test(mi)){ badOther[initials]=(badOther[initials]||0)+1; return; }
  if(!KNOWN_PROV.has(mi)){ unmatchedProv[`${initials}->${mi}`]=(unmatchedProv[`${initials}->${mi}`]||0)+1; return; }
  if(mc==="X"||mc.toUpperCase()==="X"){ return; }
  if(!KNOWN_CODES.has(mc)){ unmatchedCode[`${code}->${mc}`]=(unmatchedCode[`${code}->${mc}`]||0)+1; return; }
  const key=`${mi}|${date}`;
  if(seen.has(key)){ dupN++; return; }
  seen.add(key);
  assignments.push({date, initials:mi, code:mc});
  if(src==="main")mainN++; else if(src==="other")otherN++; else if(src==="icu")icuN++; else cardN++;
}

for(const f of files){
  const year=f.match(/(\d{4})/)[1];
  const wb=XLSX.read(readFileSync(`_scratch/historical/${f}`),{cellDates:false});
  for(const sheet of wb.SheetNames){
    const mon=MONTHS.find(m=>sheet.startsWith(m)); if(!mon)continue;
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheet],{header:1,raw:false,defval:""});
    const header=rows[1].map(c=>String(c).trim());
    const oi=header.indexOf("OTHER"), ci=header.indexOf("CARD"), ii=header.indexOf("ICU");
    if(oi<2)continue;
    const prov=header.slice(2,oi);
    for(let r=2;r<rows.length;r++){
      const row=rows[r];
      const dc=String(row[0]).trim();
      const dm=dc.match(/^(\d{1,2})[-/](\d{1,2})/); if(!dm)continue;
      const mm=dm[1].padStart(2,"0"), dd=dm[2].padStart(2,"0");
      if(mm!==MNUM[mon]){ /* date month mismatch */ }
      const date=`${year}-${MNUM[mon]}-${dd}`;
      // main grid
      for(let c=2;c<oi;c++){ const v=String(row[c]).trim(); if(v&&v.toUpperCase()!=="X") add(prov[c-2],v,date,"main"); }
      // OTHER
      for(const {p,s} of parseOther(row[oi])) add(p,s,date,"other");
      // CARD / ICU role columns -> assignment in that provider's column
      if(ci>0){ const v=String(row[ci]).trim(); if(v&&v.toUpperCase()!=="X"&&/^[A-Za-z]+$/.test(v)) add(v,"CARD",date,"card"); }
      if(ii>0){ const v=String(row[ii]).trim(); if(v&&v.toUpperCase()!=="X"&&/^[A-Za-z]+$/.test(v)) add(v,"ICU",date,"icu"); }
    }
  }
}

assignments.sort((a,b)=> a.date<b.date?-1:a.date>b.date?1:a.initials.localeCompare(b.initials));
console.log("Assignments:", assignments.length, `(main ${mainN}, other ${otherN}, card ${cardN}, icu ${icuN}); deduped ${dupN}`);
const byYear={}; for(const a of assignments){const y=a.date.slice(0,4);byYear[y]=(byYear[y]||0)+1;}
console.log("By year:", byYear);
console.log("UNMATCHED PROVIDERS:", Object.keys(unmatchedProv).length?unmatchedProv:"none ✓");
console.log("UNMATCHED CODES:", Object.keys(unmatchedCode).length?unmatchedCode:"none ✓");
console.log("BAD OTHER tokens:", Object.keys(badOther).length?badOther:"none ✓");
// distinct codes & providers used
console.log("Distinct codes used:", [...new Set(assignments.map(a=>a.code))].sort().join(" "));
console.log("Distinct providers used:", [...new Set(assignments.map(a=>a.initials))].sort().join(" "));
writeFileSync("_scratch/historical.json", JSON.stringify(assignments));
console.log("Wrote _scratch/historical.json", (JSON.stringify(assignments).length/1024/1024).toFixed(2), "MB");
