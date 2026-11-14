import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// Card #207: "Shift credited on holidays" — null or a leave shift that counts toward hours.
// Entitlement places it without eligibility or staffing caps, so a working, non-counting or
// off shift is refused with 400 and nothing is written.

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
  db.prefs = { id: "default", holidayShiftId: null, holidayPolicy: "entitlement" };
  db.writes = 0;
});

describe("holiday shift setting (card #207)", () => {
  it("saves a valid leave shift by id, and null clears it", async () => {
    expect((await PUT(req({ holidayShiftId: "st-hol" }))).status).toBe(200);
    expect(db.prefs!.holidayShiftId).toBe("st-hol");
    expect((await PUT(req({ holidayShiftId: null }))).status).toBe(200);
    expect(db.prefs!.holidayShiftId).toBeNull();
  });

  it.each([
    ["a working shift", "st-orc"],
    ["leave that does not count toward hours", "st-lwop"],
    ["an off shift", "st-x"],
    ["an unknown id", "st-nope"],
    ["a non-string", 42],
    ["an empty string", ""],
  ])("rejects %s with 400 and writes nothing", async (_label, bad) => {
    db.prefs!.holidayShiftId = "st-hol";
    const res = await PUT(req({ holidayShiftId: bad }));
    expect(res.status).toBe(400);
    expect(db.writes).toBe(0);
    expect(db.prefs!.holidayShiftId).toBe("st-hol");
  });

  it("a save that doesn't mention it (an older page) keeps it", async () => {
    db.prefs!.holidayShiftId = "st-hol";
    expect((await PUT(req({ holidayPolicy: "fill" }))).status).toBe(200);
    expect(db.prefs).toMatchObject({ holidayShiftId: "st-hol", holidayPolicy: "fill" });
  });
});
