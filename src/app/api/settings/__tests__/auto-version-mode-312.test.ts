import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// Card #312: what Print / Export do about versions is a setting: auto | ask | off.

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
const START = { id: "default", autoVersionMode: "auto" };

beforeEach(() => {
  db.prefs = { ...START };
  db.writes = 0;
});

describe("auto version setting (card #312)", () => {
  it.each(["auto", "ask", "off"])("saves %j", async (v) => {
    expect((await PUT(req({ autoVersionMode: v }))).status).toBe(200);
    expect(db.prefs!.autoVersionMode).toBe(v);
  });

  it.each([[""], ["AUTO"], ["never"], [null], [1], [true]])("rejects %j with 400 and writes nothing", async (bad) => {
    const res = await PUT(req({ autoVersionMode: bad }));
    expect(res.status).toBe(400);
    expect(db.writes).toBe(0);
    expect(db.prefs).toEqual(START);
  });

  it("a save that does not mention it keeps it", async () => {
    db.prefs = { id: "default", autoVersionMode: "off" };
    expect((await PUT(req({ prefer3DayWeekends: false }))).status).toBe(200);
    expect(db.prefs!.autoVersionMode).toBe("off");
  });

  it("GET returns it", async () => {
    db.prefs = { id: "default", autoVersionMode: "ask" };
    const res = await GET();
    expect((await res.json()).autoVersionMode).toBe("ask");
  });
});
