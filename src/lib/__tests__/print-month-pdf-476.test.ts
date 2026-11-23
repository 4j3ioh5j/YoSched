import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMonthPdf, createPdfPrinter, printThenRefocus, withPrintedVersion, type PdfPrintEnv, type PdfPrintFrame } from "../print-month-pdf";
import { runPrintFlow } from "../auto-version-flow";
import { input, NOW } from "./fixtures/export-input";

// Card #476: the Print button prints the selected month as a PDF (the year export's drawing),
// not the browser page.

const fonts = {
  regular: new Uint8Array(readFileSync(join(__dirname, "../../../public/fonts/ArchivoNarrow-Regular.ttf"))),
  bold: new Uint8Array(readFileSync(join(__dirname, "../../../public/fonts/ArchivoNarrow-Bold.ttf"))),
};
const pdfText = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

describe("buildMonthPdf (card #476)", () => {
  it("builds ONE page for the chosen month", async () => {
    const pdf = await buildMonthPdf(input(), 2026, 0, NOW, async () => fonts, { compress: false });
    const t = pdfText(pdf);
    expect(t.startsWith("%PDF")).toBe(true);
    expect(t.match(/\/Type \/Page\b/g)?.length).toBe(1);
    expect(t).toMatch(/\/Title \(January 2026 schedule\)/);
  });

  it("the page matches the year export's page for that month", async () => {
    const { exportYearPdf } = await import("../export-pdf");
    const { buildPrintedMonth } = await import("../print-month-model");
    const one = await buildMonthPdf(input(), 2026, 4, NOW, async () => fonts, { compress: false });
    const ref = await exportYearPdf([buildPrintedMonth(input(), 2026, 4, NOW)], fonts, { compress: false, title: "May 2026 schedule" });
    const strip = (b: Uint8Array) => pdfText(b).replace(/\/CreationDate \([^)]*\)/, "").replace(/\/ID \[[^\]]*\]/, "");
    expect(strip(one)).toBe(strip(ref));
  });

  it("a font load failure rejects (nothing is printed)", async () => {
    await expect(buildMonthPdf(input(), 2026, 0, NOW, async () => { throw new Error("font 404"); })).rejects.toThrow(/font 404/);
  });
});

describe("withPrintedVersion (card #476)", () => {
  it("sets the printed month's version number without touching the frozen input", () => {
    const base = input({ versions: [{ year: 2026, month: 0, versionNumber: 3 }, { year: 2026, month: 1, versionNumber: 9 }] });
    const out = withPrintedVersion(base, 2026, 0, 4);
    expect(out.versions).toEqual([{ year: 2026, month: 1, versionNumber: 9 }, { year: 2026, month: 0, versionNumber: 4 }]);
    expect(base.versions).toEqual([{ year: 2026, month: 0, versionNumber: 3 }, { year: 2026, month: 1, versionNumber: 9 }]);
  });

  it("null leaves the versions as they are", () => {
    const base = input({ versions: [{ year: 2026, month: 0, versionNumber: 3 }] });
    expect(withPrintedVersion(base, 2026, 0, null).versions).toEqual([{ year: 2026, month: 0, versionNumber: 3 }]);
  });
});

function fakeEnv(over: Partial<PdfPrintEnv> = {}) {
  const log: string[] = [];
  let n = 0;
  const frames: (PdfPrintFrame & { url: string })[] = [];
  const env: PdfPrintEnv = {
    createObjectURL: () => { const u = `blob:${++n}`; log.push(`create ${u}`); return u; },
    revokeObjectURL: (u) => log.push(`revoke ${u}`),
    loadFrame: async (url) => {
      const f = { url, print: () => log.push(`print ${url}`), remove: () => log.push(`remove ${url}`) };
      frames.push(f);
      return f;
    },
    open: (url) => { log.push(`open ${url}`); return true; },
    ...over,
  };
  return { env, log, frames };
}

describe("createPdfPrinter (card #476)", () => {
  it("loads the PDF in a hidden frame and prints it; the frame stays until the next print", async () => {
    const { env, log } = fakeEnv();
    const p = createPdfPrinter(env);
    expect(await p.print(new Uint8Array([1]))).toBe("printed");
    expect(log).toEqual(["create blob:1", "print blob:1"]);
    expect(await p.print(new Uint8Array([2]))).toBe("printed");
    expect(log).toEqual(["create blob:1", "print blob:1", "remove blob:1", "revoke blob:1", "create blob:2", "print blob:2"]);
  });

  it("dispose removes the last frame and frees its URL, once", async () => {
    const { env, log } = fakeEnv();
    const p = createPdfPrinter(env);
    await p.print(new Uint8Array([1]));
    p.dispose();
    p.dispose();
    expect(log.filter((l) => l.startsWith("remove") || l.startsWith("revoke"))).toEqual(["remove blob:1", "revoke blob:1"]);
  });

  it("a frame that cannot print falls back to opening the PDF in a new tab", async () => {
    const { env, log } = fakeEnv({
      loadFrame: async (url) => ({ print: () => { throw new Error("blocked"); }, remove: () => log.push(`remove ${url}`) }),
    });
    const p = createPdfPrinter(env);
    expect(await p.print(new Uint8Array([1]))).toBe("opened");
    expect(log).toEqual(["create blob:1", "remove blob:1", "open blob:1"]);
  });

  it("a frame that never loads (rejects) falls back too", async () => {
    const { env, log } = fakeEnv({ loadFrame: async () => { throw new Error("timeout"); } });
    expect(await createPdfPrinter(env).print(new Uint8Array([1]))).toBe("opened");
    expect(log).toEqual(["create blob:1", "open blob:1"]);
  });

  it("when the new tab is blocked too, it says failed and frees the URL", async () => {
    const { env, log } = fakeEnv({ loadFrame: async () => { throw new Error("x"); }, open: () => false });
    expect(await createPdfPrinter(env).print(new Uint8Array([1]))).toBe("failed");
    expect(log).toEqual(["create blob:1", "revoke blob:1"]);
  });

  it("an opened-tab URL is freed at the next print, not before", async () => {
    const { env, log } = fakeEnv({ loadFrame: async () => { throw new Error("x"); } });
    const p = createPdfPrinter(env);
    await p.print(new Uint8Array([1]));
    expect(log).not.toContain("revoke blob:1");
    await p.print(new Uint8Array([2]));
    expect(log).toContain("revoke blob:1");
  });
});

