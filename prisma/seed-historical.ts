import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Provider columns for Jan-Feb (includes CWa who left after Feb)
const PROVIDERS_JAN_FEB = ["YA","CC","SC","BC","CD","RD","DH","SH","AH","CL","RM","LM","KO","AR","SR","SS","STa","CWa","KZ"];

// Provider columns for Mar-Jul (CWa gone)
const PROVIDERS_MAR_JUL = ["YA","CC","SC","BC","CD","RD","DH","SH","AH","CL","RM","LM","KO","AR","SR","SS","STa","KZ"];

// OTHER column entries: "PN:CWr" means PN=OR,CWr=OR; "HC(AL)" means HC=AL; empty string means none
// Format: "NAME" = default OR, "NAME(SHIFT)" = specific shift

function parseOther(other: string): Array<{ provider: string; shift: string }> {
  if (!other || other === "X" || other === "") return [];
  const results: Array<{ provider: string; shift: string }> = [];
  const parts = other.split(":");
  for (const part of parts) {
    const match = part.match(/^([A-Za-z]+)\(([A-Z]+)\)$/);
    if (match) {
      results.push({ provider: match[1], shift: match[2] });
    } else if (part.match(/^[A-Za-z]+$/)) {
      results.push({ provider: part, shift: "OR" });
    }
  }
  return results;
}

// ── JANUARY 2026 ──
const JAN: [string, ...string[]][] = [
  ["2026-01-01","HOL","HOL","HOL","X","HOL","HOL","HOL","HOL","HOL","X","X","HOL","HOL","X","HOL","ICU","CALL","HOL","X","HC(HOL)"],
  ["2026-01-02","OR","OR","X","AL","ORC","AL","OR","AL","AL","X","X","ORL","X","X","OR","ICU","X","AL","X",""],
  ["2026-01-03","X","X","X","X","X","X","X","CALL","X","X","X","X","X","X","X","ICU","X","X","X",""],
  ["2026-01-04","X","X","X","X","X","X","X","CALL","X","X","X","X","X","X","X","ICU","X","X","X",""],
  ["2026-01-05","X","OR","AL","ORC","OR","AL","ADM","X","AL","X","PAIN","OR","PPL","X","ORL","ICU","AL","AL","AL",""],
  ["2026-01-06","ORL","X","X","X","X","AL","OR","X","AL","X","X","X","PREOP","ORC","OR","ICU","OR","AL","X","PN:CWr"],
  ["2026-01-07","ADM","X","AL","AL","ORL","OR","OR","AL","AL","X","X","ORC","PPL","X","UCLA","ICU","OR","AL","AL",""],
  ["2026-01-08","OR","X","X","AL","X","CARD","ORC","AL","AL","ORL","X","X","PREOP","X","UCLA","ICU","QA","AL","X","HC"],
  ["2026-01-09","ADM","ORC","X","OR","OR","ADM","X","AL","UCLA","ORL","X","OR","PPL","X","ICU","X","AL","AL","X",""],
  ["2026-01-10","X","X","X","X","CALL","X","X","X","X","X","X","X","X","X","X","ICU","X","X","X",""],
  ["2026-01-11","X","X","X","X","CALL","X","X","X","X","X","X","X","X","X","X","ICU","X","X","X",""],
  ["2026-01-12","ORC","TEL","AL","OR","ADM","CARD","OR","X","ADM","AL","X","OR","PREOP","PAIN","ICU","ADM","ORL","AL","OR",""],
  ["2026-01-13","X","X","X","TEL","ORL","OR","OR","ICU","UCLA","AL","ORC","X","PPL","X","OR","X","OR","AL","X","NH:CWr"],
  ["2026-01-14","ILD","X","AL","X","ORC","OR","OR","ICU","ADM","X","X","ORL","PREOP","X","UCLA","X","OR","AL","OR","PN"],
  ["2026-01-15","ORC","ORL","X","OR","X","OR","OR","ICU","ADM","X","X","OR","PPL","X","UCLA","OR","X","AL","X","HC(AL)"],
  ["2026-01-16","X","OR","X","ORL","X","CARD","OR","ICU","OR","X","X","OR","X","X","ADM","ADM","ORC","AL","X",""],
  ["2026-01-17","X","X","X","X","X","X","CALL","X","X","X","X","X","X","X","X","X","X","X","X",""],
  ["2026-01-18","X","X","X","X","X","X","CALL","X","X","X","X","X","X","X","X","X","X","X","X",""],
  ["2026-01-19","HOL","HOL","HOL","HOL","HOL","HOL","CALL","HOL","HOL","HOL","HOL","HOL","X","HOL","HOL","HOL","HOL","HOL","HOL",""],
  ["2026-01-20","ORL","X","X","TEL","X","OR","ADM","X","JD","ORC","X","SL","PREOP","OR","AL","ADM","X","X","X","PN:CWr"],
  ["2026-01-21","ADM","X","AL","OR","ORL","OR","OR","ORC","JD","X","X","SL","PPL","PAIN","X","X","QA","AL","OR",""],
  ["2026-01-22","OR","ORC","X","OR","OR","OR","AL","X","JD","X","X","OR","PREOP","X","AL","OR","ORL","AL","X","HC(AL)"],
  ["2026-01-23","ADM","X","X","ORL","ORC","OR","AL","X","JD","X","X","OR","PPL","X","AL","X","OR","AL","X",""],
  ["2026-01-24","X","X","X","X","X","X","X","X","X","X","X","X","X","X","X","CALL","X","X","X",""],
  ["2026-01-25","X","X","X","X","X","X","X","X","X","X","X","X","X","X","X","CALL","X","X","X",""],
  ["2026-01-26","ORC","X","AL","OR","OR","OR","OR","ORL","ADM","AL","X","X","PREOP","PAIN","AL","ADM","ADM","AL","X",""],
  ["2026-01-27","X","X","X","TEL","ORL","OR","OR","X","UCLA","OR","OR","ICU","PPL","X","AL","X","SL","AL","ORC","NH:CWr"],
  ["2026-01-28","OR","X","AL","ORC","OR","OR","ORL","TEL","ADM","X","PAIN","ICU","PREOP","X","X","X","AL","X","X","PN"],
  ["2026-01-29","OR","ORL","X","X","OR","CARD","ORC","ILD","OR","X","X","ICU","PPL","X","AL","X","OR","AL","X","HC(AL)"],
  ["2026-01-30","ORL","OR","X","ORL","OR","OR","OR","X","ILD","ADM","X","X","ICU","X","X","AL","X","ORC","AL","X",""],
  ["2026-01-31","X","X","X","CALL","X","X","X","X","X","X","X","ICU","X","X","X","X","X","X","X",""],
];

