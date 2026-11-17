import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextResponse } from "next/server";

// Card #319 (r2 critical): a trusted-device cookie is issued only through getSession (so a
// revoked token can't mint one), only for a session that proved a CODE at sign-in in the last
// five minutes, and it carries that session's version.
const st = vi.hoisted(() => ({
  result: null as unknown,
  trusted: [] as unknown[],
  opts: [] as unknown[],
}));
vi.mock("@/lib/auth-guard", () => ({ getSession: async (_p: unknown, o: unknown) => { st.opts.push(o); return st.result; } }));
vi.mock("@/lib/device-trust", () => ({ setDeviceTrust: async (u: unknown) => { st.trusted.push(u); } }));

import { POST } from "../route";

const ok = (user: Record<string, unknown>) => ({ error: null, session: { user: { id: "u1", ...user } }, userId: "u1" });
beforeEach(() => { st.trusted = []; st.opts = []; });

describe("/api/auth/trust-device (card #319)", () => {
  it("a revoked or signed-out session (getSession refuses) gets nothing", async () => {
    st.result = { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), session: null };
    expect((await POST()).status).toBe(401);
    expect(st.trusted).toHaveLength(0);
  });

  it("a fresh code at sign-in → cookie for that session's version", async () => {
    st.result = ok({ secondFactor: "totp", totpVerifiedAt: Date.now() - 1000, sv: 4 });
    expect((await POST()).status).toBe(200);
    expect(st.trusted).toEqual([{ id: "u1", sessionVersion: 4 }]);
  });

  it("a session that signed in on a trusted device (no code) can't re-mint one", async () => {
    st.result = ok({ secondFactor: "trusted", totpVerifiedAt: Date.now(), sv: 4 });
    expect((await POST()).status).toBe(403);
    st.result = ok({ secondFactor: "none", sv: 4 });
    expect((await POST()).status).toBe(403);
    expect(st.trusted).toHaveLength(0);
  });

  it("a code older than five minutes → 403", async () => {
    st.result = ok({ secondFactor: "totp", totpVerifiedAt: Date.now() - 6 * 60_000, sv: 4 });
    expect((await POST()).status).toBe(403);
  });

  it("uses the password-change exemption only (it is the last step of signing in)", async () => {
    st.result = ok({ secondFactor: "totp", totpVerifiedAt: Date.now(), sv: 0 });
    await POST();
    expect(st.opts[0]).toEqual({ allowPendingPasswordChange: true });
  });
});
