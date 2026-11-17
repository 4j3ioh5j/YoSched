import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// Card #332: a note on an archived Requests line is kept per person and day (request_day_notes),
// so deleting a request, undoing it or restoring it never touches it.

const h = vi.hoisted(() => ({
  perm: "schedule:edit",
  prefs: { timeZone: "UTC", requestArchiveDays: 0 } as Record<string, unknown> | null,
  staff: new Set(["s1"]),
  notes: new Map<string, string>(), // `${staffId}|${date}` → note
  now: new Date("2027-02-10T12:00:00Z"),
}));

vi.mock("@/lib/auth-guard", () => ({
  getSession: async (p?: string) =>
    p === h.perm
      ? { error: null, session: { user: { id: "u" } }, userId: "u", permissions: [p], staffId: null }
      : { error: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) },
}));

vi.mock("@/lib/prisma", () => {
  const key = (w: { staffId: string; date: Date }) => `${w.staffId}|${w.date.toISOString().slice(0, 10)}`;
  const requestDayNote = {
    upsert: async (a: { where: { staffId_date: { staffId: string; date: Date } }; create: { note: string }; update: { note: string } }) => {
      h.notes.set(key(a.where.staffId_date), a.update.note);
      return {};
    },
    deleteMany: async (a: { where: { staffId: string; date: { in: Date[] } } }) => {
      let count = 0;
      for (const d of a.where.date.in) if (h.notes.delete(key({ staffId: a.where.staffId, date: d }))) count++;
      return { count };
    },
    findMany: async () => [],
  };
  const prisma = {
    schedulingPreferences: { findFirst: async () => h.prefs },
    staff: { findUnique: async (a: { where: { id: string } }) => (h.staff.has(a.where.id) ? { id: a.where.id } : null) },
    requestDayNote,
    $transaction: async (ops: unknown[] | ((tx: unknown) => Promise<unknown>)) =>
      typeof ops === "function" ? ops(prisma) : Promise.all(ops as Promise<unknown>[]),
  };
  return { prisma };
});

import { PUT, NOTE_MAX, DATES_MAX } from "../route";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;

beforeEach(() => {
  h.perm = "schedule:edit";
  h.prefs = { timeZone: "UTC", requestArchiveDays: 0 };
  h.staff = new Set(["s1"]);
  h.notes = new Map();
  vi.useFakeTimers({ now: h.now, toFake: ["Date"] });
});

describe("PUT /api/request-day-notes", () => {
  it("writes the note to every day of the line", async () => {
    const r = await PUT(req({ staffId: "s1", dates: ["2027-01-15", "2027-01-16"], note: "Swapped with BC" }));
    expect(r.status).toBe(200);
    expect([...h.notes.entries()]).toEqual([["s1|2027-01-15", "Swapped with BC"], ["s1|2027-01-16", "Swapped with BC"]]);
  });

  it("null or blank clears the note", async () => {
    h.notes.set("s1|2027-01-15", "old");
    expect((await PUT(req({ staffId: "s1", dates: ["2027-01-15"], note: null }))).status).toBe(200);
    expect(h.notes.size).toBe(0);
    h.notes.set("s1|2027-01-15", "old");
    expect((await PUT(req({ staffId: "s1", dates: ["2027-01-15"], note: "   " }))).status).toBe(200);
    expect(h.notes.size).toBe(0);
  });

  it("refuses a day that is not archived (this month, or the archive wait not yet over)", async () => {
    expect((await PUT(req({ staffId: "s1", dates: ["2027-02-01"], note: "x" }))).status).toBe(400);
    h.prefs = { timeZone: "UTC", requestArchiveDays: 10 };
    expect((await PUT(req({ staffId: "s1", dates: ["2027-01-15"], note: "x" }))).status).toBe(400);
    expect(h.notes.size).toBe(0);
  });

  it("uses the Settings time zone for today", async () => {
    // 01:00 UTC on 1 February is still 31 January in Los Angeles: January is not archived there yet.
    vi.setSystemTime(new Date("2027-02-01T01:00:00Z"));
    h.prefs = { timeZone: "America/Los_Angeles", requestArchiveDays: 0 };
    expect((await PUT(req({ staffId: "s1", dates: ["2027-01-15"], note: "x" }))).status).toBe(400);
    h.prefs = { timeZone: "UTC", requestArchiveDays: 0 };
    expect((await PUT(req({ staffId: "s1", dates: ["2027-01-15"], note: "x" }))).status).toBe(200);
  });

  it("bounds: too many dates, a long note, bad dates, a bad body", async () => {
    const many = Array.from({ length: DATES_MAX + 1 }, (_, i) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10));
    expect((await PUT(req({ staffId: "s1", dates: many, note: "x" }))).status).toBe(400);
    expect((await PUT(req({ staffId: "s1", dates: ["2027-01-15"], note: "x".repeat(NOTE_MAX + 1) }))).status).toBe(400);
    expect((await PUT(req({ staffId: "s1", dates: ["2027-01-15"], note: "x".repeat(NOTE_MAX) }))).status).toBe(200);
    for (const dates of [[], ["2027-02-30"], ["15/01/2027"], "2027-01-15", [5]]) {
      expect((await PUT(req({ staffId: "s1", dates, note: "x" }))).status).toBe(400);
    }
    expect((await PUT(req({ staffId: "s1", dates: ["2027-01-15"], note: 5 }))).status).toBe(400);
    expect((await PUT(req({ dates: ["2027-01-15"], note: "x" }))).status).toBe(400);
    expect((await PUT(req(null))).status).toBe(400);
  });

  it("404 for an unknown person", async () => {
    expect((await PUT(req({ staffId: "nobody", dates: ["2027-01-15"], note: "x" }))).status).toBe(404);
  });

  it("needs schedule:edit", async () => {
    h.perm = "settings:edit";
    expect((await PUT(req({ staffId: "s1", dates: ["2027-01-15"], note: "x" }))).status).toBe(403);
    expect(h.notes.size).toBe(0);
  });
});