// ── FEBRUARY 2026 ──
const FEB: [string, ...string[]][] = [
  ["2026-02-01","X","X","X","CALL","X","X","X","X","X","X","X","ICU","X","X","X","X","X","X","X",""],
  ["2026-02-02","OR","SL","AL","ADM","ORL","OR","OR","ORC","ADM","X","PAIN","ICU","PREOP","X","AL","ADM","OR","X","X",""],
  ["2026-02-03","ORL","X","X","TEL","X","OR","X","X","UCLA","X","X","ADM","PPL","OR","AL","ICU","OR","ORC","X","PN:CWr"],
  ["2026-02-04","OR","X","AL","OR","OR","OR","ORL","X","ADM","ORC","X","TEL","PREOP","PAIN","X","ICU","QA","X","X",""],
  ["2026-02-05","X","ORL","X","OR","X","CARD","ORC","ILD","ADM","OR","X","X","PPL","X","AL","ICU","OR","X","X","HC"],
  ["2026-02-06","ADM","ORL","X","OR","ORC","SL","X","X","OR","X","X","OR","PPL","X","AL","ICU","SL","X","X",""],
  ["2026-02-07","X","X","X","X","CALL","X","X","X","X","X","X","OR","X","X","X","ICU","X","X","X",""],
  ["2026-02-08","X","CALL","X","X","X","X","X","X","X","X","X","X","X","X","X","ICU","X","X","X",""],
  ["2026-02-09","ADM","X","OR","X","OR","SL","OR","X","ADM","ORL","X","OR","PPL","PAIN","AL","ICU","ORC","X","X",""],
  ["2026-02-10","X","X","X","TEL","ADM","SL","OR","ICU","UCLA","ORL","ORC","ILD","PREOP","X","AL","X","X","X","X","NH:CWr"],
  ["2026-02-11","X","X","CITC","OR","SL","OR","ORC","ICU","ADM","X","X","ILD","PREOP","X","X","SL","ORL","X","X","PN"],
  ["2026-02-12","OR","ORL","X","OR","SL","CARD","X","ICU","OR","X","X","ILD","PPL","X","X","ORC","X","X","X","HC(AL)"],
  ["2026-02-13","ORL","ADM","X","ORC","SL","AL","OR","ICU","ADM","X","X","ILD","X","X","UCLA","X","X","X","X",""],
  ["2026-02-14","X","CALL","X","X","X","X","X","ICU","X","X","X","X","X","X","X","X","X","X","X",""],
  ["2026-02-15","X","CALL","X","X","X","X","X","ICU","X","X","X","X","X","X","X","X","X","X","X",""],
  ["2026-02-16","HOL","CALL","HOL","HOL","HOL","HOL","HOL","ICU","HOL","HOL","HOL","HOL","X","HOL","HOL","HOL","HOL","X","X",""],
  ["2026-02-17","ORL","X","X","ADM","ILD","ILD","OR","ADM","UCLA","OR","X","AL","SL","ORC","ICU","ADM","OR","X","X","PN:CWr"],
  ["2026-02-18","ADM","X","CITC","OR","ILD","ILD","OR","TEL","ADM","X","X","AL","PPL","X","ICU","ORC","ORL","X","X",""],
  ["2026-02-19","OR","TEL","X","OR","ORL","OR","OR","X","ADM","X","X","AL","SL","X","ICU","X","X","X","X","HC(ORC)"],
  ["2026-02-20","ORC","ORL","X","OR","OR","OR","OR","X","ADM","X","X","AL","PPL","X","ADM","QA","X","X","X",""],
  ["2026-02-21","X","X","X","X","CALL","X","X","X","X","X","X","X","X","X","X","X","X","X","X",""],
  ["2026-02-22","X","X","X","X","CALL","X","X","X","X","X","X","X","X","X","X","X","X","X","X",""],
  ["2026-02-23","OR","OR","AL","TEL","X","ADM","OR","X","ADM","ORC","X","X","PREOP","PAIN","OR","OR","ORL","X","X",""],
  ["2026-02-24","ILD","X","X","ORC","X","OR","ORL","X","UCLA","ILD","OR","ICU","PREOP","X","OR","OR","X","X","X","NH:CWr"],
  ["2026-02-25","OR","X","CITC","X","ORL","OR","OR","ORC","ADM","X","PAIN","ICU","PREOP","X","UCLA","X","OR","X","X","PN"],
  ["2026-02-26","ORC","TEL","X","ORL","OR","CARD","OR","X","OR","X","X","ICU","SL","X","OR","OR","X","X","X","HC(AL)"],
  ["2026-02-27","ORL","OR","X","OR","OR","OR","ORC","TEL","ADM","X","X","ICU","SL","X","SL","ORL","X","X","X",""],
  ["2026-02-28","X","X","X","X","CALL","X","X","X","X","X","X","ICU","X","X","X","X","X","X","X",""],
];