// Card #480: leaving the page while the PDF frame still loads must not print or open a tab later.
describe("createPdfPrinter: dispose during a load (card #480)", () => {
  function deferredLoad(log: string[]) {
    let settle!: { ok: () => void; fail: () => void };
    const loadFrame = (url: string) => new Promise<PdfPrintFrame>((res, rej) => {
      settle = {
        ok: () => res({ print: () => log.push(`print ${url}`), remove: () => log.push(`remove ${url}`) }),
        fail: () => rej(new Error("timeout")),
      };
    });
    return { loadFrame, settle: () => settle };
  }

  it("a load that finishes after dispose neither prints nor keeps the frame or URL", async () => {
    const log: string[] = [];
    const d = deferredLoad(log);
    const { env } = fakeEnv({ loadFrame: d.loadFrame });
    const origCreate = env.createObjectURL; env.createObjectURL = (b) => { const u = origCreate(b); log.push(`create ${u}`); return u; };
    env.revokeObjectURL = (u) => log.push(`revoke ${u}`);
    const p = createPdfPrinter(env);
    const pending = p.print(new Uint8Array([1]));
    p.dispose();
    d.settle().ok();
    expect(await pending).toBe("canceled");
    expect(log).not.toContain("print blob:1");
    expect(log).toContain("remove blob:1");
    expect(log).toContain("revoke blob:1");
    p.dispose();
    expect(log.filter((l) => l === "revoke blob:1").length).toBe(1);
  });

  it("a load that fails after dispose does not open a new tab, and frees the URL", async () => {
    const log: string[] = [];
    const d = deferredLoad(log);
    const { env } = fakeEnv({ loadFrame: d.loadFrame, open: (u) => { log.push(`open ${u}`); return true; } });
    env.revokeObjectURL = (u) => log.push(`revoke ${u}`);
    const p = createPdfPrinter(env);
    const pending = p.print(new Uint8Array([1]));
    p.dispose();
    d.settle().fail();
    expect(await pending).toBe("canceled");
    expect(log.some((l) => l.startsWith("open"))).toBe(false);
    expect(log).toContain("revoke blob:1");
  });

  it("a newer print supersedes one still loading: only the newer one prints", async () => {
    const log: string[] = [];
    const d1 = deferredLoad(log);
    let call = 0;
    const { env } = fakeEnv({
      loadFrame: (url) => (++call === 1 ? d1.loadFrame(url) : Promise.resolve({ print: () => log.push(`print ${url}`), remove: () => log.push(`remove ${url}`) })),
    });
    env.revokeObjectURL = (u) => log.push(`revoke ${u}`);
    const p = createPdfPrinter(env);
    const first = p.print(new Uint8Array([1]));
    expect(await p.print(new Uint8Array([2]))).toBe("printed");
    d1.settle().ok();
    expect(await first).toBe("canceled");
    expect(log).toContain("print blob:2");
    expect(log).not.toContain("print blob:1");
    expect(log).toContain("revoke blob:1");
    expect(log).not.toContain("remove blob:2");
  });
});

describe("runPrintFlow awaits an async print (card #476)", () => {
  it("returns only after the PDF print finished, with the version stamped first", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const done = runPrintFlow({
      mode: "auto",
      frozen: { year: 2026, month: 0, hash: "h" },
      currentOf: () => ({ snapshotHash: "h", versionNumber: 7 }),
      confirm: () => true,
      ensure: vi.fn(),
      showing: () => ({ year: 2026, month: 0, hash: "h", live: false }),
      adopt: () => {},
      stamp: (n) => order.push(`stamp ${n}`),
      print: async () => { order.push("print start"); await gate; order.push("print end"); },
      alert: () => {},
    });
    await Promise.resolve();
    expect(order).toEqual(["stamp 7", "print start"]);
    release();
    expect(await done).toBe("printed");
    expect(order).toEqual(["stamp 7", "print start", "print end"]);
  });
});

describe("printThenRefocus (card #476 trial)", () => {
  const rec = () => {
    const log: string[] = [];
    return {
      log,
      frame: { focus: () => log.push("frame focus"), print: () => log.push("frame print") },
      page: { focus: () => log.push("page focus") },
      button: { focus: () => log.push("button focus") },
    };
  };

  it("prints from the frame, then gives the keyboard back to the page and the focused element", () => {
    const { log, frame, page, button } = rec();
    printThenRefocus(frame, button, page);
    expect(log).toEqual(["frame focus", "frame print", "page focus", "button focus"]);
  });

  it("with nothing focused before, the page window gets it back", () => {
    const { log, frame, page } = rec();
    printThenRefocus(frame, null, page);
    expect(log).toEqual(["frame focus", "frame print", "page focus"]);
  });

  it("a print that throws still gives focus back, and the error reaches the fallback", () => {
    const { log, page, button } = rec();
    const bad = { focus: () => log.push("frame focus"), print: () => { throw new Error("blocked"); } };
    expect(() => printThenRefocus(bad, button, page)).toThrow(/blocked/);
    expect(log).toEqual(["frame focus", "page focus", "button focus"]);
  });
});
