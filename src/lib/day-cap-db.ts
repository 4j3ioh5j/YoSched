import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { buildDayCapLookup, dayCapMessage, type DayCapLookup } from "@/lib/day-cap";

/**
 * Server-side per-day caps for the manual write routes: Staffing Rules "Max"
 * (staffing_requirements.maxCount) resolved for the given dates (holiday rows on
 * holidays). See src/lib/day-cap.ts.
 */
export type DayCaps = {
  capOf: DayCapLookup;
  /** The 409 the routes return when an edit would exceed a cap. `extra` fields (e.g. the
   *  offending cell's staffId, or every rejected cell) ride along in the body. */
  dayFull: (shiftTypeId: string, date: string, extra?: Record<string, unknown>) => NextResponse;
};

export async function loadDayCaps(dates: readonly string[]): Promise<DayCaps> {
  const uniq = [...new Set(dates)];
  const [reqs, shiftTypes, hols] = await Promise.all([
    prisma.staffingRequirement.findMany({
      where: { maxCount: { not: null } },
      select: { shiftTypeId: true, dayKey: true, maxCount: true },
      orderBy: [{ shiftTypeId: "asc" }, { dayKey: "asc" }],
    }),
    prisma.shiftType.findMany({ select: { id: true, code: true } }),
    uniq.length
      ? prisma.holiday.findMany({ where: { date: { in: uniq.map((d) => new Date(d + "T00:00:00Z")) } }, select: { date: true } })
      : Promise.resolve([] as { date: Date }[]),
  ]);
  const holidays = hols.map((h) => h.date.toISOString().split("T")[0]);
  const capOf = buildDayCapLookup(reqs, holidays);
  const codeById = new Map(shiftTypes.map((s) => [s.id, s.code] as const));
  return {
    capOf,
    dayFull: (shiftTypeId, date, extra = {}) => {
      const code = codeById.get(shiftTypeId) ?? "that shift";
      const cap = capOf(shiftTypeId, date) ?? 0;
      return NextResponse.json(
        { ...extra, error: dayCapMessage(code, cap, date, holidays), reason: "day-full", code, maxPerDay: cap, date },
        { status: 409 },
      );
    },
  };
}

// ───────────────────────── Serialising the check and the write ─────────────────────────
//
// Every assignment writer used to do "count the day's holders → compare with Max → write"
// as separate statements. Two requests that both read "0 holders" both passed and both
// inserted, so a day capped at one ORC could hold two (Codex #292). The overfill is by
// INSERT of a new row for a different staff, so no row lock or unique index can catch it.
//
// The fix: inside ONE transaction, take a transaction-scoped advisory lock per touched
// DATE first, then read, decide and write. Two writers on the same date serialise; writers
// on different dates don't wait for each other. Dates are locked in sorted order so two
// transactions touching overlapping date sets walk the same total order and cannot
// deadlock. The lock vanishes at commit or rollback, so a crash or a timeout can never
// leave a day locked. Whole-range writers that don't check a cap (version restore)
// take the same locks so a save can never land between their read and their delete.
//
// The key is the two-int form (classid, objid): classid = DAY_CAP_LOCK_NS, objid =
// hashtext(date). The pay-period lock (src/lib/pay-periods-server.ts) uses the one-bigint
// form, a different key space, so the two never collide.

export const DAY_CAP_LOCK_NS = 0x59534443; // "YSDC"

/** Prisma interactive-transaction options for every participating writer. The timeout
 *  runs from the transaction's start and INCLUDES time spent waiting on the advisory
 *  lock, so the 5 s default could expire a one-cell edit queued behind a month-long
 *  auto-schedule accept or a version restore. */
export const DAY_CAP_TX = { maxWait: 10_000, timeout: 60_000 } as const;

/** The dates to lock, deduplicated and in ascending order (the deadlock-free order). */
export function dayCapLockDates(dates: readonly string[]): string[] {
  return [...new Set(dates)].sort();
}

/** Every "YYYY-MM-DD" in [start, end) — the dates a whole-month writer must lock. */
export function dateKeysBetween(start: Date, end: Date): string[] {
  const out: string[] = [];
  for (let d = new Date(start); d < end; d = new Date(d.getTime() + 86_400_000)) {
    out.push(d.toISOString().split("T")[0]);
  }
  return out;
}

/** What lockDayCaps needs from a transaction client: Prisma.TransactionClient satisfies it. */
export type DayCapLockTx = { $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown> };
const _assignable: DayCapLockTx = null as unknown as Prisma.TransactionClient; // compile-time check only
void _assignable;

/** Take the per-date advisory locks, in sorted order, on the transaction `tx`. Must be the
 *  FIRST statement of the transaction, before any read the write decision depends on. */
export async function lockDayCaps(tx: DayCapLockTx, dates: readonly string[]): Promise<void> {
  for (const date of dayCapLockDates(dates)) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DAY_CAP_LOCK_NS}::int, hashtext(${date}::text))`;
  }
}

/** Thrown INSIDE the transaction when the write would exceed a per-day cap; rolls the
 *  whole transaction back. `refusalResponse` turns it into the usual day-full 409. */
export class DayCapRefused extends Error {
  constructor(
    public readonly shiftTypeId: string,
    public readonly date: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super("day-full");
    this.name = "DayCapRefused";
  }
}

/** Thrown INSIDE the transaction for any other refusal decided under the lock (a locked
 *  cell, a missing source cell): carries the exact body and status the route used to
 *  return before the check moved under the lock. */
export class WriteRefused extends Error {
  constructor(public readonly body: Record<string, unknown>, public readonly status: number) {
    super(typeof body.error === "string" ? body.error : "refused");
    this.name = "WriteRefused";
  }
}

/** Prisma P2028: the interactive transaction timed out (here: waited on a lock behind a
 *  long batch for longer than DAY_CAP_TX.timeout). Nothing was written. */
export function isTxTimeout(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2028";
}

export const BUSY_MESSAGE = "Another edit on that day is still saving — try again";

/** The 409 for a timed-out wait: the client reverts its optimistic cell and shows the
 *  sentence; reason "busy" tells the grid it is a retry, not a rule violation. */
export function busyResponse(): NextResponse {
  return NextResponse.json({ error: BUSY_MESSAGE, reason: "busy" }, { status: 409 });
}

/** Map an error thrown out of a locked transaction to the route's response, or null when
 *  it is not one of ours (the caller rethrows). `caps` is the loadDayCaps result for the
 *  route's dates, so the day-full body is byte-for-byte what the route returned before. */
export function refusalResponse(e: unknown, caps: Pick<DayCaps, "dayFull">): NextResponse | null {
  if (e instanceof DayCapRefused) return caps.dayFull(e.shiftTypeId, e.date, e.extra);
  if (e instanceof WriteRefused) return NextResponse.json(e.body, { status: e.status });
  if (isTxTimeout(e)) return busyResponse();
  return null;
}
