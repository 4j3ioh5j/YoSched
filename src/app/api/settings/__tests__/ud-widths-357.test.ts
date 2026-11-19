import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// Card #357: the user-defined column width choice is a Setting, strict on write.

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

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;

beforeEach(() => { db.prefs = { id: "default", printUdWidthMode: "bestFit", printUdWidthHundredths: 50, printUdColumnWidths: {} }; db.writes = 0; });

describe("PUT user-defined column widths (card #357)", () => {
  it("saves a known choice, a width and per-column widths", async () => {
    const r = await PUT(req({ printUdWidthMode: "perColumn", printUdWidthHundredths: 75, printUdColumnWidths: { "agg:a1": 120, "ded:b2": 40 } }));
    expect(r.status).toBe(200);
    expect(db.prefs).toMatchObject({ printUdWidthMode: "perColumn", printUdWidthHundredths: 75, printUdColumnWidths: { "agg:a1": 120, "ded:b2": 40 } });
    expect((await PUT(req({ printUdWidthMode: "matchLargest" }))).status).toBe(200);
    expect(db.prefs).toMatchObject({ printUdWidthMode: "matchLargest", printUdWidthHundredths: 75 });
  });
  it("400 on a bad choice, width or per-column entry, nothing written", async () => {
    for (const body of [{ printUdWidthMode: "auto" }, { printUdWidthMode: null }, { printUdWidthHundredths: 19 }, { printUdWidthHundredths: 201 }, { printUdWidthHundredths: 1.5 }, { printUdColumnWidths: [] }, { printUdColumnWidths: { "count:x": 50 } }, { printUdColumnWidths: { "agg:x": 500 } }]) {
      const r = await PUT(req(body));
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect(db.writes).toBe(0);
  });
});
