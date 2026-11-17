import { describe, it, expect, vi, beforeEach } from "vitest";

// Card #319: getSession applies the required-2FA rules from the DATABASE (session version,
// install epoch, the switch) against what the token proved at sign-in.
const state = vi.hoisted(() => ({
  session: null as null | { user: Record<string, unknown> },
  dbUser: null as null | Record<string, unknown>,
  requireTotp: false,
  epoch: "E1",
}));
vi.mock("../auth", () => ({ auth: async () => state.session }));
vi.mock("../auth-epoch", () => ({ getEpoch: async () => state.epoch }));
vi.mock("../prisma", () => ({
  prisma: {
    user: { findUnique: async () => state.dbUser },
    schedulingPreferences: { findFirst: async () => ({ requireTotp: state.requireTotp }) },
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { url }); },
}));

import { getSession, getPageSession } from "../auth-guard";

const group = { permissions: ["users:view", "schedule:view"], level: 100, name: "Admin" };
const tok = (o: Record<string, unknown> = {}) => ({ user: { id: "u1", sv: 0, ep: "E1", secondFactor: "none", ...o } });

beforeEach(() => {
  state.session = tok();
  state.dbUser = { isActive: true, staffId: null, mustChangePassword: false, sessionVersion: 0, totpEnabled: false, group };
  state.requireTotp = false;
  state.epoch = "E1";
});

describe("getSession: session generation (card #319)", () => {
  it("a current token passes with the switch off", async () => {
    expect((await getSession("users:view")).error).toBeNull();
  });
  it("a token whose session version is behind the login's → 401", async () => {
    state.dbUser = { ...state.dbUser, sessionVersion: 1 };
    expect((await getSession()).error?.status).toBe(401);
  });
  it("a token from before the last restore (epoch rotated) → 401", async () => {
    state.epoch = "E2";
    expect((await getSession()).error?.status).toBe(401);
  });
  it("a token from before this release (no sv/ep) → 401", async () => {
    state.session = { user: { id: "u1" } };
    expect((await getSession()).error?.status).toBe(401);
  });
});

describe("getSession: required two-factor (card #319)", () => {
  beforeEach(() => { state.requireTotp = true; });

  it("not enrolled, password only → 403 mustSetUpTotp", async () => {
    const r = await getSession("users:view");
    expect(r.error?.status).toBe(403);
    expect(r.mustSetUpTotp).toBe(true);
    expect(await r.error!.json()).toMatchObject({ mustSetUpTotp: true });
  });
  it("the setup routes are let through (and still checked for permissions)", async () => {
    expect((await getSession(undefined, { allowPendingTotpSetup: true })).error).toBeNull();
    const r = await getSession("users:edit", { allowPendingTotpSetup: true });
    expect(r.error?.status).toBe(403);
    expect(r.mustSetUpTotp).toBeUndefined();
  });
  it("enrolled but this session proved nothing (two browsers) → 401, even with the exemption", async () => {
    state.dbUser = { ...state.dbUser, totpEnabled: true };
    expect((await getSession(undefined, { allowPendingTotpSetup: true })).error?.status).toBe(401);
  });
  it("a code or trusted device at sign-in passes", async () => {
    state.dbUser = { ...state.dbUser, totpEnabled: true };
    state.session = tok({ secondFactor: "totp" });
    expect((await getSession("users:view")).error).toBeNull();
    state.session = tok({ secondFactor: "trusted" });
    expect((await getSession("users:view")).error).toBeNull();
  });
  it("a pending password change still wins on routes that don't exempt it", async () => {
    state.dbUser = { ...state.dbUser, mustChangePassword: true };
    const r = await getSession(undefined, { allowPendingTotpSetup: true });
    expect(r.mustChangePassword).toBe(true);
  });
});

describe("getPageSession (card #319)", () => {
  it("setup-only sends pages to /account?setup2fa=1", async () => {
    state.requireTotp = true;
    await expect(getPageSession("users:view")).rejects.toMatchObject({ url: "/account?setup2fa=1" });
  });
  it("a revoked session is returned as an error (the page sends it to /login)", async () => {
    state.dbUser = { ...state.dbUser, sessionVersion: 3 };
    expect((await getPageSession("users:view")).error?.status).toBe(401);
  });
});
