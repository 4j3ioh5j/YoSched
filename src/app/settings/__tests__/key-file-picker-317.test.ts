import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { KeyFilePicker, chooseKeyFile, MAX_KEY_PICK_BYTES } from "../key-file-picker";

// Card #317: the key file chooser did not open; a button + drop zone replace the bare input.
const f = (name: string, size: number) => new File([new Uint8Array(size)], name);

describe("choosing a key file (card #317)", () => {
  it("takes one file, refuses several or an oversized one, ignores an empty pick", () => {
    const one = f("YoSched key 2026-11-17 abc.yosched-key", 251);
    expect(chooseKeyFile([one])).toEqual({ file: one });
    expect(chooseKeyFile([one, one])).toEqual({ error: "Choose one key file" });
    expect(chooseKeyFile([f("big.bin", MAX_KEY_PICK_BYTES + 1)])).toMatchObject({ error: expect.stringMatching(/too big/) });
    expect(chooseKeyFile([])).toBeNull();
    expect(chooseKeyFile(null)).toBeNull();
  });

  it("a renamed file (Finder or a browser adding .txt) is still accepted; the server checks it", () => {
    const renamed = f("YoSched key 2026-11-17 abc.yosched-key.txt", 251);
    expect(chooseKeyFile([renamed])).toEqual({ file: renamed });
  });

  it("renders a visible button and a drop hint, and no accept filter", () => {
    const html = renderToStaticMarkup(createElement(KeyFilePicker, { file: null, onChange: () => {} }));
    expect(html).toContain("Choose key file…");
    expect(html).toContain("or drag the key file here");
    expect(html).toContain("data-key-drop");
    expect(html).not.toContain("accept=");
  });

  it("every key-file input uses the picker, not a bare file input with a filter", () => {
    for (const rel of ["../auto-backup-section.tsx", "../backup-panel.tsx", "../../setup/restore/page.tsx"]) {
      const src = readFileSync(path.join(__dirname, rel), "utf8");
      expect(src, rel).not.toContain('accept=".yosched-key"');
      expect(src, rel).toContain("<KeyFilePicker");
    }
  });
});
