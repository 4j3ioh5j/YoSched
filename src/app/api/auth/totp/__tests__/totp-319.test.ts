import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// Card #319: enrolling and disabling two-factor end every other session of the login (session
// version +1); enrolling is atomic (a second enrol finds nothing to change → 409); disabling is
// refused while two-factor is required; setup is reachable by a setup-only session.
const st = vi.hoisted(() => ({
  opts: [] as Record<string, unknown>[],
  updates: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[],
  count: 1,
  required: false,
}));
vi.mock("@/lib/auth-guard", () => ({
  getSession: async (_p: unknown, o: Record<string, unknown>) => { st.opts.push(o); return { error: null, session: { user: { id: "u1", email: "a@x" } }, userId: "u1" }; },
  isTotpRequired: async () => st.required,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => { st.updates.push(a); return { count: st.count }; } } },
}));
vi.mock("@/lib/crypto", () => ({ encrypt: (s: string) => `enc(${s})` }));
vi.mock("otplib", () => ({ generateSecret: () => "S", generateURI: () => "otpauth://x", verifySync: () => ({ valid: true }) }));
vi.mock("qrcode", () => ({ toDataURL: async () => "data:," }));

import { GET, POST, DELETE } from "../route";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
beforeEach(() => { st.opts = []; st.updates = []; st.count = 1; st.required = false; });

describe("/api/auth/totp (card #319)", () => {
  it("GET and POST let a setup-only session through", async () => {
    await GET();
    await POST(req({ secret: "S", code: "123456" }));
    expect(st.opts.every((o) => o.allowPendingTotpSetup === true && o.allowPendingPasswordChange === true)).toBe(true);
  });

  it("enrol only changes a login that isn't enrolled, and bumps its session version", async () => {
    const r = await POST(req({ secret: "S", code: "123456" }));
    expect(r.status).toBe(200);
    expect(st.updates[0].where).toEqual({ id: "u1", totpEnabled: false });
    expect(st.updates[0].data).toMatchObject({ totpEnabled: true, totpSecret: "enc(S)", sessionVersion: { increment: 1 } });
  });

  it("a second enrol (already enrolled elsewhere) → 409, nothing replaced", async () => {
    st.count = 0;
    expect((await POST(req({ secret: "S", code: "123456" }))).status).toBe(409);
  });

  it("disable bumps the session version", async () => {
    expect((await DELETE()).status).toBe(200);
    expect(st.updates[0].data).toMatchObject({ totpEnabled: false, totpSecret: null, sessionVersion: { increment: 1 } });
  });

  it("disable is refused while two-factor is required, and doesn't use the setup exemption", async () => {
    st.required = true;
    expect((await DELETE()).status).toBe(409);
    expect(st.updates).toHaveLength(0);
    expect(st.opts[0].allowPendingTotpSetup).toBeUndefined();
  });
});
