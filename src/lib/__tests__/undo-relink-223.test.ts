import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { undoThenRelink } from "../staff-undo-relink";

// Card #223: the edit form's Undo of a deactivate is two steps — the PUT that re-activates, then
// the re-link of the login. A refused re-link (409) keeps the saved re-activation.

describe("undoThenRelink", () => {
  it("PUT ok, then restore ok: the restored row", async () => {
    const r = await undoThenRelink(async () => ({ id: "s1", v: "put" }), "d1", async () => ({ ok: true as const, row: { id: "s1", v: "restored" } }));
    expect(r).toEqual({ row: { id: "s1", v: "restored" }, error: null, relinked: true });
  });
  it("PUT ok, restore refused (409): the PUT's row stays, with the message", async () => {
    const r = await undoThenRelink(async () => ({ id: "s1", v: "put" }), "d1", async () => ({ ok: false as const, error: "already undone" }));
    expect(r).toEqual({ row: { id: "s1", v: "put" }, error: "already undone", relinked: false });
  });
  it("PUT refused: nothing else is tried", async () => {
    let called = false;
    const r = await undoThenRelink(async () => null, "d1", async () => { called = true; return { ok: true as const, row: { id: "s1" } }; });
    expect(r).toBeNull();
    expect(called).toBe(false);
  });
  it("no deactivation id (no real login, or an old server): the PUT alone", async () => {
    let called = false;
    const r = await undoThenRelink(async () => ({ id: "s1" }), undefined, async () => { called = true; return { ok: true as const, row: { id: "x" } }; });
    expect(r).toEqual({ row: { id: "s1" }, error: null, relinked: false });
    expect(called).toBe(false);
  });
  it("the Staff page uses it for the edit Undo, and restore for the remove-deactivate Undo", () => {
    const src = readFileSync(join(__dirname, "../../app/staff/staff-page.tsx"), "utf8");
    expect(src).toMatch(/undoThenRelink\(/);
    expect(src).toMatch(/result\.deactivationId/);
  });
});