// ── MARCH 2026 ──
const MAR: [string, ...string[]][] = [
  ["2026-03-01","X","X","X","X","CALL","X","X","X","X","X","ICU","X","X","X","X","X","X","X",""],
  ["2026-03-02","OR","OR","OR","ORL","ADM","CARD","AL","AL","ADM","SL","PAIN","ICU","PREOP","X","X","SL","ORC","X",""],
  ["2026-03-03","ORL","X","X","OR","AL","OR","AL","AL","UCLA","X","X","ADM","PREOP","OR","ICU","X","X","ORC","PN:CWr:LS"],
  ["2026-03-04","OR","X","CITC","ORC","OR","OR","AL","AL","ADM","X","X","ORL","OR","PAIN","ICU","X","QA","X",""],
  ["2026-03-05","OR","OR","X","X","ORC","OR","AL","AL","ADM","X","X","X","PREOP","X","ICU","X","ORL","X","HC(ILD)"],
  ["2026-03-06","ADM","ORL","X","OR","X","AL","AL","AL","OR","ORC","X","X","X","X","ICU","X","OR","X",""],
  ["2026-03-07","X","X","X","X","X","X","X","X","X","X","X","X","X","X","ICU","X","CALL","X",""],
  ["2026-03-08","X","X","X","X","X","X","X","X","X","X","X","X","X","X","ICU","X","CALL","X",""],
  ["2026-03-09","OR","X","TEL","OR","ORL","AL","OR","X","ADM","ORC","X","OR","PREOP","PAIN","ICU","ADM","ADM","X",""],
  ["2026-03-10","OR","X","X","OR","OR","AL","ORL","X","UCLA","X","OR","OR","PREOP","X","ADM","ICU","OR","ORC","NH:CWr(AL)"],
  ["2026-03-11","ORC","X","CITC","ORL","OR","ADM","OR","X","ADM","X","SL","OR","PREOP","X","UCLA","ICU","OR","X","PN"],
  ["2026-03-12","X","ORL","X","X","ADM","CARD","OR","OR","OR","X","X","OR","OR","X","UCLA","ICU","ORC","X","HC(AL)"],
  ["2026-03-13","OR","AL","X","TEL","ORL","OR","ORC","X","ADM","X","X","OR","ILD","X","UCLA","ICU","X","X",""],
  ["2026-03-14","X","CALL","X","X","X","X","X","ICU","X","X","X","X","X","X","X","X","X","X",""],
  ["2026-03-15","X","CALL","X","X","X","X","X","ICU","X","X","X","X","X","X","X","X","X","X",""],
  ["2026-03-16","OR","ADM","TEL","X","OR","CARD","X","ICU","ADM","ORC","PAIN","OR","PPL","X","OR","ADM","OR","ORL",""],
  ["2026-03-17","OR","X","X","ORL","X","OR","X","ICU","UCLA","ADM","X","OR","PREOP","ORC","OR","X","OR","X","PN:CWr"],
  ["2026-03-18","ADM","X","CITC","OR","SL","OR","OR","ICU","ADM","X","X","ORC","PREOP","X","UCLA","X","OR","ORL",""],
  ["2026-03-19","ILD","X","OR","ORC","OR","ORL","ICU","ADM","X","X","X","PREOP","X","UCLA","X","OR","X","X","HC"],
  ["2026-03-20","OR","ORL","X","ORC","X","OR","OR","ADM","OR","X","X","ILD","X","X","ADM","X","QA","X",""],
  ["2026-03-21","X","X","X","CALL","X","X","X","X","X","X","X","X","X","X","X","X","X","X",""],
  ["2026-03-22","X","X","X","CALL","X","X","X","X","X","X","X","X","X","X","X","X","X","X",""],
  ["2026-03-23","ORC","OR","OR","ADM","OR","CARD","X","ORL","ADM","AL","X","ILD","PREOP","PAIN","ICU","ADM","SL","X",""],
  ["2026-03-24","X","X","X","SL","X","OR","ORL","X","UCLA","AL","ORC","AL","PPL","X","ICU","OR","OR","X","NH:CWr"],
  ["2026-03-25","X","X","CITC","ORC","ORL","OR","OR","X","OR","X","X","TEL","PREOP","X","ICU","X","OR","ILD","PN"],
  ["2026-03-26","OR","OR","X","X","OR","CARD","ORC","ORL","ADM","X","X","X","PREOP","X","ICU","OR","OR","X","HC(AL)"],
  ["2026-03-27","ORL","AL","X","AL","ORC","OR","X","SL","ADM","X","X","OR","PPL","X","ICU","OR","OR","X",""],
  ["2026-03-28","X","X","X","X","X","CARD","X","X","X","X","X","CALL","X","X","X","X","X","X",""],
  ["2026-03-29","CALL","X","X","X","X","CARD","X","X","X","X","X","X","X","X","X","X","X","X",""],
  ["2026-03-30","ADM","ILD","OR","AL","OR","OR","ORC","TEL","AL","ORL","PAIN","OR","PPL","X","AL","ADM","AL","X",""],
  ["2026-03-31","X","X","X","AL","X","OR","X","X","AL","ORL","X","OR","PREOP","OR","X","OR","AL","ORC","PN:CWr"],
];

