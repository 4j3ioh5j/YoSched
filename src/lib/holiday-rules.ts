// Card #210: holiday rules. A rule belongs to a holiday TYPE (e.g. "Thanksgiving Day") and lists
// days counted from each dated holiday of that type, each with its own shift. Every holiday of the
// type, for every rule, makes one GROUP: those (date, shift) slots go to ONE person. Rule names are
// user-defined and display-only; everything links by id. Shared by the engine and the grid warning.

export type HolidayRuleDaySpec = { offset: number; shiftTypeId: string };
export type HolidayRuleSpec = {
  id: string;
  name: string;
  holidayTypeId: string;
  sortOrder?: number;
  days: HolidayRuleDaySpec[];
};
export type DatedHoliday = { date: string; holidayTypeId?: string | null };

export type HolidayGroupSlot = { date: string; shiftTypeId: string; offset: number };
export type HolidayGroup = {
  /** Stable key: rule id + holiday date. */
  key: string;
  ruleId: string;
  ruleName: string;
  holidayDate: string;
  /** Slots in date order. */
  slots: HolidayGroupSlot[];
};

export const RULE_OFFSET_MIN = -7;
export const RULE_OFFSET_MAX = 7;
export const RULE_NAME_MAX = 60;

/** YYYY-MM-DD plus n days (UTC, no DST drift). */
export function shiftDate(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The largest |offset| over all rule days (0 with no rules): how far a group reaches from its holiday. */
export function ruleSpan(rules: readonly HolidayRuleSpec[]): number {
  let span = 0;
  for (const r of rules) for (const d of r.days) span = Math.max(span, Math.abs(d.offset));
  return span;
}

/**
 * Card #218: how far past a range's last day a group that touches the range can reach — the
 * widest distance between a rule's first and last day (a rule from −7 to +7 reaches 14 days:
 * its holiday can sit 7 days after the range, its last day 7 more). 0 with no rules.
 */
export function ruleReach(rules: readonly HolidayRuleSpec[]): number {
  let reach = 0;
  for (const r of rules) {
    if (r.days.length === 0) continue;
    const offs = r.days.map((d) => d.offset);
    reach = Math.max(reach, Math.max(...offs) - Math.min(...offs));
  }
  return reach;
}

/**
 * Every group from the dated holidays and the rules. A holiday with no type, or whose type has no
 * rule, makes none. When `from`/`to` are given, only groups with at least one slot in [from, to]
 * are returned (the whole group, slots outside included — they are read-only context).
 */
export function buildHolidayGroups(
  holidays: readonly DatedHoliday[],
  rules: readonly HolidayRuleSpec[],
  from?: string,
  to?: string,
): HolidayGroup[] {
  if (rules.length === 0) return [];
  const byType = new Map<string, HolidayRuleSpec[]>();
  for (const r of rules) {
    if (r.days.length < 2) continue;
    const list = byType.get(r.holidayTypeId) ?? [];
    list.push(r);
    byType.set(r.holidayTypeId, list);
  }
  for (const list of byType.values()) list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id.localeCompare(b.id));
  const out: HolidayGroup[] = [];
  const seen = new Set<string>();
  const sorted = [...holidays].sort((a, b) => a.date.localeCompare(b.date));
  for (const h of sorted) {
    if (!h.holidayTypeId) continue;
    for (const r of byType.get(h.holidayTypeId) ?? []) {
      const key = `${r.id}@${h.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const slots = r.days
        .map((d) => ({ date: shiftDate(h.date, d.offset), shiftTypeId: d.shiftTypeId, offset: d.offset }))
        .sort((a, b) => a.date.localeCompare(b.date));
      if (from && to && !slots.some((s) => s.date >= from && s.date <= to)) continue;
      out.push({ key, ruleId: r.id, ruleName: r.name, holidayDate: h.date, slots });
    }
  }
  return out;
}

export type RuleValidationInput = {
  name: unknown;
  holidayTypeId: unknown;
  days: unknown;
};

/**
 * Strict validation of a full replacement list of rules. Returns the cleaned rules or the first
 * error (a plain sentence for the Settings page). `typeIds`/`shiftIds` are the ids that exist.
 */
export function validateHolidayRules(
  raw: unknown,
  typeIds: ReadonlySet<string>,
  shiftIds: ReadonlySet<string>,
): { ok: true; rules: { name: string; holidayTypeId: string; days: HolidayRuleDaySpec[] }[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "rules must be a list" };
  if (raw.length > 200) return { ok: false, error: "too many rules" };
  const rules: { name: string; holidayTypeId: string; days: HolidayRuleDaySpec[] }[] = [];
  const namesByType = new Map<string, Set<string>>();
  const slotsByType = new Map<string, Map<string, string>>();
  for (const item of raw as RuleValidationInput[]) {
    if (!item || typeof item !== "object") return { ok: false, error: "each rule must be an object" };
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (name.length < 1 || name.length > RULE_NAME_MAX) return { ok: false, error: `each rule needs a name of 1–${RULE_NAME_MAX} characters` };
    const typeId = item.holidayTypeId;
    if (typeof typeId !== "string" || !typeIds.has(typeId)) return { ok: false, error: `${name}: choose a holiday` };
    const names = namesByType.get(typeId) ?? new Set<string>();
    const lower = name.toLowerCase();
    if (names.has(lower)) return { ok: false, error: `${name}: two rules for the same holiday have this name` };
    names.add(lower);
    namesByType.set(typeId, names);
    if (!Array.isArray(item.days)) return { ok: false, error: `${name}: days must be a list` };
    if (item.days.length < 2) return { ok: false, error: `${name}: a rule needs at least two days` };
    if (item.days.length > RULE_OFFSET_MAX - RULE_OFFSET_MIN + 1) return { ok: false, error: `${name}: too many days` };
    const offsets = new Set<number>();
    const days: HolidayRuleDaySpec[] = [];
    const slots = slotsByType.get(typeId) ?? new Map<string, string>();
    for (const d of item.days as { offset: unknown; shiftTypeId: unknown }[]) {
      if (!d || typeof d !== "object") return { ok: false, error: `${name}: each day must be an object` };
      const offset = d.offset;
      if (typeof offset !== "number" || !Number.isInteger(offset) || offset < RULE_OFFSET_MIN || offset > RULE_OFFSET_MAX) {
        return { ok: false, error: `${name}: each day must be ${RULE_OFFSET_MIN} to ${RULE_OFFSET_MAX} days from the holiday` };
      }
      if (offsets.has(offset)) return { ok: false, error: `${name}: a day is listed twice` };
      offsets.add(offset);
      if (typeof d.shiftTypeId !== "string" || !shiftIds.has(d.shiftTypeId)) return { ok: false, error: `${name}: choose a shift for each day` };
      const slotKey = `${offset}:${d.shiftTypeId}`;
      const other = slots.get(slotKey);
      if (other !== undefined) return { ok: false, error: `${name}: the same day and shift is already in ${other}` };
      days.push({ offset, shiftTypeId: d.shiftTypeId });
    }
    for (const d of days) slots.set(`${d.offset}:${d.shiftTypeId}`, name);
    slotsByType.set(typeId, slots);
    days.sort((a, b) => a.offset - b.offset);
    rules.push({ name, holidayTypeId: typeId, days });
  }
  return { ok: true, rules };
}

/** Strips a trailing " (observed)" so an observed holiday shares its type with the real one. */
export function holidayTypeNameFor(holidayName: string): string {
  return holidayName.replace(/\s*\(observed\)\s*$/i, "").trim();
}

/**
 * Grid warning (card #210): groups whose filled slots are held by different people. A slot nobody
 * holds is not warned (the coverage warnings cover it). `holderOf` returns the staff ids holding
 * `shiftTypeId` on `date`; `label` renders a person.
 */
export function splitGroupWarnings(
  groups: readonly HolidayGroup[],
  holderOf: (date: string, shiftTypeId: string) => string[],
  label: (staffId: string) => string,
  codeOf: (shiftTypeId: string) => string,
): string[] {
  const out: string[] = [];
  for (const g of groups) {
    const parts: string[] = [];
    // Someone who holds EVERY filled slot keeps the rule (another person on the same shift and
    // day, e.g. a second ORC, is not a split).
    let common: Set<string> | null = null;
    for (const s of g.slots) {
      const holders = holderOf(s.date, s.shiftTypeId);
      if (holders.length === 0) continue;
      common = common === null ? new Set(holders) : new Set(holders.filter((h) => common!.has(h)));
      parts.push(`${holders.map(label).join("/")} on ${s.date} (${codeOf(s.shiftTypeId)})`);
    }
    if (parts.length > 1 && common !== null && common.size === 0) out.push(`${g.ruleName}: ${parts.join(", ")} — the rule gives these days to one person`);
  }
  return out;
}
