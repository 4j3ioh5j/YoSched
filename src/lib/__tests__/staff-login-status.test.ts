import { describe, it, expect } from "vitest";
import { staffLoginStatus, staffLoginStatusFromClient } from "../staff-login-status";

describe("staffLoginStatus", () => {
  it("'none' when there is no linked login", () => {
    expect(staffLoginStatus(null)).toBe("none");
  });

  it("'needs_setup' when email or password is missing (an un-completed shell)", () => {
    expect(staffLoginStatus({ isActive: false, email: null, passwordHash: null })).toBe("needs_setup");
    expect(staffLoginStatus({ isActive: false, email: "a@b.co", passwordHash: null })).toBe("needs_setup");
    expect(staffLoginStatus({ isActive: false, email: null, passwordHash: "hash" })).toBe("needs_setup");
    // even if somehow active, missing credentials still reads as needs_setup
    expect(staffLoginStatus({ isActive: true, email: null, passwordHash: "hash" })).toBe("needs_setup");
  });

  it("'disabled' when fully set up but not enabled", () => {
    expect(staffLoginStatus({ isActive: false, email: "a@b.co", passwordHash: "hash" })).toBe("disabled");
  });

  it("'active' only when email + password set AND enabled", () => {
    expect(staffLoginStatus({ isActive: true, email: "a@b.co", passwordHash: "hash" })).toBe("active");
  });
});

describe("staffLoginStatusFromClient (agrees with the server-side derivation)", () => {
  const cases = [
    { isActive: false, email: null, passwordHash: null },
    { isActive: false, email: "a@b.co", passwordHash: null },
    { isActive: true, email: null, passwordHash: "hash" },
    { isActive: false, email: "a@b.co", passwordHash: "hash" },
    { isActive: true, email: "a@b.co", passwordHash: "hash" },
  ];
  it("matches staffLoginStatus for every credential/active combination", () => {
    for (const c of cases) {
      const client = { isActive: c.isActive, loginComplete: !!c.email && !!c.passwordHash };
      expect(staffLoginStatusFromClient(client)).toBe(staffLoginStatus(c));
    }
  });
  it("'none' with no login", () => expect(staffLoginStatusFromClient(null)).toBe("none"));
});
