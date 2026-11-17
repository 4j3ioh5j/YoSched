import { describe, it, expect } from "vitest";
import { signTrust, verifyTrust } from "../device-trust";

// Card #319: a trusted-device cookie names the login's session version and the install's
// epoch (hashed), so a reset, re-enrolment, password change or restore ends it.
const K = "test-secret-not-real";
const now = 1_800_000_000_000;
const me = { userId: "u1", sv: 2, epoch: "E1" };
const DAY = 86_400;

describe("trusted-device cookie (card #319)", () => {
  it("verifies for the same login, version and epoch inside the window", () => {
    expect(verifyTrust(signTrust(me, now - 1000, K), me, 30 * DAY, K, now)).toBe(true);
  });
  it("is refused after the session version moves (reset / re-enrol / password change)", () => {
    expect(verifyTrust(signTrust(me, now, K), { ...me, sv: 3 }, 30 * DAY, K, now)).toBe(false);
  });
  it("is refused after a restore (new epoch), even when the version is rolled back to match", () => {
    expect(verifyTrust(signTrust(me, now, K), { ...me, epoch: "E2" }, 30 * DAY, K, now)).toBe(false);
  });
  it("is refused for another login, when too old, when from the future, or when tampered", () => {
    const t = signTrust(me, now - 1000, K);
    expect(verifyTrust(t, { ...me, userId: "u2" }, 30 * DAY, K, now)).toBe(false);
    expect(verifyTrust(signTrust(me, now - 31 * DAY * 1000, K), me, 30 * DAY, K, now)).toBe(false);
    expect(verifyTrust(signTrust(me, now + 60_000, K), me, 30 * DAY, K, now)).toBe(false);
    expect(verifyTrust(t.replace(":2:", ":3:"), { ...me, sv: 3 }, 30 * DAY, K, now)).toBe(false);
    expect(verifyTrust(t, me, 30 * DAY, "other-secret", now)).toBe(false);
  });
  it("an old-format cookie (userId:ts:hmac) is refused", () => {
    expect(verifyTrust(`u1:${now}:abcdef`, me, 30 * DAY, K, now)).toBe(false);
  });
  it("the cookie does not carry the epoch itself", () => {
    expect(signTrust(me, now, K)).not.toContain("E1");
  });
});
