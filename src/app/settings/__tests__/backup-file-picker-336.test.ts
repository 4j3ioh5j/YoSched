import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BackupFilePicker, KeyFilePicker, chooseFile } from "../key-file-picker";

// Card #336: the backup file for Restore was the browser's bare file input, which reads as plain
// text ("Choose File No file chosen") on the dark page. It gets the same visible button and drop
// zone as the key file.
const f = (name: string, size: number) => new File([new Uint8Array(size)], name);

describe("choosing the backup file (card #336)", () => {
  it("renders a visible button and a drop hint, and no accept filter", () => {
    const html = renderToStaticMarkup(createElement(BackupFilePicker, { file: null, onChange: () => {} }));
    expect(html).toContain("Choose backup file…");
    expect(html).toContain("or drag the backup file here");
    expect(html).toContain("data-backup-drop");
    expect(html).toContain("<button");
    expect(html).not.toContain("accept=");
  });

  it("shows the chosen file's name", () => {
    const html = renderToStaticMarkup(createElement(BackupFilePicker, { file: f("YoSched 2026-11-17.yosched-backup", 10), onChange: () => {} }));
    expect(html).toContain("YoSched 2026-11-17.yosched-backup");
    expect(html).not.toContain("or drag the backup file here");
  });

  it("a backup has no small size limit (the server caps uploads); one file only", () => {
    const big = f("big.yosched-backup", 2 * 1024 * 1024);
    expect(chooseFile([big], { what: "backup" })).toEqual({ file: big });
    expect(chooseFile([big, big], { what: "backup" })).toEqual({ error: "Choose one backup file" });
    expect(chooseFile([], { what: "backup" })).toBeNull();
  });

  it("the key picker is unchanged", () => {
    const html = renderToStaticMarkup(createElement(KeyFilePicker, { file: null, onChange: () => {} }));
    expect(html).toContain("Choose key file…");
    expect(html).toContain("or drag the key file here");
    expect(html).toContain("data-key-drop");
  });

  it("both restore pages use the picker for the backup file, not a bare file input", () => {
    for (const rel of ["../backup-panel.tsx", "../../setup/restore/page.tsx"]) {
      const src = readFileSync(path.join(__dirname, rel), "utf8");
      expect(src, rel).not.toContain('type="file"');
      expect(src, rel).toContain("<BackupFilePicker");
    }
  });
});
