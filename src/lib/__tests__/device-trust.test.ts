import { describe, it, expect } from "vitest";
import { deviceTrustCookieOptions, COOKIE_NAME } from "../device-trust";
import { BASE_PATH } from "../base-path";

// Regression: the trusted-device 2FA token is a bearer-like credential. Once
// YoSched shares the apex domain (yologiq.com) under /yosched, it MUST be scoped to
// the app sub-path — a root-scoped Path=/ would leak it to every other site on the
// apex. (Codex CRITICAL on the basePath move.)
describe("device-trust cookie scoping", () => {
  it("scopes the cookie to the app sub-path, never root", () => {
    const opts = deviceTrustCookieOptions(1000);
    expect(opts.path).toBe(BASE_PATH);
    expect(opts.path).toBe("/yosched");
    expect(opts.path).not.toBe("/");
  });

  it("keeps the token httpOnly and same-site lax, and passes maxAge through", () => {
    const opts = deviceTrustCookieOptions(4242);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.maxAge).toBe(4242);
  });

  it("names the cookie device-trust (with __Secure- prefix only when secure)", () => {
    expect(COOKIE_NAME.endsWith("device-trust")).toBe(true);
    // secure flag and the __Secure- prefix must agree
    expect(COOKIE_NAME.startsWith("__Secure-")).toBe(deviceTrustCookieOptions(1).secure);
  });
});
