import { describe, it, expect } from "vitest";
import {
  isShellLogin,
  detachAction,
  parseStaffIdField,
  checkLinkTarget,
  isStaffIdUniqueViolation,
  linkOptionsForLogin,
  loginOptionsForStaff,
} from "../staff-login-link";

describe("isShellLogin / detachAction (Rules 2 + 4)", () => {
  it("no linked login → none", () => {
    expect(detachAction(null)).toBe("none");
  });
  it("never-completed shell (no email, no password) → delete", () => {
    expect(isShellLogin({ email: null, passwordHash: null })).toBe(true);
    expect(detachAction({ email: null, passwordHash: null })).toBe("delete");
    expect(detachAction({ email: "", passwordHash: null })).toBe("delete");
  });
  it("partial credentials are a real login → detach, never delete", () => {
    expect(detachAction({ email: "a@b.c", passwordHash: null })).toBe("detach");
    expect(detachAction({ email: null, passwordHash: "$2b$hash" })).toBe("detach");
  });
  it("complete login (active or inactive, admin or not) → detach", () => {
    expect(detachAction({ email: "a@b.c", passwordHash: "$2b$hash" })).toBe("detach");
  });
});

describe("parseStaffIdField", () => {
  it("absent → unchanged", () => expect(parseStaffIdField(undefined)).toEqual({ kind: "unchanged" }));
  it("null / empty → unlink", () => {
    expect(parseStaffIdField(null)).toEqual({ kind: "unlink" });
    expect(parseStaffIdField("")).toEqual({ kind: "unlink" });
  });
  it("string → link (trimmed)", () => expect(parseStaffIdField(" s1 ")).toEqual({ kind: "link", staffId: "s1" }));
  it("whitespace-only / non-string → invalid", () => {
    expect(parseStaffIdField("   ")).toEqual({ kind: "invalid" });
    expect(parseStaffIdField(42)).toEqual({ kind: "invalid" });
    expect(parseStaffIdField({})).toEqual({ kind: "invalid" });
  });
});

describe("checkLinkTarget (Rule 1)", () => {
  const dh = { id: "s-dh", initials: "DH", isActive: true };
  it("missing staff → 404", () => expect(checkLinkTarget(null, null, "u1")).toMatchObject({ ok: false, status: 404 }));
  it("inactive staff → 400", () =>
    expect(checkLinkTarget({ ...dh, isActive: false }, null, "u1")).toMatchObject({ ok: false, status: 400 }));
  it("free staff → ok (edit and create)", () => {
    expect(checkLinkTarget(dh, null, "u1")).toEqual({ ok: true });
    expect(checkLinkTarget(dh, null, null)).toEqual({ ok: true });
  });
  it("already linked to THIS login → ok (idempotent save)", () =>
    expect(checkLinkTarget(dh, { id: "u1", name: "David" }, "u1")).toEqual({ ok: true }));
  it("linked to another login → 409 naming the holder (never move)", () => {
    const r = checkLinkTarget(dh, { id: "u2", name: "Corey" }, "u1");
    expect(r).toEqual({ ok: false, status: 409, error: "DH is already linked to Corey. Unlink it there first." });
  });
  it("creating a new login for a taken staff → 409", () =>
    expect(checkLinkTarget(dh, { id: "u2", name: "Corey" }, null)).toMatchObject({ ok: false, status: 409 }));
});

describe("isStaffIdUniqueViolation", () => {
  it("P2002 on staffId (array or string target) → true", () => {
    expect(isStaffIdUniqueViolation({ code: "P2002", meta: { target: ["staffId"] } })).toBe(true);
    expect(isStaffIdUniqueViolation({ code: "P2002", meta: { target: "users_staffId_key" } })).toBe(true);
    expect(isStaffIdUniqueViolation({ code: "P2002", meta: { target: ["staff_id"] } })).toBe(true);
  });
  it("P2002 from the pg driver adapter (nested constraint) → true", () => {
    const meta = { modelName: "User", driverAdapterError: { cause: { kind: "UniqueConstraintViolation", constraint: { fields: ["staffId"] } } } };
    expect(isStaffIdUniqueViolation({ code: "P2002", meta })).toBe(true);
    const emailMeta = { modelName: "User", driverAdapterError: { cause: { constraint: { fields: ["email"] } } } };
    expect(isStaffIdUniqueViolation({ code: "P2002", meta: emailMeta })).toBe(false);
  });
  it("P2002 on email → false (own message)", () =>
    expect(isStaffIdUniqueViolation({ code: "P2002", meta: { target: ["email"] } })).toBe(false));
  it("other errors → false", () => {
    expect(isStaffIdUniqueViolation({ code: "P2025" })).toBe(false);
    expect(isStaffIdUniqueViolation(new Error("x"))).toBe(false);
    expect(isStaffIdUniqueViolation(null)).toBe(false);
    expect(isStaffIdUniqueViolation({ code: "P2002" })).toBe(false);
  });
});

describe("linkOptionsForLogin", () => {
  const staff = [
    { id: "s-sr", name: "SR", initials: "SR", isActive: true },
    { id: "s-cd", name: "CD", initials: "CD", isActive: true },
    { id: "s-dh", name: "DH", initials: "DH", isActive: true },
    { id: "s-ag", name: "AG", initials: "AG", isActive: false },
  ];
  it("lists active, unlinked staff sorted by initials; excludes taken and inactive", () => {
    const opts = linkOptionsForLogin(staff, new Set(["s-cd"]), null);
    expect(opts.map((o) => o.id)).toEqual(["s-dh", "s-sr"]);
  });
  it("always includes the login's own staff, even though it is 'taken'", () => {
    const opts = linkOptionsForLogin(staff, new Set(["s-cd", "s-dh"]), "s-dh");
    expect(opts.map((o) => o.id)).toEqual(["s-dh", "s-sr"]);
  });
  it("includes an inactive current staff, labelled", () => {
    const opts = linkOptionsForLogin(staff, new Set(["s-ag"]), "s-ag");
    expect(opts.find((o) => o.id === "s-ag")?.label).toBe("AG — AG (inactive)");
  });
});

describe("loginOptionsForStaff", () => {
  const logins = [
    { id: "u-d", name: "David", email: "d@x", staffId: "s-dh" },
    { id: "u-c", name: "Corey", email: "c@x", staffId: null },
    { id: "u-a", name: "Admin", email: null, staffId: null },
    { id: "u-o", name: "Other", email: "o@x", staffId: "s-zz" },
  ];
  it("unlinked logins + this staff's own login, sorted by name", () => {
    expect(loginOptionsForStaff(logins, "s-dh").map((o) => o.id)).toEqual(["u-a", "u-c", "u-d"]);
  });
  it("never offers a login linked to someone else", () => {
    expect(loginOptionsForStaff(logins, "s-dh").some((o) => o.id === "u-o")).toBe(false);
  });
  it("labels logins without an email", () => {
    expect(loginOptionsForStaff(logins, "s-dh").find((o) => o.id === "u-a")?.label).toBe("Admin (no email yet)");
  });
});