// ── APRIL 2026 ──
const APR: [string, ...string[]][] = [
  ["2026-04-01","ADM","X","CITC","AL","ORC","OR","ORL","OR","OR","X","X","ICU","TEL","PAIN","X","OR","AL","X",""],
  ["2026-04-02","ORL","ILD","X","AL","X","CARD","OR","ORC","OR","X","X","ICU","PREOP","X","X","OR","AL","X","HC"],
  ["2026-04-03","ORC","ILD","X","AL","ORL","OR","OR","X","UCLA","X","X","ICU","X","X","X","OR","ADM","X",""],
  ["2026-04-04","X","X","X","X","X","CARD","CALL","X","X","X","ICU","X","X","X","X","X","X","X",""],
  ["2026-04-05","X","X","X","X","X","CARD","CALL","X","X","X","ICU","X","X","X","X","X","X","X",""],
  ["2026-04-06","OR","ORL","TEL","OR","OR","CARD","ADM","X","ADM","ORC","X","ICU","PREOP","PAIN","SL","ADM","AL","X",""],
  ["2026-04-07","OR","X","X","ORC","ORL","ADM","SL","ICU","UCLA","OR","AL","ADM","PPL","X","OR","X","AL","X","PN:CWr"],
  ["2026-04-08","ORC","X","CITC","X","OR","OR","ORC","ICU","OR","X","AL","TEL","PREOP","X","UCLA","X","AL","ORL",""],
  ["2026-04-09","ORC","OR","X","OR","OR","CARD","X","ICU","ADM","X","X","ORL","TEL","X","ADM","OR","AL","OR","HC(AL)"],
  ["2026-04-10","X","X","X","ORL","SL","ILD","OR","ICU","ADM","X","X","OR","PPL","X","ORC","OR","AL","X",""],
  ["2026-04-11","X","X","X","X","CALL","X","X","ICU","X","X","X","X","X","X","X","X","X","X",""],
  ["2026-04-12","X","X","X","X","CALL","X","X","X","X","X","X","X","X","X","X","X","X","X",""],
  ["2026-04-13","AL","X","OR","X","ADM","AL","OR","ICU","ADM","ORC","AL","X","PPL","X","OR","ADM","AL","ORL",""],
  ["2026-04-14","AL","X","X","ORL","X","AL","OR","ADM","UCLA","X","X","ICU","PREOP","ORC","OR","OR","SL","X","CWr"],
  ["2026-04-15","AL","X","CITC","ORC","ORL","OR","OR","X","OR","X","X","ICU","PPL","X","UCLA","X","OR","X","PN"],
  ["2026-04-16","AL","ORL","X","X","ADM","OR","OR","X","ADM","X","X","PREOP","X","ORC","ICU","OR","X","X","HC"],
  ["2026-04-17","AL","ORC","X","TEL","OR","OR","OR","X","ADM","X","ORL","X","X","X","ICU","QA","X","X",""],
  ["2026-04-18","X","X","CALL","X","X","X","X","X","X","X","X","X","X","X","X","X","X","X",""],
  ["2026-04-19","X","X","CALL","X","X","X","X","X","X","X","X","X","X","X","X","X","X","X",""],
  ["2026-04-20","AL","TEL","ADM","OR","OR","OR","OR","X","ADM","ORL","X","ORC","PREOP","PAIN","OR","ADM","OR","SL",""],
  ["2026-04-21","AL","X","X","X","OR","OR","ORL","X","UCLA","AL","ORC","X","OR","X","OR","X","OR","X","PN:CWr"],
  ["2026-04-22","AL","X","CITC","ORL","OR","OR","OR","AL","ADM","X","X","X","PREOP","X","UCLA","X","ORC","OR",""],
  ["2026-04-23","AL","ORC","X","OR","OR","CARD","OR","AL","ADM","X","X","ICU","PREOP","X","ORL","X","X","X","HC(AL)"],
  ["2026-04-24","AL","X","X","ORC","SL","CARD","ORL","AL","OR","X","X","ICU","PPL","X","X","OR","X","X",""],
  ["2026-04-25","X","X","X","X","X","CARD","X","X","X","X","X","X","X","X","X","CALL","X","X",""],
  ["2026-04-26","X","X","X","X","X","CARD","X","X","X","X","X","X","X","X","X","CALL","X","X",""],
  ["2026-04-27","ORC","OR","AA","OR","SL","CARD","X","AL","ADM","ORL","PAIN","TEL","PREOP","X","OR","ADM","ADM","X",""],
  ["2026-04-28","X","X","X","X","AL","OR","X","AL","UCLA","OR","X","ICU","PREOP","OR","OR","AL","ORL","ORC","NH:CWr"],
  ["2026-04-29","OR","X","CITC","ORL","ORC","OR","OR","AL","ADM","X","X","ICU","PREOP","PAIN","UCLA","OR","QA","X","PN"],
  ["2026-04-30","OR","OR","X","OR","X","CARD","OR","AL","ADM","X","X","ICU","PREOP","X","UCLA","OR","ORL","X","HC(ORC)"],
];

