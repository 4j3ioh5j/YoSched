import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// Card #299: the year export's file name template is a setting, strict on write.

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

import { PUT, GET } from "../scheduling-preferences/route";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const START = { id: "default", exportFileName: "OLD_{YEAR}" };

beforeEach(() => {
  db.prefs = { ...START };
  db.writes = 0;
});

describe("export file name setting (card #299)", () => {
  it.each(["MDSCHEDULE_{YEAR}", "Plain name", "{YEAR}"])("saves %j", async (v) => {
    expect((await PUT(req({ exportFileName: v }))).status).toBe(200);
    expect(db.prefs!.exportFileName).toBe(v);
  });

  it("trims surrounding spaces", async () => {
    expect((await PUT(req({ exportFileName: "  X_{YEAR} " }))).status).toBe(200);
    expect(db.prefs!.exportFileName).toBe("X_{YEAR}");
  });

  it("null clears it to plain null (the built-in default)", async () => {
    expect((await PUT(req({ exportFileName: null }))).status).toBe(200);
    expect(db.prefs!.exportFileName).toBeNull();
  });

  it.each([[""], ["a/b"], ["a:b_{YEAR}"], [".x"], ["x."], ["x".repeat(101)], [5], [true]])("rejects %j with 400 and writes nothing", async (bad) => {
    const res = await PUT(req({ exportFileName: bad }));
    expect(res.status).toBe(400);
    expect(db.writes).toBe(0);
    expect(db.prefs).toEqual(START);
  });

  it("a save that does not mention it keeps it", async () => {
    expect((await PUT(req({ prefer3DayWeekends: false }))).status).toBe(200);
    expect(db.prefs!.exportFileName).toBe("OLD_{YEAR}");
  });

  it("GET returns it", async () => {
    const body = await (await GET()).json();
    expect(body.exportFileName).toBe("OLD_{YEAR}");
  });
});
