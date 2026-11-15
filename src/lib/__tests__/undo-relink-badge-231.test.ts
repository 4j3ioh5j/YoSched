import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { undoThenRelink } from "../staff-undo-relink";
import { relinkLoginLocal } from "../staff-login-link";

// Card #231: Undo of a deactivate from the edit form. The re-activating PUT saves, then the
// re-link is refused: the server left the login unlinked, so the page must show it unlinked too.
// The PUT's row is built from the old row (login included), so it can't be trusted for the login.

type Row = { id: string; loginUserId: string | null; loginStatus: string };
const unlinked = (r: Row): Row => ({ ...r, loginUserId: null, loginStatus: "none" });

describe("a refused re-link never shows the login as linked", () => {
  it("the row the page keeps has no login, and the login list is left unlinked", async () => {
    const res = await undoThenRelink<Row>(
      async () => ({ id: "s1", loginUserId: "u1", loginStatus: "active" }), // built from the old row
      "d1",
      async () => ({ ok: false as const, error: "already undone" }),
      unlinked,
    );
    expect(res).toEqual({ row: { id: "s1", loginUserId: null, loginStatus: "none" }, error: "already undone", relinked: false });
    const logins = [{ id: "u1", staffId: null as string | null }];
    const after = res!.relinked ? relinkLoginLocal(logins, res!.row.id, res!.row.loginUserId) : logins;
    expect(after).toEqual([{ id: "u1", staffId: null }]);
  });

  it("a re-link that succeeds keeps the restored row and links the login", async () => {
    const restored = { id: "s1", loginUserId: "u1", loginStatus: "active" };
    const res = await undoThenRelink<Row>(async () => ({ id: "s1", loginUserId: "u1", loginStatus: "active" }), "d1", async () => ({ ok: true as const, row: restored }), unlinked);
    expect(res).toEqual({ row: restored, error: null, relinked: true });
  });

  it("no re-link to make (no real login was unlinked): the PUT's row as it is", async () => {
    const res = await undoThenRelink<Row>(async () => ({ id: "s1", loginUserId: null, loginStatus: "none" }), undefined, async () => { throw new Error("not called"); }, unlinked);
    expect(res).toEqual({ row: { id: "s1", loginUserId: null, loginStatus: "none" }, error: null, relinked: false });
  });

  it("the Staff page links the login back only after a re-link that succeeded", () => {
    const src = readFileSync(join(__dirname, "../../app/staff/staff-page.tsx"), "utf8");
    const i = src.indexOf("undoThenRelink(");
    const block = src.slice(i, src.indexOf("markSaved(", i));
    expect(block).toMatch(/if \(res\.relinked\) setLogins\(\(cur\) => relinkLoginLocal\(cur, back\.id, back\.loginUserId\)\)/);
    expect(block).toMatch(/loginUserId: null/);
  });
});
