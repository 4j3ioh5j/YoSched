import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// Card #301: printed header/footer templates, table font, DATE/DAY columns and
// pay-period labels are settings, strict on write.

const db = vi.hoisted(() => ({ prefs: null as Record<string, unknown> | null, writes: 0 }));

vi.mock("@/lib/auth-guard", () => ({ getSession: async () => ({ error: null, session: { user: { id: "u" } }, userId: "u", permissions: ["settings:edit"], staffId: null }) }));
vi.mock("@/lib/prisma", () => {
  const shiftType = { findUnique: async () => null, findMany: async () => [] };
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
import { Prisma } from "@/generated/prisma/client";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const HDR = { text: "{MONTH} {YEAR} MD SCHEDULE", size: 16, bold: true, align: "left" };

const START = {
  id: "default",
  printHeader: HDR,
  printFooter: null,
  printFontFamily: "Aptos Narrow",
  printFontSize: 9,
  splitDateDayColumns: true,
  dateColumnFormat: "MM-DD",
  dayColumnFormat: "DDD",
  printPayPeriodLabels: true,
};

beforeEach(() => {
  db.prefs = { ...START };
  db.writes = 0;
});

describe("print layout settings (card #301)", () => {
  it("saves every field", async () => {
    const body = {
      printHeader: { text: "T {YEAR}", size: 12, bold: false, align: "center" },
      printFooter: { text: "{DATE}", size: 8, bold: true, align: "left" },
      printFontFamily: "Arial Narrow",
      printFontSize: 10,
      splitDateDayColumns: false,
      dateColumnFormat: "DD/MM",
      dayColumnFormat: "Ddd",
      printPayPeriodLabels: false,
    };
    expect((await PUT(req(body))).status).toBe(200);
    for (const [k, v] of Object.entries(body)) expect(db.prefs![k]).toEqual(v);
  });

  it("null header/footer resets to the default", async () => {
    expect((await PUT(req({ printHeader: null, printFooter: null }))).status).toBe(200);
    expect(db.prefs!.printHeader).toBe(Prisma.DbNull);
    expect(db.prefs!.printFooter).toBe(Prisma.DbNull);
  });

  it.each([
    [{ printHeader: { text: "x", size: 99, bold: true, align: "left" } }],
    [{ printFooter: { text: "x", size: 8, bold: true } }],
    [{ printHeader: "JANUARY" }],
    [{ printFontFamily: 'Arial"; x' }],
    [{ printFontFamily: "" }],
    [{ printFontFamily: null }],
    [{ printFontSize: 20 }],
    [{ printFontSize: "9" }],
    [{ splitDateDayColumns: "yes" }],
    [{ dateColumnFormat: "YYYY" }],
    [{ dayColumnFormat: "ddd" }],
    [{ printPayPeriodLabels: 1 }],
  ])("rejects %j with 400 and writes nothing", async (bad) => {
    const res = await PUT(req(bad));
    expect(res.status).toBe(400);
    expect(db.writes).toBe(0);
    expect(db.prefs).toEqual(START);
  });

  it("a save that does not mention them (an older page) keeps them", async () => {
    expect((await PUT(req({ prefer3DayWeekends: false }))).status).toBe(200);
    for (const [k, v] of Object.entries(START)) expect(db.prefs![k]).toEqual(v);
  });
});
