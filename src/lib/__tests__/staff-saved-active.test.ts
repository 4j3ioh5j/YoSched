import { describe, it, expect } from "vitest";
import { initSavedActive, applySavedActive, canLinkLogin } from "../staff-saved-active";

describe("staff saved-active state (Login selector enablement)", () => {
  it("regression: activate an inactive staff member → save → reopen → can link", () => {
    let s = initSavedActive([{ id: "ag", isActive: false }]);
    // Draft ticks Active but hasn't saved: still not linkable (server would 400).
    expect(canLinkLogin(s, "ag", true)).toBe(false);
    s = applySavedActive(s, { kind: "saved", id: "ag", isActive: true });
    // Reopen the editor: the draft is the saved row (active) → selector enabled.
    expect(canLinkLogin(s, "ag", true)).toBe(true);
  });
  it("deactivate → save → reopen: disabled", () => {
    let s = initSavedActive([{ id: "dh", isActive: true }]);
    expect(canLinkLogin(s, "dh", true)).toBe(true);
    s = applySavedActive(s, { kind: "saved", id: "dh", isActive: false });
    expect(canLinkLogin(s, "dh", false)).toBe(false);
  });
  it("an unsaved untick disables linking", () => {
    const s = initSavedActive([{ id: "dh", isActive: true }]);
    expect(canLinkLogin(s, "dh", false)).toBe(false);
  });
  it("soft delete (deactivated) disables; undo re-save enables", () => {
    let s = initSavedActive([{ id: "cd", isActive: true }]);
    s = applySavedActive(s, { kind: "deactivated", id: "cd" });
    expect(canLinkLogin(s, "cd", true)).toBe(false);
    s = applySavedActive(s, { kind: "saved", id: "cd", isActive: true });
    expect(canLinkLogin(s, "cd", true)).toBe(true);
  });
  it("newly added staff is linkable without a reload; removed or unknown is not", () => {
    let s = initSavedActive([]);
    expect(canLinkLogin(s, "new", true)).toBe(false);
    s = applySavedActive(s, { kind: "added", id: "new", isActive: true });
    expect(canLinkLogin(s, "new", true)).toBe(true);
    s = applySavedActive(s, { kind: "removed", id: "new" });
    expect(canLinkLogin(s, "new", true)).toBe(false);
  });
});
