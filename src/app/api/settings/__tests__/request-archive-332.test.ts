import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { db } from "@/lib/__tests__/fake-prisma";

// Card #332 — the two Requests archive Settings: strict on write, missing keys keep the stored values
// (an older Settings tab that does not know them must not reset them).

vi.mock("@/lib/auth-guard", () => ({ getSession: async () => ({ error: null, session: { user: { id: "u1" } }, userId: "u1", permissions: ["settings:edit"], staffId: null }) }));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/__tests__/fake-prisma")).prisma }));

import { PUT } from "../scheduling-preferences/route";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;

beforeEach(() => {
  db.reset();
  db.prefs = { id: "default", requestArchiveDays: 5, archiveLeaveMetBy: "exact", payPeriodLengthDays: 14 };
});

describe("PUT scheduling-preferences: requestArchiveDays", () => {
  it("rejects values outside 0–60 or not whole numbers, writing nothing", async () => {
    for (const v of [-1, 61, 2.5, "3", null, true]) {
      const res = await PUT(req({ requestArchiveDays: v }));
      expect([v, res.status]).toEqual([v, 400]);
    }
    expect(db.prefs?.requestArchiveDays).toBe(5);
  });
  it("saves 0 and 60", async () => {
    expect((await PUT(req({ requestArchiveDays: 0 }))).status).toBe(200);
    expect(db.prefs?.requestArchiveDays).toBe(0);
    expect((await PUT(req({ requestArchiveDays: 60 }))).status).toBe(200);
    expect(db.prefs?.requestArchiveDays).toBe(60);
  });
});

describe("PUT scheduling-preferences: archiveLeaveMetBy", () => {
  it("rejects an unknown value with 400 naming the choices", async () => {
    const res = await PUT(req({ archiveLeaveMetBy: "anything" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("archiveLeaveMetBy must be one of exact, any-leave, any-off");
    expect(db.prefs?.archiveLeaveMetBy).toBe("exact");
  });
  it("saves each valid value", async () => {
    for (const v of ["any-leave", "any-off", "exact"]) {
      expect((await PUT(req({ archiveLeaveMetBy: v }))).status).toBe(200);
      expect(db.prefs?.archiveLeaveMetBy).toBe(v);
    }
  });
});

describe("an older Settings tab", () => {
  it("a save without the new keys keeps the stored values", async () => {
    const res = await PUT(req({ prefer3DayWeekends: false }));
    expect(res.status).toBe(200);
    expect(db.prefs).toMatchObject({ requestArchiveDays: 5, archiveLeaveMetBy: "exact" });
  });
  it("creating the row with the new keys stores them", async () => {
    db.prefs = null;
    expect((await PUT(req({ requestArchiveDays: 7, archiveLeaveMetBy: "any-leave" }))).status).toBe(200);
    expect(db.prefs).toMatchObject({ requestArchiveDays: 7, archiveLeaveMetBy: "any-leave" });
  });
});
