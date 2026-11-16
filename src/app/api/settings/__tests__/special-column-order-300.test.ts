import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// Card #300: the order of the special schedule columns (aggregate, dedicated, count) is
// one setting, strict on write; null resets to the built-in order.

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

beforeEach(() => {
  db.prefs = { id: "default", specialColumnOrder: ["count:c1"] };
  db.writes = 0;
});

describe("specialColumnOrder (card #300)", () => {
  it("saves a list of keys", async () => {
    expect((await PUT(req({ specialColumnOrder: ["ded:st-icu", "agg:g1", "count:c1"] }))).status).toBe(200);
    expect(db.prefs!.specialColumnOrder).toEqual(["ded:st-icu", "agg:g1", "count:c1"]);
  });

  it("null resets to the built-in order", async () => {
    expect((await PUT(req({ specialColumnOrder: null }))).status).toBe(200);
    expect(db.prefs!.specialColumnOrder).toBe(Prisma.DbNull);
  });

  it.each([[["agg:g1", "agg:g1"]], [["x:1"]], ["agg:g1"], [[1]], [{}]])("rejects %j with 400 and writes nothing", async (bad) => {
    const res = await PUT(req({ specialColumnOrder: bad }));
    expect(res.status).toBe(400);
    expect(db.writes).toBe(0);
    expect(db.prefs!.specialColumnOrder).toEqual(["count:c1"]);
  });

  it("a save that does not mention it (an older page) keeps it", async () => {
    expect((await PUT(req({ prefer3DayWeekends: false }))).status).toBe(200);
    expect(db.prefs!.specialColumnOrder).toEqual(["count:c1"]);
  });
});
