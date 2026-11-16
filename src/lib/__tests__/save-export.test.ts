import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runYearExport, type ExportEnv } from "../save-export";

// Card #299: saving the two export files: two downloads with retry links, never a false
// "saved both". Card #311: the folder picker is gone. Chrome refuses Desktop, Downloads and
// Documents as folders and warns about "edit files" on any other, so Export only downloads;
// Chrome's "Ask where to save each file" setting gives the Mac save dialog for any folder.

const bytes = { xlsx: new Uint8Array([1, 2]), pdf: new Uint8Array([3, 4]) };

function env(over: Partial<ExportEnv> = {}): ExportEnv & { downloads: { name: string; url: string }[]; revoked: string[] } {
  const downloads: { name: string; url: string }[] = [];
  const revoked: string[] = [];
  let n = 0;
  return {
    createObjectURL: () => `blob:${++n}`,
    revokeObjectURL: (u: string) => { revoked.push(u); },
    startDownload: (url: string, name: string) => { downloads.push({ name, url }); },
    downloads,
    revoked,
    ...over,
  };
}

describe("runYearExport downloads (card #299)", () => {
  it("starts two downloads with the right names and returns retry links", async () => {
    const e = env();
    const r = await runYearExport("A", async () => bytes, e);
    expect(r.kind).toBe("downloads");
    expect(e.downloads.map((d) => d.name)).toEqual(["A.xlsx", "A.pdf"]);
    expect(r.message).toMatch(/Downloads started/);
    expect(r.retry.map((x) => x.name)).toEqual(["A.xlsx", "A.pdf"]);
    expect(r.retry.map((x) => x.url)).toEqual(e.downloads.map((d) => d.url));
    expect(e.revoked).toEqual([]);
    r.release();
    expect(e.revoked.sort()).toEqual(e.downloads.map((d) => d.url).sort());
    r.release(); // idempotent
    expect(e.revoked).toHaveLength(2);
  });

  it("generation fails → failed, no downloads", async () => {
    const e = env();
    const r = await runYearExport("A", async () => { throw new Error("boom"); }, e);
    expect(r.kind).toBe("failed");
    expect(e.downloads).toEqual([]);
  });
});

describe("no folder access at all (card #311)", () => {
  const src = readFileSync(path.resolve(__dirname, "../save-export.ts"), "utf8");
  it("never asks the browser for a folder or a file handle", () => {
    expect(src).not.toMatch(/showDirectoryPicker|showSaveFilePicker|getFileHandle|createWritable/);
  });
  it("a page that has a folder picker still just downloads both files", async () => {
    let picked = false;
    (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = () => { picked = true; };
    try {
      const e = env();
      const r = await runYearExport("A", async () => bytes, e);
      expect(picked).toBe(false);
      expect(r.kind).toBe("downloads");
      expect(e.downloads.map((d) => d.name)).toEqual(["A.xlsx", "A.pdf"]);
      r.release();
    } finally {
      delete (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    }
  });
});
