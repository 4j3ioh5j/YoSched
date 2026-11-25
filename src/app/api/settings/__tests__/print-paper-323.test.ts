import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// Card #323: paper size and margin are Settings, strict on write.

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

beforeEach(() => { db.prefs = { id: "default", printPaperSize: "letter", printMarginHundredthsIn: 50 }; db.writes = 0; });

describe("PUT paper and margin (card #323)", () => {
  it("saves a known paper and a whole margin from 50 to 100", async () => {
    expect((await PUT(req({ printPaperSize: "a4", printMarginHundredthsIn: 100 }))).status).toBe(200);
    expect(db.prefs).toMatchObject({ printPaperSize: "a4", printMarginHundredthsIn: 100 });
    expect((await PUT(req({ printMarginHundredthsIn: 50 }))).status).toBe(200);
    expect(db.prefs).toMatchObject({ printPaperSize: "a4", printMarginHundredthsIn: 50 });
  });
  it("400 on an unknown paper or a margin out of range, nothing written", async () => {
    for (const body of [{ printPaperSize: "legal" }, { printPaperSize: "A4" }, { printPaperSize: null }, { printMarginHundredthsIn: 24 }, { printMarginHundredthsIn: 25 }, { printMarginHundredthsIn: 49 }, { printMarginHundredthsIn: 101 }, { printMarginHundredthsIn: 1.5 }, { printMarginHundredthsIn: "x" }, { printMarginHundredthsIn: null }]) {
      const r = await PUT(req(body));
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect(db.writes).toBe(0);
    expect(db.prefs).toMatchObject({ printPaperSize: "letter", printMarginHundredthsIn: 50 });
  });
});
