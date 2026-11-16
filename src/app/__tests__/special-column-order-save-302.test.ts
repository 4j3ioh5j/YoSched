import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Card #302: while a Column Order save is in flight, the list cannot be edited, so the
// save's completion (which clears the draft) never throws away a newer move.

const src = readFileSync(path.resolve(__dirname, "..", "settings", "settings-page.tsx"), "utf8");
const start = src.indexOf("function SpecialColumnOrderSection(");
const end = src.indexOf("\nfunction ", start + 10);
const section = src.slice(start, end);

describe("Column Order section locks edits while saving", () => {
  it("found the section", () => {
    expect(start).toBeGreaterThan(-1);
    expect(section.length).toBeGreaterThan(100);
  });

  it("move() refuses to change the draft while a save is in flight", () => {
    const move = section.slice(section.indexOf("function move("), section.indexOf("async function put("));
    expect(move).toMatch(/if \(saving\) return;/);
  });

  it("the up/down arrows and Cancel are disabled while saving", () => {
    expect(section).toMatch(/aria-label="Move up" disabled=\{saving \|\|/);
    expect(section).toMatch(/aria-label="Move down" disabled=\{saving \|\|/);
    expect(section).toMatch(/disabled=\{saving \|\| !dirty\} onClick=\{\(\) => setDraft\(null\)\}/);
  });
});
