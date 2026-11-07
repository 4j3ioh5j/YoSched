import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Card #76: the activation panel opened UNDER the shift's edit window (both z-50, panel first in
// the DOM), and Escape closed both. The panel must sit above every z-50 modal, and the shift
// section's Escape must leave the edit window alone while the panel is open.
describe("activation panel layering (card #76)", () => {
  const src = readFileSync(join(__dirname, "../../app/settings/settings-page.tsx"), "utf8");
  const panel = src.slice(src.indexOf("function ActivationPanel("), src.indexOf("function ShiftTypesSection("));
  it("the panel's overlay is above z-50", () => {
    const m = panel.match(/className="fixed inset-0 (z-\[?\d+\]?)/);
    expect(m).not.toBeNull();
    const z = Number(m![1].replace(/\D/g, ""));
    expect(z).toBeGreaterThan(50);
  });
  it("Escape doesn't cancel the edit window while the panel is open", () => {
    expect(src).toMatch(/useEscape\(\(\) => \{ if \(!activating\) cancelEdit\(\); \}\);/);
  });
});

// Card #77: the panel used to close on "Turn on" and the save ran behind it, so the edit window
// flashed back (long enough to press Save again) and then closed by itself.
describe("activation panel save flow (card #77)", () => {
  const src = readFileSync(join(__dirname, "../../app/settings/settings-page.tsx"), "utf8");
  const panel = src.slice(src.indexOf("function ActivationPanel("), src.indexOf("function ShiftTypesSection("));
  it("the parent closes the panel only after the save succeeded, never before awaiting it", () => {
    expect(src).toMatch(/const err = await saveShift\(activating, c\);\s*if \(!err\) setActivating\(null\);\s*return err;/);
    expect(src).not.toMatch(/setActivating\(null\); void saveShift\(/);
  });
  it("saveShift reports failure to the panel", () => {
    expect(src).toMatch(/async function saveShift\(shift: ShiftType, activation\?: ActivationChoice\): Promise<string \| null>/);
    expect(src).toMatch(/setStatus\("error"\);\s*return msg;/);
  });
  it("while saving: Turn on and Cancel are disabled, Escape is ignored, the error is shown on failure", () => {
    expect(panel).toMatch(/disabled=\{!data \|\| saving\}/);
    expect(panel).toMatch(/onClick=\{onCancel\} disabled=\{saving\}/);
    expect(panel).toMatch(/useEscape\(\(\) => \{ if \(!saving\) onCancel\(\); \}\);/);
    expect(panel).toMatch(/if \(err\) \{ setSaveError\(err\); setSaving\(false\); \}/);
    expect(panel).toMatch(/\{saveError && /);
  });
  it("opens at its full size while loading (no small window that then grows)", () => {
    expect(panel).toMatch(/min-h-\[\d+rem\]/);
  });
});

import { activationAlreadyCommitted } from "@/lib/activation-retry";
// Card #78: when the activation saved but a later step failed, a retry redoes only the rest.
describe("activation panel retry after a partial save (card #78)", () => {
  const src = readFileSync(join(__dirname, "../../app/settings/settings-page.tsx"), "utf8");
  const panel = src.slice(src.indexOf("function ActivationPanel("), src.indexOf("function ShiftTypesSection("));
  const save = src.slice(src.indexOf("async function saveShift("), src.indexOf("async function deleteShift("));

  it("activationAlreadyCommitted matches only the same shift and the same panel version", () => {
    expect(activationAlreadyCommitted({ shiftId: "S", version: "v1" }, "S", "v1")).toBe(true);
    expect(activationAlreadyCommitted({ shiftId: "S", version: "v1" }, "S", "v2")).toBe(false);
    expect(activationAlreadyCommitted({ shiftId: "S", version: "v1" }, "T", "v1")).toBe(false);
    expect(activationAlreadyCommitted(null, "S", "v1")).toBe(false);
    expect(activationAlreadyCommitted({ shiftId: "S", version: "v1" }, "S", undefined)).toBe(false);
  });
  it("saveShift skips the activation POST when it is already committed", () => {
    expect(save).toMatch(/const alreadyCommitted = activationAlreadyCommitted\(committed, shift\.id, activation\?\.version\);/);
    expect(save).toMatch(/if \(activation && !alreadyCommitted\) \{\s*const res = await fetch\("\/api\/settings\/shift-types\/activation"/);
    expect(save).toMatch(/\} else if \(!activation\) \{\s*const res = await fetch\("\/api\/settings\/shift-types", \{\s*method: "PUT"/);
  });
  it("right after the activation commits: recorded, made the saved row, Undo offered — before the later steps", () => {
    const post = save.indexOf('fetch("/api/settings/shift-types/activation"');
    const rec = save.indexOf("setCommitted({ shiftId: shift.id, version: activation.version });");
    const undo = save.indexOf("if (prev) pushActivationUndo(prev, activationUndo, shift);");
    const follow = save.indexOf('fetch("/api/settings/shift-follow-rules"');
    expect(post).toBeGreaterThan(-1);
    expect(rec).toBeGreaterThan(post);
    expect(undo).toBeGreaterThan(rec);
    expect(follow).toBeGreaterThan(undo);
    expect(save.slice(rec, undo)).toMatch(/setLastSaved\(/);
  });
  it("the activation Undo is pushed only at commit (not again at the end), and cleared state on success/cancel/open", () => {
    expect(save.match(/pushActivationUndo\(/g)).toHaveLength(1);
    expect(save).toMatch(/if \(!activation && prev\) \{\s*pushUndo\(\{\s*label: `Updated \$\{shift\.code\}`/);
    expect(save).toMatch(/setStatus\("saved"\);\s*setCommitted\(null\);/);
    expect(save).toMatch(/setCommitted\(null\);\s*setActivating\(shift\);/);
    expect(src).toMatch(/onCancel=\{\(\) => \{ setCommitted\(null\); setActivating\(null\);/);
  });
  it("the panel freezes its choices and offers Retry once the activation is saved", () => {
    expect(src).toMatch(/committed=\{committed\?\.shiftId === activating\.id\}/);
    expect(panel).toMatch(/<fieldset disabled=\{committed \|\| saving\}/);
    expect(panel).toMatch(/committed \? "Retry"/);
  });
});

// Card #80: the turn-on Undo is held while the panel covers its toast, and offered (with its full
// countdown) when the panel closes — after the save finishes, or on Cancel after a partial save.
describe("turn-on Undo is offered when the panel closes (card #80)", () => {
  const src = readFileSync(join(__dirname, "../../app/settings/settings-page.tsx"), "utf8");
  const helper = src.slice(src.indexOf("function pushActivationUndo("), src.indexOf("function offerHeldActivationUndo("));
  it("committing holds the Undo instead of showing it", () => {
    expect(helper).toMatch(/pendingActivationUndo\.current = \{/);
    expect(helper).not.toMatch(/pushUndo\(/);
    expect(src).toMatch(/function offerHeldActivationUndo\(\) \{\s*const held = pendingActivationUndo\.current;\s*pendingActivationUndo\.current = null;\s*if \(held\) pushUndo\(held\);/);
  });
  it("it is offered on a finished save and on Cancel", () => {
    expect(src).toMatch(/setStatus\("saved"\);\s*setCommitted\(null\);\s*offerHeldActivationUndo\(\);/);
    expect(src).toMatch(/onCancel=\{\(\) => \{ setCommitted\(null\); setActivating\(null\); offerHeldActivationUndo\(\); \}\}/);
  });
});
