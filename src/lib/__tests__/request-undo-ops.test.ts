import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StatusOpRecorder, undoOrder } from "../request-undo-ops";

// Card #70 (Codex #361): a batch's status changes are recorded in the order they happened, so
// Undo (newest-first) undoes a co-approval BEFORE the approval whose inverse it depends on.
type S = "pending" | "approved" | "declined";

describe("StatusOpRecorder — operation order", () => {
  it("R1 approved, its cascade co-approves R2: recorded R1 then R2; undone R2 then R1 — whatever the request-list order", () => {
    // The request list happens to hold R2 before R1 (the order the old code replayed in).
    const pre = new Map<string, S>([["r2", "pending"], ["r1", "pending"]]);
    const rec = new StatusOpRecorder<S>(pre, "pending");
    rec.record("r1", "approved"); // the explicit approval
    for (const ar of [{ id: "r1", status: "approved" as S }, { id: "r2", status: "approved" as S }]) rec.record(ar.id, ar.status); // its affected window
    expect(rec.ops).toEqual([{ id: "r1", from: "pending", to: "approved" }, { id: "r2", from: "pending", to: "approved" }]);
    expect(undoOrder(rec.ops).map((o) => o.id)).toEqual(["r2", "r1"]);
  });

  it("R1 then R2 both explicit in one batch: undone R2 then R1", () => {
    const rec = new StatusOpRecorder<S>(new Map([["r1", "pending"], ["r2", "pending"]]), "pending");
    rec.record("r1", "approved");
    rec.record("r2", "approved");
    expect(undoOrder(rec.ops).map((o) => [o.id, o.from])).toEqual([["r2", "pending"], ["r1", "pending"]]);
  });

  it("a request that changes twice keeps both steps, each with the status it really came from", () => {
    const rec = new StatusOpRecorder<S>(new Map([["r1", "pending"], ["r2", "approved"]]), "pending");
    rec.record("r1", "approved");
    rec.record("r2", "pending"); // reverted by r1's cascade
    rec.record("r2", "approved"); // re-approved by a later one
    expect(rec.ops).toEqual([
      { id: "r1", from: "pending", to: "approved" },
      { id: "r2", from: "approved", to: "pending" },
      { id: "r2", from: "pending", to: "approved" },
    ]);
  });

  it("no-op changes are not recorded", () => {
    const rec = new StatusOpRecorder<S>(new Map([["r1", "approved"]]), "pending");
    rec.record("r1", "approved");
    expect(rec.ops).toEqual([]);
  });
});

describe("the grid records and replays through it (card #70)", () => {
  const src = readFileSync(join(__dirname, "../../app/schedule-grid.tsx"), "utf8");
  it("records with StatusOpRecorder, replays multi-undo newest-first, and asks for the restore on approvals", () => {
    expect(src).toMatch(/new StatusOpRecorder<RequestStatus>\(preStatus, "pending"\)/);
    expect(src).toMatch(/for \(const it of undoOrder\(entry\.items\)\)/);
    expect(src).toMatch(/undoApproval: it\.to === "approved"/);
    expect(src).toMatch(/undoApproval: entry\.item\.to === "approved"/);
    expect(src).not.toMatch(/postStatus/);
  });
});
