import { describe, it, expect } from "vitest";
import { resolveBootstrapPassword } from "../seed-admin";

describe("resolveBootstrapPassword", () => {
  it("uses a valid env password verbatim", () => {
    const r = resolveBootstrapPassword("correct-horse-battery");
    expect(r).toEqual({ password: "correct-horse-battery", fromEnv: true, envIgnored: false });
  });

  it("trims surrounding whitespace before length check", () => {
    const r = resolveBootstrapPassword("  longenough  ");
    expect(r.fromEnv).toBe(true);
    expect(r.password).toBe("longenough");
  });

  it("REGRESSION: a too-short env password is ignored AND a revealed random one is used", () => {
    const r = resolveBootstrapPassword("short");
    expect(r.fromEnv).toBe(false); // did NOT use the env value
    expect(r.envIgnored).toBe(true); // caller must warn
    expect(r.password).not.toBe("short"); // generated, not the rejected value
    expect(r.password.length).toBeGreaterThan(16); // a real random password
  });

  it("generates (not ignored) when no env password is set", () => {
    for (const empty of [undefined, "", "   "]) {
      const r = resolveBootstrapPassword(empty);
      expect(r.fromEnv).toBe(false);
      expect(r.envIgnored).toBe(false);
      expect(r.password.length).toBeGreaterThan(16);
    }
  });

  it("generates a fresh password each call", () => {
    expect(resolveBootstrapPassword(undefined).password).not.toBe(resolveBootstrapPassword(undefined).password);
  });
});
