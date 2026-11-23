import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// Card #477: the PDF font is a Setting, strict on write (only a bundled font's id).

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

beforeEach(() => { db.prefs = { id: "default", printPdfFont: "archivo-narrow" }; db.writes = 0; });

describe("PUT printPdfFont (card #477)", () => {
  it("saves a bundled font's id", async () => {
    const res = await PUT(req({ printPdfFont: "barlow-semi-condensed" }));
    expect(res.status).toBe(200);
    // Card #482: Settings shows "Saved" only when the answer holds the font as sent.
    expect(await res.json()).toMatchObject({ printPdfFont: "barlow-semi-condensed" });
    expect(db.prefs).toMatchObject({ printPdfFont: "barlow-semi-condensed" });
  });
  it("400 on anything else, nothing written", async () => {
    for (const body of [{ printPdfFont: "Barlow" }, { printPdfFont: "" }, { printPdfFont: null }, { printPdfFont: 1 }, { printPdfFont: "toString" }]) {
      expect((await PUT(req(body))).status, JSON.stringify(body)).toBe(400);
    }
    expect(db.writes).toBe(0);
    expect(db.prefs).toMatchObject({ printPdfFont: "archivo-narrow" });
  });
});
