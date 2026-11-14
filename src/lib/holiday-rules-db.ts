// Card #210: the one reader of the Settings holiday rules (engine input builder + grid page).
import type { HolidayRuleSpec } from "./holiday-rules";

type RuleClient = {
  holidayRule: {
    findMany: (args: {
      orderBy: { sortOrder: "asc" }[] | { sortOrder: "asc" };
      include: { days: { orderBy: { offset: "asc" } } };
    }) => Promise<{ id: string; name: string; holidayTypeId: string; sortOrder: number; days: { offset: number; shiftTypeId: string }[] }[]>;
  };
};

export async function loadHolidayRules(db: RuleClient): Promise<HolidayRuleSpec[]> {
  const rows = await db.holidayRule.findMany({ orderBy: { sortOrder: "asc" }, include: { days: { orderBy: { offset: "asc" } } } });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    holidayTypeId: r.holidayTypeId,
    sortOrder: r.sortOrder,
    days: r.days.map((d) => ({ offset: d.offset, shiftTypeId: d.shiftTypeId })),
  }));
}

/** Card #210: a fingerprint of the saved rules — a save must name the version it was edited from. */
export function holidayRulesVersion(rules: readonly HolidayRuleSpec[]): string {
  const canon = [...rules]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((r) => [r.id, r.name, r.holidayTypeId, r.sortOrder ?? 0, [...r.days].sort((x, y) => x.offset - y.offset).map((d) => [d.offset, d.shiftTypeId])]);
  // FNV-1a over the canonical JSON: small, stable, no crypto import needed in shared code.
  let h = 0x811c9dc5;
  const s = JSON.stringify(canon);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${rules.length}-${h.toString(16)}`;
}

/** Serialises every write of the holiday rules and holiday types (advisory lock, transaction-scoped). */
export const HOLIDAY_RULES_LOCK_KEY = 0x59534852; // "YSHR"

type RawClient = { $executeRawUnsafe: (sql: string) => Promise<number> };
/**
 * Card #210: link every untyped holiday to the type named like it (" (observed)" dropped),
 * creating the type if needed — the migration's backfill, for writers that insert holiday rows
 * directly (the fresh-database seeds). Rows that already have a type are left alone.
 */
export async function linkUntypedHolidays(db: RawClient): Promise<void> {
  await db.$executeRawUnsafe(`
    INSERT INTO "holiday_types" ("id", "name", "updatedAt")
    SELECT 'ht_' || md5(n.base), n.base, CURRENT_TIMESTAMP
    FROM (SELECT DISTINCT btrim(regexp_replace("name", '\\s*\\(observed\\)\\s*$', '', 'i')) AS base FROM "holidays" WHERE "holidayTypeId" IS NULL) n
    WHERE n.base <> ''
    ON CONFLICT ("name") DO NOTHING`);
  await db.$executeRawUnsafe(`
    UPDATE "holidays" h SET "holidayTypeId" = t."id"
    FROM "holiday_types" t
    WHERE h."holidayTypeId" IS NULL AND t."name" = btrim(regexp_replace(h."name", '\\s*\\(observed\\)\\s*$', '', 'i'))`);
}
