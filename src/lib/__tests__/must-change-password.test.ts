import { describe, it, expect } from "vitest";
import { shouldRedirectToPasswordChange, mustChangeAfterAdminSet } from "../must-change-password";

const PUBLIC = new Set(["/", "/login", "/privacy", "/robots.txt", "/sitemap.xml"]);

describe("shouldRedirectToPasswordChange (middleware, pages only)", () => {
  it("never redirects when no change is pending", () => {
    for (const p of ["/", "/staff", "/users", "/api/users"]) expect(shouldRedirectToPasswordChange(p, false, PUBLIC)).toBe(false);
  });
  it("redirects app pages, including the signed-in home", () => {
    for (const p of ["/", "/staff", "/users", "/settings", "/my-requests", "/equity"]) {
      expect(shouldRedirectToPasswordChange(p, true, PUBLIC)).toBe(true);
    }
  });
  it("exempts APIs (they get a JSON 403 from getSession), /account, /login, public pages, assets", () => {
    for (const p of ["/api", "/api/users", "/api/auth/password", "/account", "/account/x", "/login", "/privacy", "/robots.txt", "/sitemap.xml", "/_next/data/x.json"]) {
      expect(shouldRedirectToPasswordChange(p, true, PUBLIC)).toBe(false);
    }
  });
  it("does not treat look-alike prefixes as exempt", () => {
    expect(shouldRedirectToPasswordChange("/accounts", true, PUBLIC)).toBe(true);
    expect(shouldRedirectToPasswordChange("/apix", true, PUBLIC)).toBe(true);
  });
});

describe("mustChangeAfterAdminSet", () => {
  it("someone else's password → must change; your own → not", () => {
    expect(mustChangeAfterAdminSet("u2", "u1")).toBe(true);
    expect(mustChangeAfterAdminSet("u1", "u1")).toBe(false);
    expect(mustChangeAfterAdminSet(null, "u1")).toBe(true); // a new login
  });
});