// ── MAY 2026 (already seeded — skip in main()) ──

// ── JUNE 2026 ──
const JUN: [string, ...string[]][] = [
  ["2026-06-01","OR","X","ADM","AL","OR","OR","ORC","ICU","ADM","SL","X","OR","AL","AL","ORL","ADM","OR","X",""],
  ["2026-06-02","OR","X","X","X","OR","OR","X","ADM","UCLA","AL","ORC","OR","X","OR","ICU","ORL","X","X","PN:CWr"],
  ["2026-06-03","ILD","X","X","AL","ORL","OR","OR","X","ADM","X","X","OR","AL","X","ADM","ICU","OR","ORC",""],
  ["2026-06-04","OR","OR","X","ORC","OR","ORL","OR","X","ADM","X","X","OR","AL","X","X","ICU","OR","X","HC(AL)"],
  ["2026-06-05","ORC","OR","X","X","X","CARD","OR","OR","OR","X","X","SL","AL","X","AL","ICU","ORL","X",""],
  ["2026-06-06","X","X","CALL","X","X","X","X","X","X","X","X","ICU","X","X","X","X","X","X",""],
  ["2026-06-07","X","X","CALL","X","X","X","X","X","X","X","X","ICU","X","X","X","X","X","X",""],
  ["2026-06-08","OR","X","TEL","ADM","OR","OR","X","ORC","ADM","AL","PAIN","X","PREOP","X","AL","ADM","OR","ORL",""],
  ["2026-06-09","OR","X","X","ORL","OR","ADM","OR","X","UCLA","OR","X","ICU","PREOP","ORC","OR","X","X","X","NH:CWr"],
  ["2026-06-10","ADM","X","CITC","OR","OR","OR","OR","ADM","OR","X","ICU","ORC","X","UCLA","OR","RS","ORL","X","PN"],
  ["2026-06-11","OR","OR","X","OR","OR","CARD","ORL","X","AL","X","X","ICU","X","X","OR","AL","X","X","HC(ORC):LS"],
  ["2026-06-12","OR","OR","X","ORC","ADM","CARD","OR","X","OR","X","X","ICU","PPL","X","ORL","X","QA","X",""],
  ["2026-06-13","X","X","CALL","X","X","X","X","X","X","X","X","ICU","X","X","X","X","X","X",""],
  ["2026-06-14","X","X","CALL","X","X","X","X","X","X","X","X","ICU","X","X","X","X","X","X",""],
  ["2026-06-15","ADM","AL","TEL","ORL","OR","OR","OR","X","ADM","ORC","X","ADM","AL","PAIN","OR","ADM","OR","X",""],
  ["2026-06-16","X","X","X","TEL","OR","OR","OR","X","UCLA","X","OR","ORL","PREOP","X","OR","X","X","ORC","PN:CWr"],
  ["2026-06-17","ORL","X","CITC","OR","OR","OR","ORC","OR","OR","X","PAIN","TEL","PREOP","X","UCLA","OR","X","X",""],
  ["2026-06-18","AL","AL","X","OR","ORL","OR","X","TEL","ADM","X","X","OR","AL","X","OR","ORC","X","X","HC(AL)"],
  ["2026-06-19","HOL","HOL","X","CALL","HOL","CARD","HOL","HOL","X","X","HOL","HOL","X","HOL","HOL","HOL","X","X",""],
  ["2026-06-20","X","X","X","CALL","X","CARD","X","X","X","X","X","X","X","X","X","X","X","X",""],
  ["2026-06-21","X","X","X","CALL","X","CARD","X","X","X","X","X","X","X","X","X","X","X","X",""],
  ["2026-06-22","OR","OR","TEL","ADM","OR","OR","OR","X","ADM","ORL","PAIN","OR","AL","X","ORC","ICU","OR","OR",""],
  ["2026-06-23","ORC","X","X","OR","OR","OR","X","UCLA","ORL","X","OR","TEL","OR","X","ICU","QA","X","X","NH:CWr"],
  ["2026-06-24","X","X","CITC","OR","ORC","OR","OR","ORL","OR","X","X","TEL","PREOP","PAIN","UCLA","ICU","RS","OR","PN"],
  ["2026-06-25","OR","ORL","X","TEL","X","CARD","OR","OR","ADM","X","X","ORC","AL","X","UCLA","ICU","OR","X","HC:LS"],
  ["2026-06-26","ADM","ORC","X","ORL","OR","OR","OR","OR","ADM","X","X","X","X","AL","ICU","OR","X","X",""],
  ["2026-06-27","X","X","X","X","X","X","X","X","X","X","X","X","X","X","ICU","CALL","X","X",""],
  ["2026-06-28","X","X","X","X","X","X","X","X","X","X","X","X","X","X","ICU","CALL","X","X",""],
  ["2026-06-29","ORL","X","OR","OR","OR","CARD","OR","ICU","ADM","ORC","X","OR","PPL","PAIN","OR","ADM","ADM","X",""],
  ["2026-06-30","OR","X","X","ADM","ORL","ILD","OR","ICU","UCLA","OR","OR","TEL","PREOP","X","SL","X","X","ORC","PN:CWr"],
];

