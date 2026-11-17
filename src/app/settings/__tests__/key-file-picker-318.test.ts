import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resetAfterPick } from "../key-file-picker";

// Card #318: choose A, drop B, choose A again → the browser fires no change (the hidden input
// still holds A), so B stays. The hidden input must be emptied after every pick and every drop.
const f = (name: string) => new File([new Uint8Array(4)], name);

describe("key file picker forgets the last pick (card #318)", () => {
  it("hands over the files, then empties the hidden input", () => {
    const a = f("a.yosched-key");
    const el = { files: [a] as unknown as FileList, value: "C:\\fakepath\\a.yosched-key" };
    const seen: Array<ArrayLike<File> | null | undefined> = [];
    resetAfterPick(el, el.files, (files) => seen.push(Array.from(files ?? [])));
    expect(seen).toEqual([[a]]);
    expect(el.value).toBe("");
  });

  it("a drop also empties the hidden input, so choosing the earlier file again fires", () => {
    const b = f("b.yosched-key");
    const el = { files: null, value: "C:\\fakepath\\a.yosched-key" };
    const seen: unknown[] = [];
    resetAfterPick(el, [b], (files) => seen.push(files));
    expect(seen).toEqual([[b]]);
    expect(el.value).toBe("");
  });

  it("no input mounted is fine", () => {
    const seen: unknown[] = [];
    resetAfterPick(null, [f("c")], (files) => seen.push(files));
    expect(seen).toHaveLength(1);
  });

  it("the picker routes both the input change and the drop through resetAfterPick", () => {
    const src = readFileSync(path.join(__dirname, "../key-file-picker.tsx"), "utf8");
    expect(src).toMatch(/onDrop=\{[^}]*resetAfterPick\(input\.current/);
    expect(src).toMatch(/onChange=\{\(e\) => resetAfterPick\(e\.currentTarget/);
  });
});
