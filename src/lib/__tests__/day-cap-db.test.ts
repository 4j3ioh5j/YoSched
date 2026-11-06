import { describe, it, expect } from "vitest";
import {
  DAY_CAP_LOCK_NS, DAY_CAP_TX, BUSY_MESSAGE, dayCapLockDates, dateKeysBetween, lockDayCaps,
  DayCapRefused, WriteRefused, isTxTimeout, refusalResponse,
} from "../day-cap-db";

describe("dayCapLockDates", () => {
  it("dedupes and sorts ascending — the one order every writer walks, so none can deadlock", () => {
    expect(dayCapLockDates(["2026-11-10", "2026-11-09", "2026-11-10", "2026-11-01"])).toEqual(["2026-11-01", "2026-11-09", "2026-11-10"]);
    expect(dayCapLockDates([])).toEqual([]);
  });
});

describe("dateKeysBetween", () => {
  it("lists every date of [start, end) — a whole month for the version restore", () => {
    const keys = dateKeysBetween(new Date(Date.UTC(2026, 10, 1)), new Date(Date.UTC(2026, 11, 1)));
    expect(keys).toHaveLength(30);
    expect(keys[0]).toBe("2026-11-01");
    expect(keys[29]).toBe("2026-11-30");
    expect(dateKeysBetween(new Date(Date.UTC(2026, 1, 1)), new Date(Date.UTC(2026, 2, 1)))).toHaveLength(28);
  });
});

describe("lockDayCaps", () => {
  it("issues one two-int advisory lock per date, ascending, with the YSDC namespace", async () => {
    const calls: { sql: string; values: unknown[] }[] = [];
    const tx = { $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => { calls.push({ sql: strings.join("$"), values }); return 1; } };
    await lockDayCaps(tx, ["2026-11-10", "2026-11-09", "2026-11-09"]);
    expect(calls.map((c) => c.values)).toEqual([[DAY_CAP_LOCK_NS, "2026-11-09"], [DAY_CAP_LOCK_NS, "2026-11-10"]]);
    for (const c of calls) {
      expect(c.sql).toMatch(/pg_advisory_xact_lock\(\$::int, hashtext\(\$::text\)\)/);
    }
    expect(DAY_CAP_LOCK_NS).toBe(0x59534443);
  });

  it("issues nothing for no dates", async () => {
    let n = 0;
    await lockDayCaps({ $executeRaw: async () => { n++; return 1; } }, []);
    expect(n).toBe(0);
  });
});

describe("DAY_CAP_TX", () => {
  it("waits up to 10 s to start and allows 60 s — a one-cell edit queued behind a month accept must not expire", () => {
    expect(DAY_CAP_TX).toEqual({ maxWait: 10_000, timeout: 60_000 });
  });
});

describe("refusalResponse", () => {
  const caps = { dayFull: (shiftTypeId: string, date: string, extra?: Record<string, unknown>) => Response.json({ ...extra, error: `full ${shiftTypeId} ${date}`, reason: "day-full" }, { status: 409 }) };

  it("maps DayCapRefused to the route's own day-full 409, extra fields included", async () => {
    const res = refusalResponse(new DayCapRefused("orc", "2026-11-09", { rejected: [1] }), caps as never)!;
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ rejected: [1], error: "full orc 2026-11-09", reason: "day-full" });
  });

  it("maps WriteRefused to its exact body and status", async () => {
    const res = refusalResponse(new WriteRefused({ error: "Cannot modify locked assignment", reason: "locked", staffId: "s1" }, 409), caps as never)!;
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Cannot modify locked assignment", reason: "locked", staffId: "s1" });
    expect(refusalResponse(new WriteRefused({ error: "Source assignment not found" }, 404), caps as never)!.status).toBe(404);
  });

  it("maps a Prisma transaction timeout (P2028) to the 409 busy retry, and nothing else", async () => {
    expect(isTxTimeout({ code: "P2028" })).toBe(true);
    expect(isTxTimeout({ code: "P2002" })).toBe(false);
    expect(isTxTimeout(new Error("x"))).toBe(false);
    expect(isTxTimeout(null)).toBe(false);
    const res = refusalResponse(Object.assign(new Error("Transaction API error"), { code: "P2028" }), caps as never)!;
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: BUSY_MESSAGE, reason: "busy" });
    // An unknown error is NOT swallowed: the route rethrows it (a 500 is the honest answer).
    expect(refusalResponse(new Error("FK violation"), caps as never)).toBeNull();
    expect(refusalResponse(Object.assign(new Error("dup"), { code: "P2002" }), caps as never)).toBeNull();
  });
});
