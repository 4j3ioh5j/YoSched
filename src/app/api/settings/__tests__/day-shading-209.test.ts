import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// Card #209: weekend/holiday shading colours — #RRGGBB or null (off); strict on write.

type Shift = { id: string; code: string; countsTowardFte: boolean; isLeave: boolean; isOffShift: boolean };
const db = vi.hoisted(() => ({ shifts: [] as Shift[], prefs: null as Record<string, unknown> | null, writes: 0 }));

vi.mock("@/lib/auth-guard", () => ({ getSession: async () => ({ error: null, session: { user: { id: "u" } }, userId: "u", permissions: ["settings:edit"], staffId: null }) }));
vi.mock("@/lib/prisma", () => {
  const shiftType = {
    findUnique: async (a: { where: { id: string } }) => { const s = db.shifts.find((x) => x.id === a.where.id); return s ? { ...s } : null; },
    findMany: async () => [],
  };
  const schedulingPreferences = {
    findFirst: async () => (db.prefs ? { ...db.prefs } : null),
    upsert: async (a: { update: Record<string, unknown>; create: Record<string, unknown> }) => {
      db.writes++;
      db.prefs = db.prefs ? { ...db.prefs, ...a.update } : { ...a.create };
      return { ...db.prefs };
    },
  };
  return { prisma: { shiftType, schedulingPreferences } };
});

import { PUT } from "../scheduling-preferences/route";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;

beforeEach(() => {
  db.shifts = [
    { id: "st-hol", code: "HOL", countsTowardFte: true, isLeave: true, isOffShift: false },
    { id: "st-orc", code: "ORC", countsTowardFte: true, isLeave: false, isOffShift: false },
    { id: "st-lwop", code: "LWOP", countsTowardFte: false, isLeave: true, isOffShift: false },
    { id: "st-x", code: "X", countsTowardFte: false, isLeave: false, isOffShift: true },
  ];
  db.prefs = { id: "default", holidayPolicy: "entitlement", printWeekendColor: "#EBEBEB", printHolidayColor: "#EBEBEB", screenHolidayColor: "#EBEBEB" };
  db.writes = 0;
});

describe("shading colours (card #209)", () => {
  const KEYS = ["printWeekendColor", "printHolidayColor", "screenHolidayColor"] as const;
  it.each(KEYS)("%s: saves a colour, and null switches it off", async (k) => {
    expect((await PUT(req({ [k]: "#C0C0C0" }))).status).toBe(200);
    expect(db.prefs![k]).toBe("#C0C0C0");
    expect((await PUT(req({ [k]: null }))).status).toBe(200);
    expect(db.prefs![k]).toBeNull();
  });
  it.each(["gray", "#EEE", "D0D0D0", "#D0D0D0FF", "", 42, true])("rejects %j with 400 and writes nothing", async (bad) => {
    for (const k of KEYS) {
      db.writes = 0;
      const res = await PUT(req({ [k]: bad }));
      expect(res.status, k).toBe(400);
      expect(db.writes).toBe(0);
      expect(db.prefs![k]).toBe("#EBEBEB");
    }
  });
  it("a save that doesn't mention them (an older page) keeps them, including a switched-off one", async () => {
    db.prefs!.printHolidayColor = null;
    expect((await PUT(req({ holidayPolicy: "fill" }))).status).toBe(200);
    expect(db.prefs).toMatchObject({ printWeekendColor: "#EBEBEB", printHolidayColor: null, screenHolidayColor: "#EBEBEB" });
  });
});