// ── JULY 2026 ──
const JUL: [string, ...string[]][] = [
  ["2026-07-01","X","X","CITC","ORC","OR","ILD","OR","ICU","ADM","X","PAIN","OR","OR","X","UCLA","X","ORL","X",""],
  ["2026-07-02","ORC","ORL","X","X","OR","ILD","OR","ICU","OR","X","X","OR","PREOP","X","UCLA","X","AL","X","HC(AL)"],
  ["2026-07-03","HOL","HOL","X","HOL","CALL","HOL","HOL","ICU","HOL","X","X","HOL","HOL","X","HOL","HOL","HOL","X",""],
  ["2026-07-04","X","X","X","X","CALL","X","X","ICU","X","X","X","X","X","X","X","X","X","X",""],
  ["2026-07-05","X","X","X","X","CALL","X","X","ICU","X","X","X","X","X","X","X","X","X","X",""],
  ["2026-07-06","X","OR","OR","ORC","ADM","AL","OR","ICU","ADM","AL","AL","OR","PREOP","X","ORL","ADM","AL","X",""],
  ["2026-07-07","ORL","X","X","X","X","AL","OR","ADM","UCLA","AL","X","OR","X","OR","OR","ICU","AL","ORC","PN:CWr"],
  ["2026-07-08","ADM","X","CITC","OR","ORL","AL","ORC","X","OR","X","X","OR","PREOP","PAIN","UCLA","ICU","OR","X",""],
  ["2026-07-09","ORC","OR","X","OR","OR","AL","X","X","ADM","X","X","OR","X","X","OR","ICU","ORL","X","HC"],
  ["2026-07-10","X","ORL","X","OR","OR","AL","OR","X","ADM","X","X","OR","ORC","X","OR","ICU","QA","X",""],
  ["2026-07-11","X","X","X","X","X","X","CALL","X","X","X","X","X","X","X","X","X","X","X",""],
  ["2026-07-12","X","X","X","X","X","X","CALL","X","X","X","X","X","X","X","X","X","X","X",""],
  ["2026-07-13","X","OR","OR","OR","ADM","AL","ADM","OR","ADM","ORC","X","ICU","PREOP","PAIN","OR","X","SL","ORL",""],
  ["2026-07-14","OR","X","X","OR","OR","AL","OR","X","UCLA","OR","ORC","ICU","AL","X","OR","ADM","AL","ORL","PN:CWr(AL)"],
  ["2026-07-15","OR","X","CITC","OR","ORL","AL","OR","ORC","OR","X","X","ICU","AL","X","UCLA","X","AL","X",""],
  ["2026-07-16","ORL","OR","X","OR","ORC","AL","OR","X","ADM","X","X","ICU","PREOP","X","OR","X","AL","X","HC(AL)"],
  ["2026-07-17","OR","OR","X","OR","X","AL","ORL","X","ADM","X","X","ADM","OR","X","ORC","OR","OR","X",""],
  ["2026-07-18","CALL","X","X","X","X","X","X","X","X","X","X","X","X","X","X","X","X","X",""],
  ["2026-07-19","CALL","X","X","X","X","X","X","X","X","X","X","X","X","X","X","X","X","X",""],
  ["2026-07-20","ADM","AL","OR","AL","AL","AL","OR","OR","ADM","ORC","PAIN","AL","PREOP","X","OR","ADM","OR","ORL",""],
  ["2026-07-21","OR","X","X","AL","X","AL","X","X","UCLA","X","X","OR","ORL","X","ICU","OR","ORC","X","PN:CWr"],
  ["2026-07-22","OR","X","CITC","AL","OR","AL","ORL","OR","OR","X","X","ORC","PREOP","PAIN","UCLA","ICU","QA","X",""],
  ["2026-07-23","ORL","AL","X","AL","OR","AL","OR","OR","ADM","X","X","ORC","X","UCLA","ICU","SL","X","X","HC"],
  ["2026-07-24","ADM","AL","X","AL","ORL","AL","OR","ORC","ADM","X","X","OR","X","X","ADM","ICU","OR","X",""],
  ["2026-07-25","X","X","X","X","X","X","X","CALL","X","X","X","X","X","X","X","X","X","X",""],
  ["2026-07-26","X","X","X","X","X","X","X","CALL","X","X","X","X","X","X","ICU","X","X","X",""],
  ["2026-07-27","OR","AL","OR","AL","ORC","CARD","ORL","OR","ADM","OR","X","OR","OR","PAIN","ICU","ADM","OR","AL",""],
  ["2026-07-28","OR","X","X","OR","X","OR","X","X","UCLA","ORL","OR","OR","PREOP","X","ICU","X","ORC","X","NH:CWr"],
  ["2026-07-29","OR","X","CITC","OR","OR","OR","ORC","OR","ADM","X","PAIN","SL","ORL","X","ICU","X","X","AL","PN"],
  ["2026-07-30","OR","OR","X","ORC","AL","OR","X","OR","OR","X","X","OR","PREOP","X","ICU","X","ORL","X","HC(AL)"],
  ["2026-07-31","ORL","ORC","X","X","AL","CARD","OR","OR","ADM","X","X","OR","OR","X","ICU","AL","X","X",""],
];

