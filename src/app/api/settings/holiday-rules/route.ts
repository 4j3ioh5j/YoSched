import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { validateHolidayRules } from "@/lib/holiday-rules";
import { loadHolidayRules, holidayRulesVersion, HOLIDAY_RULES_LOCK_KEY } from "@/lib/holiday-rules-db";
import { gated } from "@/lib/write-gate";

// Card #210: holiday rules — user-named, editable settings data. GET returns the rules and their
// version; PUT replaces the whole list, but only if nobody saved since (baseVersion), else 409.
// A rule sent with its id keeps that id (renames keep their identity); rules left out are deleted.

const STALE = { error: "Holiday rules were changed in another tab or by someone else — reload the page and try again.", reason: "stale" } as const;

async function handleGET() {
  const { error } = await getSession("settings:view");
  if (error) return error;
  const rules = await loadHolidayRules(prisma);
  return NextResponse.json({ version: holidayRulesVersion(rules), rules });
}

class Stale extends Error {}

async function handlePUT(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;
  let body: { baseVersion?: unknown; rules?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (typeof body?.baseVersion !== "string") return NextResponse.json({ error: "baseVersion is required", reason: "bad-request" }, { status: 400 });
  if (!Array.isArray(body.rules)) return NextResponse.json({ error: "rules must be a list", reason: "bad-request" }, { status: 400 });
  const rawRules = body.rules as { id?: unknown }[];
  for (const r of rawRules) {
    if (r && typeof r === "object" && r.id !== undefined && r.id !== null && typeof r.id !== "string") {
      return NextResponse.json({ error: "rule id must be a string", reason: "bad-request" }, { status: 400 });
    }
  }
  const baseVersion = body.baseVersion;

  try {
    const saved = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${HOLIDAY_RULES_LOCK_KEY}::bigint)`;
      const current = await loadHolidayRules(tx);
      if (holidayRulesVersion(current) !== baseVersion) throw new Stale();
      const [types, shifts] = await Promise.all([
        tx.holidayType.findMany({ select: { id: true } }),
        tx.shiftType.findMany({ select: { id: true } }),
      ]);
      const v = validateHolidayRules(rawRules, new Set(types.map((t) => t.id)), new Set(shifts.map((s) => s.id)));
      if (!v.ok) return { bad: v.error };
      const currentIds = new Set(current.map((r) => r.id));
      const keepIds = new Set<string>();
      // Delete first (frees unique names a renamed rule may take over), then update/create.
      const incomingIds = new Set(rawRules.map((r) => (r && typeof r.id === "string" ? r.id : "")).filter((id) => currentIds.has(id)));
      await tx.holidayRule.deleteMany({ where: { id: { notIn: [...incomingIds] } } });
      // Park kept rules on a temporary name so a swap of two names can't collide.
      for (const id of incomingIds) await tx.holidayRule.update({ where: { id }, data: { name: `~parked~${id}` } });
      for (const [i, r] of v.rules.entries()) {
        const rawId = rawRules[i]?.id;
        const id = typeof rawId === "string" && incomingIds.has(rawId) && !keepIds.has(rawId) ? rawId : null;
        const days = r.days.map((d) => ({ offset: d.offset, shiftTypeId: d.shiftTypeId }));
        if (id) {
          keepIds.add(id);
          await tx.holidayRuleDay.deleteMany({ where: { ruleId: id } });
          await tx.holidayRule.update({ where: { id }, data: { name: r.name, holidayTypeId: r.holidayTypeId, sortOrder: i, days: { create: days } } });
        } else {
          await tx.holidayRule.create({ data: { name: r.name, holidayTypeId: r.holidayTypeId, sortOrder: i, days: { create: days } } });
        }
      }
      const after = await loadHolidayRules(tx);
      return { rules: after, version: holidayRulesVersion(after) };
    });
    if ("bad" in saved) return NextResponse.json({ error: saved.bad, reason: "invalid" }, { status: 400 });
    return NextResponse.json(saved);
  } catch (e) {
    if (e instanceof Stale) return NextResponse.json(STALE, { status: 409 });
    throw e;
  }
}

export const GET = gated(handleGET);
export const PUT = gated(handlePUT);
