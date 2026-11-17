import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

// Card #319: the switch. Turning it ON needs settings:edit and a caller who has two-factor
// set up (so an admin can't lock themselves into setup-only); OFF always works. GET reports it
// with how many active logins haven't set two-factor up yet.
const st = vi.hoisted(() => ({
  guard: null as unknown,
  perm: [] as unknown[],
  me: { totpEnabled: true } as { totpEnabled: boolean } | null,
  writes: [] as unknown[],
  pending: 3,
  required: false,
}));
vi.mock("@/lib/auth-guard", () => ({
  getSession: async (p: unknown) => { st.perm.push(p); return st.guard; },
  isTotpRequired: async () => st.required,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: async () => st.me, count: async () => st.pending },
    schedulingPreferences: { upsert: async (a: unknown) => { st.writes.push(a); return {}; } },
  },
}));

import { GET, PUT } from "../route";

const ok = { error: null, session: { user: { id: "u1" } }, userId: "u1" };
const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
beforeEach(() => { st.guard = ok; st.perm = []; st.me = { totpEnabled: true }; st.writes = []; st.required = false; });

describe("/api/settings/require-totp (card #319)", () => {
  it("GET needs users:view and reports the switch and the pending count", async () => {
    st.required = true;
    const r = await GET();
    expect(st.perm[0]).toBe("users:view");
    expect(await r.json()).toEqual({ requireTotp: true, pendingLogins: 3 });
  });

  it("PUT needs settings:edit", async () => {
    st.guard = { error: NextResponse.json({}, { status: 403 }), session: null };
    expect((await PUT(req({ requireTotp: true }))).status).toBe(403);
    expect(st.perm[0]).toBe("settings:edit");
    expect(st.writes).toHaveLength(0);
  });

  it("ON is refused while the caller has no two-factor of their own", async () => {
    st.me = { totpEnabled: false };
    expect((await PUT(req({ requireTotp: true }))).status).toBe(409);
    expect(st.writes).toHaveLength(0);
  });

  it("ON with two-factor set up, and OFF always, are saved", async () => {
    expect((await PUT(req({ requireTotp: true }))).status).toBe(200);
    st.me = { totpEnabled: false };
    expect((await PUT(req({ requireTotp: false }))).status).toBe(200);
    expect(st.writes).toHaveLength(2);
    expect(st.writes[0]).toMatchObject({ update: { requireTotp: true }, create: { requireTotp: true } });
  });

  it("a non-boolean is a 400", async () => {
    expect((await PUT(req({ requireTotp: "yes" }))).status).toBe(400);
  });
});
