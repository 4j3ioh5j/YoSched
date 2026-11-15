import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { relinkLoginLocal } from "../staff-login-link";

// Card #226: after Undo of a remove re-links a real login on the server, the Staff page's own
// list of logins shows it linked again (no "No login" badge until a reload).

const L = (id: string, staffId: string | null) => ({ id, staffId, name: id, email: `${id}@x`, isActive: true, loginComplete: true, isShell: false });

describe("relinkLoginLocal", () => {
  it("links the restored login to the person", () => {
    expect(relinkLoginLocal([L("u1", null), L("u2", "s2")], "s1", "u1")).toEqual([L("u1", "s1"), L("u2", "s2")]);
  });
  it("no login brought back: the list is unchanged", () => {
    const list = [L("u1", null)];
    expect(relinkLoginLocal(list, "s1", null)).toBe(list);
  });
  it("a login the page doesn't know (created elsewhere): unchanged (a reload shows it)", () => {
    const list = [L("u1", null)];
    expect(relinkLoginLocal(list, "s1", "u9")).toEqual(list);
  });
  it("the Undo of a remove uses it with the restored row", () => {
    const src = readFileSync(join(__dirname, "../../app/staff/staff-page.tsx"), "utf8");
    const at = src.indexOf("fetchRestore(result.removalId)");
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 1500)).toMatch(/setLogins\(\(cur\) => relinkLoginLocal\(cur, back\.id, back\.loginUserId\)\)/);
  });
});
