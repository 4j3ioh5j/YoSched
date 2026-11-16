import { describe, it, expect, vi } from "vitest";
import { runYearExport, type ExportEnv } from "../save-export";

// Card #299: saving the two export files. Chrome/Edge: one folder picker FIRST (inside the
// click), then generate, confirm a replace, write each file and abort a failed writable.
// Elsewhere: two downloads with retry links. Never a false "saved both".

type FakeFile = { data: Uint8Array | null };

function fakeDir(existing: string[] = [], failOn: string | null = null) {
  const files = new Map<string, FakeFile>(existing.map((n) => [n, { data: new Uint8Array([9]) }]));
  const aborted: string[] = [];
  const removed: string[] = [];
  const dir = {
    async getFileHandle(name: string, opts?: { create?: boolean }) {
      if (!files.has(name)) {
        if (!opts?.create) throw Object.assign(new Error("nf"), { name: "NotFoundError" });
        files.set(name, { data: new Uint8Array() });
      }
      return {
        async createWritable() {
          let pending: Uint8Array | null = null;
          return {
            async write(b: Blob | Uint8Array) {
              if (name === failOn) throw new Error("disk full");
              pending = b instanceof Uint8Array ? b : new Uint8Array(await (b as Blob).arrayBuffer());
            },
            async close() { files.get(name)!.data = pending; },
            async abort() { aborted.push(name); },
          };
        },
      };
    },
    async removeEntry(name: string) { removed.push(name); files.delete(name); },
  };
  return { dir, files, aborted, removed };
}

const bytes = { xlsx: new Uint8Array([1, 2]), pdf: new Uint8Array([3, 4]) };

function env(over: Partial<ExportEnv> = {}): ExportEnv & { downloads: { name: string; url: string }[]; revoked: string[] } {
  const downloads: { name: string; url: string }[] = [];
  const revoked: string[] = [];
  let n = 0;
  return {
    showDirectoryPicker: undefined,
    confirm: () => true,
    createObjectURL: () => `blob:${++n}`,
    revokeObjectURL: (u: string) => { revoked.push(u); },
    startDownload: (url: string, name: string) => { downloads.push({ name, url }); },
    downloads,
    revoked,
    ...over,
  };
}

