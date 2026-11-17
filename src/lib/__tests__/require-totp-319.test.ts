import { describe, it, expect } from "vitest";
import { sessionAccess } from "@/lib/require-totp";
import { epochHash } from "@/lib/device-trust";

// Card #319: required two-factor login. The gate looks at what THIS SESSION proved at sign-in
// and at its generation (session version + install epoch), never only at the account's enrolment.

const db = { sessionVersion: 2, totpEnabled: true };
const ok = { sv: 2, ep: "E1", secondFactor: "totp" as const };

describe("sessionAccess (card #319)", () => {
  it("a stale session version or epoch is refused, with the switch on or off", () => {
    for (const requireTotp of [false, true]) {
      expect(sessionAccess({ ...ok, sv: 1 }, db, "E1", requireTotp)).toBe("signin");
      expect(sessionAccess({ ...ok, ep: "E0" }, db, "E1", requireTotp)).toBe("signin");
    }
  });

  it("a token from before this release (no sv/ep) counts as version 0 and the epoch it can't name", () => {
    expect(sessionAccess({}, { sessionVersion: 0, totpEnabled: false }, "E1", false)).toBe("signin");
  });

  it("switch off: a current session passes whatever it proved", () => {
    expect(sessionAccess({ ...ok, secondFactor: "none" }, db, "E1", false)).toBe("ok");
  });

  it("switch on: totp or trusted passes; enrolled + none must sign in again; unenrolled + none is setup-only", () => {
    expect(sessionAccess(ok, db, "E1", true)).toBe("ok");
    expect(sessionAccess({ ...ok, secondFactor: "trusted" }, db, "E1", true)).toBe("ok");
    expect(sessionAccess({ ...ok, secondFactor: "none" }, db, "E1", true)).toBe("signin");
    expect(sessionAccess({ ...ok, secondFactor: "none" }, { ...db, totpEnabled: false }, "E1", true)).toBe("setup");
    expect(sessionAccess({ ...ok, secondFactor: undefined }, { ...db, totpEnabled: false }, "E1", true)).toBe("setup");
  });

  it("two browsers: once A enrols (version bumped), B's old password-only session is refused", () => {
    const b = { sv: 0, ep: "E1", secondFactor: "none" as const };
    expect(sessionAccess(b, { sessionVersion: 0, totpEnabled: false }, "E1", true)).toBe("setup");
    expect(sessionAccess(b, { sessionVersion: 1, totpEnabled: true }, "E1", true)).toBe("signin");
  });

  it("epochHash is short, stable and doesn't reveal the epoch", () => {
    expect(epochHash("abc")).toMatch(/^[0-9a-f]{16}$/);
    expect(epochHash("abc")).toBe(epochHash("abc"));
    expect(epochHash("abc")).not.toBe(epochHash("abd"));
    expect(epochHash("abc")).not.toContain("abc");
  });
});

import { accountRedirectQuery } from "@/lib/require-totp";
describe("accountRedirectQuery (middleware, card #319)", () => {
  it("nothing pending → no redirect; password change wins over two-factor setup", () => {
    expect(accountRedirectQuery(false, false)).toBeNull();
    expect(accountRedirectQuery(false, true)).toBe("setup2fa");
    expect(accountRedirectQuery(true, true)).toBe("mustChange");
    expect(accountRedirectQuery(true, false)).toBe("mustChange");
  });
});
