import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { db } from "@/lib/__tests__/fake-prisma";

// Card #175 — the "Requested leave" Setting: strict on write, lenient on read.

vi.mock("@/lib/auth-guard", () => ({ getSession: async () => ({ error: null, session: { user: { id: "u1" } }, userId: "u1", permissions: ["settings:edit"], staffId: null }) }));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/__tests__/fake-prisma")).prisma }));

import { PUT } from "../scheduling-preferences/route";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;

beforeEach(() => {
  db.reset();
  db.prefs = { id: "default", leaveHoursPolicy: "up-to-target", payPeriodLengthDays: 14 };
});

describe("PUT /api/settings/scheduling-preferences leaveHoursPolicy", () => {
  it("rejects an unknown policy with 400 naming the choices, writing nothing", async () => {
    const res = await PUT(req({ leaveHoursPolicy: "sometimes" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("leaveHoursPolicy must be one of up-to-target, always");
    expect(db.prefs?.leaveHoursPolicy).toBe("up-to-target");
  });

  it("saves a valid policy", async () => {
    const res = await PUT(req({ leaveHoursPolicy: "always" }));
    expect(res.status).toBe(200);
    expect(db.prefs?.leaveHoursPolicy).toBe("always");
  });

  it("leaves the policy alone when the body does not mention it", async () => {
    const res = await PUT(req({ prefer3DayWeekends: false }));
    expect(res.status).toBe(200);
    expect(db.prefs?.leaveHoursPolicy).toBe("up-to-target");
  });

  it("creates the row with the policy when none exists yet", async () => {
    db.prefs = null;
    const res = await PUT(req({ leaveHoursPolicy: "always" }));
    expect(res.status).toBe(200);
    expect(db.prefs).toMatchObject({ id: "default", leaveHoursPolicy: "always" });
  });
});