// Months to seed (skip May — already in DB)
const ALL_MONTHS: Array<{
  data: [string, ...string[]][];
  providers: string[];
  label: string;
}> = [
  { data: JAN, providers: PROVIDERS_JAN_FEB, label: "January" },
  { data: FEB, providers: PROVIDERS_JAN_FEB, label: "February" },
  { data: MAR, providers: PROVIDERS_MAR_JUL, label: "March" },
  { data: APR, providers: PROVIDERS_MAR_JUL, label: "April" },
  // May skipped — already seeded
  { data: JUN, providers: PROVIDERS_MAR_JUL, label: "June" },
  { data: JUL, providers: PROVIDERS_MAR_JUL, label: "July" },
];

async function main() {
  const fteType = await prisma.employmentType.findFirst({ where: { name: "FTE" } });
  const feeBasisType = await prisma.employmentType.findFirst({ where: { name: "Fee Basis" } });
  if (!fteType || !feeBasisType) throw new Error("Employment types not seeded — run main seed first");

  // Ensure CWa provider exists (active Jan-Feb, departed after)
  const existingCWa = await prisma.provider.findFirst({ where: { initials: "CWa" } });
  if (!existingCWa) {
    await prisma.provider.create({
      data: {
        initials: "CWa",
        name: "CWa",
        employmentTypeId: fteType.id,
        ftePercentage: 1.0,
        takesCall: true,
        takesWeekendCall: true,
        takesLate: true,
        workingDays: [1, 2, 3, 4, 5],
        isActive: false,
        isTemporary: true,
        tempEndDate: new Date("2026-02-28T00:00:00Z"),
        sortOrder: 18,
      },
    });
    console.log("Created CWa provider (departed after Feb)");
  }

  // Ensure LS provider exists (appears in OTHER column occasionally)
  const existingLS = await prisma.provider.findFirst({ where: { initials: "LS" } });
  if (!existingLS) {
    await prisma.provider.create({
      data: {
        initials: "LS",
        name: "LS",
        employmentTypeId: feeBasisType.id,
        ftePercentage: 0,
        takesCall: false,
        takesWeekendCall: false,
        takesLate: false,
        workingDays: [1, 2, 3, 4, 5],
        isActive: true,
        sortOrder: 23,
      },
    });
    console.log("Created LS provider (supplemental)");
  }

  // Build lookup maps
  const providerMap = new Map<string, string>();
  const allProviders = await prisma.provider.findMany();
  for (const p of allProviders) {
    providerMap.set(p.initials, p.id);
  }

  const shiftMap = new Map<string, string>();
  const allShifts = await prisma.shiftType.findMany();
  for (const s of allShifts) {
    shiftMap.set(s.code, s.id);
  }

  console.log(`Loaded ${providerMap.size} providers, ${shiftMap.size} shift types`);

  let totalCreated = 0;
  let totalSkipped = 0;

  for (const month of ALL_MONTHS) {
    // Clear existing assignments for this month
    const firstDate = month.data[0][0];
    const lastDate = month.data[month.data.length - 1][0];
    const deleted = await prisma.assignment.deleteMany({
      where: {
        date: {
          gte: new Date(firstDate + "T00:00:00Z"),
          lte: new Date(lastDate + "T00:00:00Z"),
        },
      },
    });
    if (deleted.count > 0) {
      console.log(`Cleared ${deleted.count} existing assignments for ${month.label}`);
    }

    let created = 0;
    let skipped = 0;

    for (const row of month.data) {
      const date = row[0];
      const assignments = row.slice(1) as string[];

      // Main provider columns
      const providerCols = month.providers;
      for (let i = 0; i < providerCols.length; i++) {
        const code = assignments[i];
        if (!code || code === "X") continue;

        const providerId = providerMap.get(providerCols[i]);
        const shiftTypeId = shiftMap.get(code);

        if (!providerId) {
          console.warn(`Provider not found: ${providerCols[i]} on ${date}`);
          skipped++;
          continue;
        }
        if (!shiftTypeId) {
          console.warn(`Shift type not found: ${code} (${providerCols[i]} on ${date})`);
          skipped++;
          continue;
        }

        await prisma.assignment.create({
          data: {
            providerId,
            date: new Date(date + "T00:00:00Z"),
            shiftTypeId,
            source: "imported",
          },
        });
        created++;
      }

      // OTHER column (last element in the row after provider columns)
      const otherIdx = providerCols.length + 1; // +1 for date
      const otherStr = row[otherIdx] || "";
      const otherAssignments = parseOther(otherStr);
      for (const oa of otherAssignments) {
        const providerId = providerMap.get(oa.provider);
        const shiftTypeId = shiftMap.get(oa.shift);

        if (!providerId) {
          console.warn(`OTHER provider not found: ${oa.provider} on ${date}`);
          skipped++;
          continue;
        }
        if (!shiftTypeId) {
          console.warn(`OTHER shift not found: ${oa.shift} (${oa.provider} on ${date})`);
          skipped++;
          continue;
        }

        // Check for duplicate (provider might already have an assignment for this date)
        const existing = await prisma.assignment.findFirst({
          where: { providerId, date: new Date(date + "T00:00:00Z") },
        });
        if (existing) {
          console.warn(`Duplicate: ${oa.provider} already has assignment on ${date}, skipping OTHER entry`);
          skipped++;
          continue;
        }

        await prisma.assignment.create({
          data: {
            providerId,
            date: new Date(date + "T00:00:00Z"),
            shiftTypeId,
            source: "imported",
          },
        });
        created++;
      }
    }

    console.log(`${month.label}: created ${created}, skipped ${skipped}`);
    totalCreated += created;
    totalSkipped += skipped;
  }

  console.log(`\nTotal: created ${totalCreated}, skipped ${totalSkipped}`);
}

main()
  .then(() => {
    console.log("Historical seed complete");
    return prisma.$disconnect();
  })
  .catch((e) => {
    console.error(e);
    return prisma.$disconnect().then(() => process.exit(1));
  });