describe("runYearExport with a folder picker (card #299)", () => {
  it("opens the picker before generating, then writes both files", async () => {
    const order: string[] = [];
    const d = fakeDir();
    const e = env({ showDirectoryPicker: async () => { order.push("pick"); return d.dir as never; } });
    const r = await runYearExport("MDSCHEDULE_2026", async () => { order.push("gen"); return bytes; }, e);
    expect(order).toEqual(["pick", "gen"]);
    expect(r.kind).toBe("saved");
    expect(r.saved).toEqual(["MDSCHEDULE_2026.xlsx", "MDSCHEDULE_2026.pdf"]);
    expect(d.files.get("MDSCHEDULE_2026.xlsx")!.data).toEqual(bytes.xlsx);
    expect(d.files.get("MDSCHEDULE_2026.pdf")!.data).toEqual(bytes.pdf);
  });

  it("picker cancelled → nothing generated or written", async () => {
    const gen = vi.fn(async () => bytes);
    const e = env({ showDirectoryPicker: async () => { throw Object.assign(new Error("x"), { name: "AbortError" }); } });
    const r = await runYearExport("A", gen, e);
    expect(r.kind).toBe("cancelled");
    expect(gen).not.toHaveBeenCalled();
    expect(e.downloads).toEqual([]);
  });

  it("an existing file asks once; No → nothing generated or written", async () => {
    const d = fakeDir(["A.pdf"]);
    const confirm = vi.fn((_m: string) => false);
    const gen = vi.fn(async () => bytes);
    const r = await runYearExport("A", gen, env({ showDirectoryPicker: async () => d.dir as never, confirm }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatch(/A\.pdf/);
    expect(r.kind).toBe("cancelled");
    expect(gen).not.toHaveBeenCalled();
    expect(d.files.get("A.pdf")!.data).toEqual(new Uint8Array([9]));
    expect(d.files.has("A.xlsx")).toBe(false);
  });

  it("an existing file + Yes → both replaced", async () => {
    const d = fakeDir(["A.xlsx", "A.pdf"]);
    const confirm = vi.fn((_m: string) => true);
    const r = await runYearExport("A", async () => bytes, env({ showDirectoryPicker: async () => d.dir as never, confirm }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(r.kind).toBe("saved");
    expect(d.files.get("A.xlsx")!.data).toEqual(bytes.xlsx);
  });

  it("the PDF write fails → partial, names both, aborts the writable, removes the empty new file", async () => {
    const d = fakeDir([], "A.pdf");
    const r = await runYearExport("A", async () => bytes, env({ showDirectoryPicker: async () => d.dir as never }));
    expect(r.kind).toBe("partial");
    expect(r.saved).toEqual(["A.xlsx"]);
    expect(r.failed.map((f) => f.name)).toEqual(["A.pdf"]);
    expect(r.message).toMatch(/A\.xlsx/);
    expect(r.message).toMatch(/A\.pdf.*not saved.*disk full/);
    expect(d.aborted).toEqual(["A.pdf"]);
    expect(d.removed).toEqual(["A.pdf"]);
  });

  it("a failed replace keeps the old file (no remove)", async () => {
    const d = fakeDir(["A.pdf"], "A.pdf");
    const r = await runYearExport("A", async () => bytes, env({ showDirectoryPicker: async () => d.dir as never }));
    expect(r.kind).toBe("partial");
    expect(d.removed).toEqual([]);
    expect(d.files.get("A.pdf")!.data).toEqual(new Uint8Array([9]));
  });

  it("generation fails after the pick → failed, nothing written", async () => {
    const d = fakeDir();
    const r = await runYearExport("A", async () => { throw new Error("boom"); }, env({ showDirectoryPicker: async () => d.dir as never }));
    expect(r.kind).toBe("failed");
    expect(r.message).toMatch(/boom/);
    expect(d.files.size).toBe(0);
  });

  it("the picker refuses for another reason → failed, not cancelled", async () => {
    const r = await runYearExport("A", async () => bytes, env({ showDirectoryPicker: async () => { throw Object.assign(new Error("no access"), { name: "SecurityError" }); } }));
    expect(r.kind).toBe("failed");
  });
});

describe("runYearExport without a folder picker (card #299)", () => {
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

// Card #308: Chrome refuses Downloads, Desktop and Documents themselves ("contains system
// files"); Cancel there is an AbortError. The cancel says how to get past it, and
// "Download instead" saves both files without any folder picker.
describe("Chrome folder refusal and Download instead (card #308)", () => {
  it("a cancelled picker explains Chrome's protected folders and the download way", async () => {
    const r = await runYearExport("A", async () => bytes, env({ showDirectoryPicker: async () => { throw Object.assign(new Error("x"), { name: "AbortError" }); } }));
    expect(r.kind).toBe("cancelled");
    expect(r.message).toMatch(/Nothing was saved/);
    expect(r.message).toMatch(/Downloads, Desktop or Documents/);
    expect(r.message).toMatch(/folder inside/);
    expect(r.message).toMatch(/Download instead/);
  });

  it("download mode never opens the picker, even where one exists", async () => {
    let picked = false;
    const e = env({ showDirectoryPicker: async () => { picked = true; return fakeDir().dir as never; } });
    const r = await runYearExport("A", async () => bytes, e, { mode: "download" });
    expect(picked).toBe(false);
    expect(r.kind).toBe("downloads");
    expect(e.downloads.map((d) => d.name)).toEqual(["A.xlsx", "A.pdf"]);
    r.release();
  });

  it("the default mode still uses the picker where one exists", async () => {
    let picked = false;
    const d = fakeDir();
    const r = await runYearExport("A", async () => bytes, env({ showDirectoryPicker: async () => { picked = true; return d.dir as never; } }), {});
    expect(picked).toBe(true);
    expect(r.kind).toBe("saved");
  });
});
