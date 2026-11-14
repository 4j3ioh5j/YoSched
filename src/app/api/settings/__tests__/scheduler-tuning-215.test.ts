import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// Card #215: the scheduler tuning numbers are Settings values — strict on write (400, nothing
// written), partial saves leave the other values alone, and the read is lenient.

const db = vi.hoisted(() => ({ prefs: null as Record<string, unknown> | null, writes: 0 }));

vi.mock("@/lib/auth-guard", () => ({ getSession: async () => ({ error: null, session: { user: { id: "u" } }, userId: "u", permissions: ["settings:edit", "settings:view"], staffId: null }) }));
vi.mock("@/lib/prisma", () => {
  const schedulingPreferences = {
    findFirst: async () => (db.prefs ? { ...db.prefs } : null),
    create: async (a: { data: Record<string, unknown> }) => { db.prefs = { ...a.data }; return { ...db.prefs }; },
    upsert: async (a: { update: Record<string, unknown>; create: Record<string, unknown> }) => {
      db.writes++;
      db.prefs = db.prefs ? { ...db.prefs, ...a.update } : { ...a.create };
      return { ...db.prefs };
    },
  };
  return { prisma: { schedulingPreferences, shiftType: { findUnique: async () => null, findMany: async () => [] } } };
});

import { PUT } from "../scheduling-preferences/route";
import { readTuning, TUNING_DEFAULTS, isWeekendDow, weekendLabel, tuningError } from "@/lib/scheduler-tuning";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const put = async (body: unknown) => { const r = await PUT(req(body)); return { status: r.status, body: (await r.json()) as Record<string, unknown> }; };

beforeEach(() => {
  db.prefs = { id: "default", ...TUNING_DEFAULTS };
  db.writes = 0;
});

describe("PUT scheduling-preferences — scheduler tuning (card #215)", () => {
  it.each([
    ["radius 0", { spreadRadiusDays: 0 }],
    ["radius 29", { spreadRadiusDays: 29 }],
    ["radius fractional", { spreadRadiusDays: 7.5 }],
    ["radius as text", { spreadRadiusDays: "14" }],
    ["band 0", { evenBandCalls: 0 }],
    ["band negative", { evenBandCalls: -1 }],
    ["band 11", { evenBandCalls: 11 }],
    ["weight negative", { softRequestOffWeight: -0.5 }],
    ["weight 101", { softAvoidFollowWeight: 101 }],
    ["weight NaN-ish null", { softRequestOffWeight: null }],
    ["scarce fractional", { scarcePoolSize: 2.5 }],
    ["scarce 51", { scarcePoolSize: 51 }],
    ["weekend 7", { weekendStartDow: 7 }],
    ["weekend -1", { weekendStartDow: -1 }],
    ["weekend fractional", { weekendStartDow: 5.5 }],
  ])("refuses %s with 400 and writes nothing", async (_l, body) => {
    const r = await put(body);
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/must be/);
    expect(db.writes).toBe(0);
    expect(db.prefs).toMatchObject(TUNING_DEFAULTS);
  });

  it("a bad value refuses the whole save, valid fields included", async () => {
    const r = await put({ spreadRadiusDays: 7, weekendStartDow: 9 });
    expect(r.status).toBe(400);
    expect(db.prefs?.spreadRadiusDays).toBe(14);
  });

  it("a partial save changes only what it sends", async () => {
    const r = await put({ weekendStartDow: 5, evenBandCalls: 1.5 });
    expect(r.status).toBe(200);
    expect(db.prefs).toMatchObject({ ...TUNING_DEFAULTS, weekendStartDow: 5, evenBandCalls: 1.5 });
  });

  it("the edges are accepted", async () => {
    expect((await put({ spreadRadiusDays: 1, evenBandCalls: 10, softRequestOffWeight: 0, softAvoidFollowWeight: 100, scarcePoolSize: 0, weekendStartDow: 0 })).status).toBe(200);
    expect((await put({ spreadRadiusDays: 28, scarcePoolSize: 50, weekendStartDow: 6 })).status).toBe(200);
  });
});

describe("scheduler-tuning helpers (card #215)", () => {
  it("lenient read: missing, null or corrupt values are the defaults", () => {
    expect(readTuning(null)).toEqual(TUNING_DEFAULTS);
    expect(readTuning({ spreadRadiusDays: 99, evenBandCalls: 0, weekendStartDow: 3, scarcePoolSize: "x" })).toEqual({ ...TUNING_DEFAULTS, weekendStartDow: 3 });
  });
  it("the weekend is its first day and the next, wrapping the week", () => {
    expect([0, 1, 2, 3, 4, 5, 6].filter((d) => isWeekendDow(d, 6))).toEqual([0, 6]);
    expect([0, 1, 2, 3, 4, 5, 6].filter((d) => isWeekendDow(d, 5))).toEqual([5, 6]);
    expect(weekendLabel(6)).toBe("Saturday + Sunday");
    expect(weekendLabel(5)).toBe("Friday + Saturday");
  });
  it("errors say the range in plain words", () => {
    expect(tuningError("evenBandCalls", 0)).toBe("evenBandCalls must be a number from more than 0 to 10");
    expect(tuningError("weekendStartDow", 3)).toBeNull();
  });
});
