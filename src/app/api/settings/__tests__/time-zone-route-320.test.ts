import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// Card #320: Settings › Time zone. Only real zones; the backup time is converted by the service;
// a page opened under another zone is refused.

const h = vi.hoisted(() => ({ perm: "settings:edit", calls: [] as unknown[][], fail: null as Error | null, stored: null as string | null, signedIn: true }));
vi.mock("@/lib/prisma", () => ({ prisma: { schedulingPreferences: { findFirst: async () => ({ timeZone: h.stored }) } } }));

vi.mock("@/lib/auth-guard", () => ({
  getSession: async (p?: string) =>
    (p === undefined ? h.signedIn : p === h.perm)
      ? { error: null, session: { user: { id: "u" } }, userId: "u", permissions: [p], staffId: null }
      : { error: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) },
}));
vi.mock("@/lib/backup/auto-service", () => {
  class AutoConflictError extends Error {}
  return {
    AutoConflictError,
    setTimeZone: async (...a: unknown[]) => {
      h.calls.push(a);
      if (h.fail) throw h.fail;
      return { timeZone: a[0], autoTime: "17:00" };
    },
  };
});

import { GET, PUT } from "../time-zone/route";
import { AutoConflictError } from "@/lib/backup/auto-service";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;

beforeEach(() => { h.perm = "settings:edit"; h.calls = []; h.fail = null; h.stored = null; h.signedIn = true; });

describe("PUT /api/settings/time-zone", () => {
  it("saves a real zone with the zone the page showed", async () => {
    const r = await PUT(req({ timeZone: "America/Los_Angeles", zoneAtLoad: null }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ timeZone: "America/Los_Angeles", autoTime: "17:00" });
    expect(h.calls).toEqual([["America/Los_Angeles", null]]);
  });
  it("UTC is accepted (the rollback target)", async () => {
    expect((await PUT(req({ timeZone: "UTC", zoneAtLoad: "America/Los_Angeles" }))).status).toBe(200);
  });
  it("400 on anything that isn't a real zone, before the service", async () => {
    for (const tz of ["Mars/Olympus", "", 5, null, "America/Los_Angeles; DROP"]) {
      expect((await PUT(req({ timeZone: tz, zoneAtLoad: null }))).status).toBe(400);
    }
    expect((await PUT(req(null))).status).toBe(400);
    expect(h.calls).toEqual([]);
  });
  it("400 when zoneAtLoad is missing (a page must say what it showed)", async () => {
    expect((await PUT(req({ timeZone: "UTC" }))).status).toBe(400);
    expect(h.calls).toEqual([]);
  });
  it("409 when the zone changed since the page was opened", async () => {
    h.fail = new AutoConflictError("The time zone was changed since this page was opened. Reload the page.");
    const r = await PUT(req({ timeZone: "UTC", zoneAtLoad: null }));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/Reload/);
  });
  it("needs settings:edit", async () => {
    h.perm = "nothing";
    expect((await PUT(req({ timeZone: "UTC", zoneAtLoad: null }))).status).toBe(403);
    expect(h.calls).toEqual([]);
  });
});

describe("GET /api/settings/time-zone", () => {
  it("any signed-in login reads the zone; none chosen → UTC; junk stored → UTC", async () => {
    expect(await (await GET()).json()).toEqual({ storedZone: null, zone: "UTC" });
    h.stored = "America/Los_Angeles";
    expect(await (await GET()).json()).toEqual({ storedZone: "America/Los_Angeles", zone: "America/Los_Angeles" });
    h.stored = "Mars/Olympus";
    expect(await (await GET()).json()).toEqual({ storedZone: "Mars/Olympus", zone: "UTC" });
  });
  it("signed out → 403/401", async () => {
    h.signedIn = false;
    expect((await GET()).status).toBeGreaterThanOrEqual(400);
  });
});
