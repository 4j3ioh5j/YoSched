import { describe, it, expect, vi, beforeEach } from "vitest";

// getSession reads the session token (auth) and then the DB; both are mocked so the gate
// can be tested without a database. next/navigation's redirect throws, like the real one.
const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; mustChangePassword?: boolean } },
  dbUser: null as null | Record<string, unknown>,
}));
vi.mock("../auth", () => ({ auth: async () => state.session }));
vi.mock("../prisma", () => ({ prisma: { user: { findUnique: async () => state.dbUser } } }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

import { getSession, getPageSession } from "../auth-guard";

const group = { permissions: ["users:view", "users:edit", "schedule:view"], level: 100, name: "Admin" };

beforeEach(() => {
  state.session = { user: { id: "u1" } };
  state.dbUser = { isActive: true, staffId: null, mustChangePassword: false, group };
});

describe("getSession forced-password-change gate (DB-authoritative)", () => {
  it("no pending change → ok", async () => {
    const r = await getSession("users:view");
    expect(r.error).toBeNull();
  });

  it("pending in the DB → JSON 403 with mustChangePassword, even when the token says false (stale JWT)", async () => {
    state.session = { user: { id: "u1", mustChangePassword: false } };
    state.dbUser = { ...state.dbUser, mustChangePassword: true };
    const r = await getSession("users:view");
    expect(r.error?.status).toBe(403);
    expect(r.mustChangePassword).toBe(true);
    expect(await r.error!.json()).toMatchObject({ mustChangePassword: true });
  });

  it("pending → blocked even with no permission required", async () => {
    state.dbUser = { ...state.dbUser, mustChangePassword: true };
    expect((await getSession()).error?.status).toBe(403);
  });

  it("allowPendingPasswordChange lets the change itself through", async () => {
    state.dbUser = { ...state.dbUser, mustChangePassword: true };
    const r = await getSession(undefined, { allowPendingPasswordChange: true });
    expect(r.error).toBeNull();
  });

  it("the exemption does not bypass permission checks", async () => {
    state.dbUser = { ...state.dbUser, mustChangePassword: true, group: { ...group, permissions: [] } };
    const r = await getSession("users:edit", { allowPendingPasswordChange: true });
    expect(r.error?.status).toBe(403);
    expect(r.mustChangePassword).toBeUndefined();
  });

  it("a token flag alone (DB false) does not block APIs", async () => {
    state.session = { user: { id: "u1", mustChangePassword: true } };
    expect((await getSession("users:view")).error).toBeNull();
  });

  it("inactive or signed-out still 401 before the gate", async () => {
    state.dbUser = { ...state.dbUser, isActive: false, mustChangePassword: true };
    expect((await getSession()).error?.status).toBe(401);
    state.session = null;
    expect((await getSession()).error?.status).toBe(401);
  });
});

describe("getPageSession", () => {
  it("pending in the DB → redirect to /account?mustChange=1", async () => {
    state.dbUser = { ...state.dbUser, mustChangePassword: true };
    await expect(getPageSession("users:view")).rejects.toMatchObject({ url: "/account?mustChange=1" });
  });
  it("other errors are returned unchanged for the page to handle", async () => {
    state.dbUser = { ...state.dbUser, group: { ...group, permissions: [] } };
    const r = await getPageSession("users:view");
    expect(r.error?.status).toBe(403);
  });
  it("ok passes through", async () => {
    expect((await getPageSession("users:view")).error).toBeNull();
  });
});
