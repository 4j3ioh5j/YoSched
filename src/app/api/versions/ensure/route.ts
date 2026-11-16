import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { NextRequest, NextResponse } from "next/server";
import { monthDateRange, hashSnapshot, nextVersionNumber } from "@/lib/versions";
import { snapshotMonth, VERSION_LIST_SELECT } from "@/lib/versions-db";
import { lockDayCaps, dateKeysBetween, DAY_CAP_TX, isTxTimeout, busyResponse } from "@/lib/day-cap-db";
import type { EnsureMonth } from "@/lib/auto-version";

// Card #312: Print and Export call this first, so a printout or an exported file never
// carries a stale or missing version number. For each month: no version yet (a blank
// month too → Version 1), or cells changed since the current version → save a new
// current version; unchanged → keep the current one.
//
// expectedHash is the hash of the cells the browser is about to print. All months are
// checked under their day locks in ONE transaction; if any month on the server differs
// (another user, an edit still saving) NOTHING is saved and the stale months come back
// as a 409, so the browser never prints cells under a version that does not hold them.

const KINDS = new Set(["print", "export"]);
const MAX_MONTHS = 12;
const MAX_COMMENT = 200;

class StaleMonths extends Error {
  constructor(public readonly stale: { year: number; month: number }[]) {
    super("stale");
  }
}

function parseBody(body: unknown): { comment: string; months: EnsureMonth[] } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.kind !== "string" || !KINDS.has(b.kind)) return null;
  if (typeof b.comment !== "string" || !b.comment.trim() || b.comment.length > MAX_COMMENT) return null;
  if (!Array.isArray(b.months) || b.months.length === 0 || b.months.length > MAX_MONTHS) return null;
  const seen = new Set<string>();
  const months: EnsureMonth[] = [];
  for (const m of b.months as unknown[]) {
    if (!m || typeof m !== "object") return null;
    const { year, month, expectedHash } = m as Record<string, unknown>;
    if (typeof year !== "number" || !Number.isInteger(year) || year < 1900 || year > 9999) return null;
    if (typeof month !== "number" || !Number.isInteger(month) || month < 0 || month > 11) return null;
    if (typeof expectedHash !== "string" || !expectedHash || expectedHash.length > 100) return null;
    const key = `${year}-${month}`;
    if (seen.has(key)) return null;
    seen.add(key);
    months.push({ year, month, expectedHash });
  }
  return { comment: b.comment.trim(), months };
}

// POST /api/versions/ensure { kind: "print"|"export", comment, months: [{ year, month, expectedHash }] }
export async function POST(req: NextRequest) {
  const { error } = await getSession("schedule:edit");
  if (error) return error;

  const parsed = parseBody(await req.json().catch(() => null));
  if (!parsed) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { comment, months } = parsed;

  const dates = months.flatMap(({ year, month }) => {
    const { start, end } = monthDateRange(year, month);
    return dateKeysBetween(start, end);
  });

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Every day of every month FIRST, before any read the decision depends on.
      await lockDayCaps(tx, dates);

      const snaps = [];
      const stale: { year: number; month: number }[] = [];
      for (const m of months) {
        const snapshot = await snapshotMonth(tx, m.year, m.month);
        const snapshotHash = hashSnapshot(snapshot);
        if (snapshotHash !== m.expectedHash) stale.push({ year: m.year, month: m.month });
        snaps.push({ ...m, snapshot, snapshotHash });
      }
      if (stale.length > 0) throw new StaleMonths(stale);

      const versions = [];
      const created: { year: number; month: number }[] = [];
      for (const { year, month, snapshot, snapshotHash } of snaps) {
        const existing = await tx.scheduleVersion.findMany({
          where: { year, month },
          select: { id: true, versionNumber: true, isCurrent: true, snapshotHash: true },
        });
        const current = existing.find((v) => v.isCurrent);
        if (current && current.snapshotHash === snapshotHash) {
          const keep = await tx.scheduleVersion.findUnique({ where: { id: current.id }, select: VERSION_LIST_SELECT });
          versions.push(keep);
          continue;
        }
        const versionNumber = nextVersionNumber(existing.map((v) => v.versionNumber));
        await tx.scheduleVersion.updateMany({ where: { year, month, isCurrent: true }, data: { isCurrent: false } });
        versions.push(
          await tx.scheduleVersion.create({
            data: { year, month, versionNumber, comment, snapshot, snapshotHash, isCurrent: true, isAutoBackup: false },
            select: VERSION_LIST_SELECT,
          }),
        );
        created.push({ year, month });
      }
      return { versions, created };
    }, DAY_CAP_TX);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof StaleMonths) {
      return NextResponse.json(
        { error: "The schedule changed on the server. Reload and try again.", reason: "stale", stale: e.stale },
        { status: 409 },
      );
    }
    if (isTxTimeout(e)) return busyResponse();
    throw e;
  }
}
