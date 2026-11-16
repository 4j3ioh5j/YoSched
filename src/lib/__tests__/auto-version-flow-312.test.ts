import { describe, it, expect, vi } from "vitest";
import { runPrintFlow, prepareYearExport, exclusive, postEnsure, STALE_MESSAGE, MOVED_MESSAGE, type EnsureOutcome, type VersionMeta, type PrintFlowEnv } from "@/lib/auto-version-flow";
import type { EnsureMonth } from "@/lib/auto-version";

// Card #312 (Codex plan BLOCKED): the wait for the server must not let other cells print
// or export under the returned number. Deferred responses simulate navigating / editing
// while the version is being saved.

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
const meta = (year: number, month: number, versionNumber: number, snapshotHash: string): VersionMeta => ({ year, month, versionNumber, comment: "Auto", snapshotHash, savedAt: "2026-11-16T00:00:00Z" });

function printEnv(over: Partial<PrintFlowEnv> = {}) {
  const current = new Map<string, { snapshotHash: string; versionNumber: number }>();
  const screen = { year: 2027, month: 0, hash: "J1", live: false };
  const calls: string[] = [];
  const pending = deferred<EnsureOutcome>();
  const env: PrintFlowEnv = {
    mode: "auto",
    frozen: { year: 2027, month: 0, hash: "J1" },
    currentOf: (y, m) => current.get(`${y}-${m}`) ?? null,
    confirm: vi.fn(() => true),
    ensure: vi.fn(async (ms: EnsureMonth[]) => { calls.push(`ensure:${ms.map((m) => `${m.year}-${m.month}:${m.expectedHash}`).join(",")}`); return pending.promise; }),
    showing: () => ({ ...screen }),
    adopt: (vs) => { for (const v of vs) current.set(`${v.year}-${v.month}`, v); calls.push("adopt"); },
    stamp: (n) => calls.push(`stamp:${n}`),
    print: () => calls.push("print"),
    alert: (t) => calls.push(`alert:${t}`),
    ...over,
  };
  return { env, current, screen, calls, pending };
}

describe("runPrintFlow (card #312)", () => {
  it("no version yet: saves one for the frozen cells, then stamps that number and prints", async () => {
    const t = printEnv();
    const run = runPrintFlow(t.env);
    t.pending.resolve({ ok: true, versions: [meta(2027, 0, 1, "J1")] });
    expect(await run).toBe("printed");
    expect(t.calls).toEqual(["ensure:2027-0:J1", "adopt", "stamp:1", "print"]);
  });

  it("unchanged month: no server call, prints its current number", async () => {
    const t = printEnv();
    t.current.set("2027-0", { snapshotHash: "J1", versionNumber: 4 });
    expect(await runPrintFlow(t.env)).toBe("printed");
    expect(t.calls).toEqual(["stamp:4", "print"]);
  });

  it("switching to another month during the wait prints nothing", async () => {
    const t = printEnv();
    const run = runPrintFlow(t.env);
    Object.assign(t.screen, { month: 1, hash: "F1" }); // February now on screen
    t.pending.resolve({ ok: true, versions: [meta(2027, 0, 1, "J1")] });
    expect(await run).toBe("moved");
    expect(t.calls).not.toContain("print");
    expect(t.calls.filter((c) => c.startsWith("stamp"))).toEqual([]);
    expect(t.calls).toContain(`alert:${MOVED_MESSAGE}`);
  });

  it("an edit during the wait prints nothing", async () => {
    const t = printEnv();
    const run = runPrintFlow(t.env);
    t.screen.hash = "J2";
    t.pending.resolve({ ok: true, versions: [meta(2027, 0, 1, "J1")] });
    expect(await run).toBe("moved");
    expect(t.calls).not.toContain("print");
  });

  it("the server refusing (cells differ there) prints nothing and says why", async () => {
    const t = printEnv();
    const run = runPrintFlow(t.env);
    t.pending.resolve({ ok: false, message: STALE_MESSAGE });
    expect(await run).toBe("failed");
    expect(t.calls).toEqual(["ensure:2027-0:J1", `alert:${STALE_MESSAGE}`]);
  });

  it("Ask first: Cancel prints nothing and saves nothing", async () => {
    const t = printEnv({ mode: "ask", confirm: vi.fn(() => false) });
    expect(await runPrintFlow(t.env)).toBe("cancelled");
    expect(t.calls).toEqual([]);
  });

  it("Ask first: the question does not promise a version number", async () => {
    const confirm = vi.fn((_text: string) => false);
    await runPrintFlow(printEnv({ mode: "ask", confirm }).env);
    expect(confirm.mock.calls[0][0]).not.toMatch(/Version \d/);
  });

  it("leaving the Schedule page during the wait prints nothing, silently (Codex r1)", async () => {
    let mounted = true;
    const t = printEnv({ showing: () => (mounted ? { year: 2027, month: 0, hash: "J1", live: false } : null) });
    const run = runPrintFlow(t.env);
    mounted = false; // navigated to Settings
    t.pending.resolve({ ok: true, versions: [meta(2027, 0, 1, "J1")] });
    expect(await run).toBe("gone");
    expect(t.calls).not.toContain("print");
    expect(t.calls.filter((c) => c.startsWith("stamp") || c.startsWith("alert"))).toEqual([]);
  });

  it("entering Live during the wait prints nothing (Codex r1)", async () => {
    const t = printEnv();
    const run = runPrintFlow(t.env);
    t.screen.live = true; // Live sandbox: other cells on screen, saved hash unchanged
    t.pending.resolve({ ok: true, versions: [meta(2027, 0, 1, "J1")] });
    expect(await run).toBe("moved");
    expect(t.calls).not.toContain("print");
    expect(t.calls.filter((c) => c.startsWith("stamp"))).toEqual([]);
  });

  it("Live already on with nothing to save still refuses to print the saved number", async () => {
    const t = printEnv();
    t.current.set("2027-0", { snapshotHash: "J1", versionNumber: 4 });
    t.screen.live = true;
    expect(await runPrintFlow(t.env)).toBe("moved");
    expect(t.calls).not.toContain("print");
  });

  it("a server answer for different cells than the frozen ones never stamps", async () => {
    const t = printEnv();
    const run = runPrintFlow(t.env);
    t.pending.resolve({ ok: true, versions: [meta(2027, 0, 1, "OTHER")] });
    expect(await run).toBe("moved");
    expect(t.calls).not.toContain("print");
  });
});

describe("exclusive (card #312)", () => {
  it("a second Print while the first waits is ignored", async () => {
    const d = deferred<string>();
    const fn = vi.fn(() => d.promise);
    const once = exclusive(fn);
    const a = once();
    expect(await once()).toBeNull();
    d.resolve("printed");
    expect(await a).toBe("printed");
    expect(fn).toHaveBeenCalledTimes(1);
    const d2 = Promise.resolve("again");
    fn.mockReturnValueOnce(d2);
    expect(await once()).toBe("again");
  });
});

describe("prepareYearExport (card #312)", () => {
  type In = { assignments: string[]; versions: { year: number; month: number; versionNumber: number }[] };
  const months = Array.from({ length: 12 }, (_, m) => ({ year: 2027, month: m, hash: `H${m}` }));
  const base = (): In => ({ assignments: ["frozen"], versions: [{ year: 2027, month: 1, versionNumber: 3 }] });

  it("versions every month that changed or has none, and applies the numbers to the frozen input only", async () => {
    const input = base();
    const pending = deferred<EnsureOutcome>();
    const ensure = vi.fn(async () => pending.promise);
    const run = prepareYearExport({ mode: "auto", input, months, currentOf: (_y, m) => (m === 1 ? { snapshotHash: "H1" } : null), confirm: () => true, ensure });
    input.assignments.push("edited during the wait"); // the grid's later state is not this object
    pending.resolve({ ok: true, versions: months.filter((m) => m.month !== 1).map((m) => meta(2027, m.month, 1, m.hash)) });
    const out = await run;
    expect(ensure).toHaveBeenCalledWith(months.filter((m) => m.month !== 1).map((m) => ({ year: 2027, month: m.month, expectedHash: m.hash })));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.input.versions).toHaveLength(12);
    expect(out.input.versions.find((v) => v.month === 1)!.versionNumber).toBe(3);
    expect(out.input.versions.find((v) => v.month === 0)!.versionNumber).toBe(1);
  });

  it("nothing changed: no server call, the input as frozen", async () => {
    const input = base();
    const ensure = vi.fn();
    const out = await prepareYearExport({ mode: "auto", input, months, currentOf: (_y, m) => ({ snapshotHash: `H${m}` }), confirm: () => true, ensure });
    expect(ensure).not.toHaveBeenCalled();
    expect(out).toEqual({ ok: true, input });
  });

  it("a refusal exports nothing and carries the reason", async () => {
    const out = await prepareYearExport({ mode: "auto", input: base(), months, currentOf: () => null, confirm: () => true, ensure: async () => ({ ok: false, message: STALE_MESSAGE }) });
    expect(out).toEqual({ ok: false, message: STALE_MESSAGE });
  });

  it("Ask first: Cancel exports nothing, silently", async () => {
    const ensure = vi.fn();
    const out = await prepareYearExport({ mode: "ask", input: base(), months, currentOf: () => null, confirm: () => false, ensure });
    expect(out).toEqual({ ok: false, message: null });
    expect(ensure).not.toHaveBeenCalled();
  });
});

describe("postEnsure (card #312)", () => {
  const res = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body }) as unknown as Response;
  const months = [{ year: 2027, month: 0, expectedHash: "J1" }];

  it("sends kind, comment and months; maps the versions", async () => {
    const f = vi.fn(async () => res(200, { versions: [{ year: 2027, month: 0, versionNumber: 2, comment: "c", snapshotHash: "J1", createdAt: "t" }], created: [] }));
    const out = await postEnsure(f as unknown as typeof fetch, "/x", "print", "c", months);
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ kind: "print", comment: "c", months });
    expect(out).toEqual({ ok: true, versions: [{ year: 2027, month: 0, versionNumber: 2, comment: "c", snapshotHash: "J1", savedAt: "t" }] });
  });

  it("stale 409 → the reload message; busy 409 → the server's sentence; network error → a message", async () => {
    expect(await postEnsure((async () => res(409, { reason: "stale", error: "x" })) as unknown as typeof fetch, "/x", "print", "c", months)).toEqual({ ok: false, message: STALE_MESSAGE });
    expect(await postEnsure((async () => res(409, { reason: "busy", error: "Another edit on that day is still saving — try again" })) as unknown as typeof fetch, "/x", "print", "c", months)).toEqual({ ok: false, message: "Another edit on that day is still saving — try again" });
    const net = await postEnsure((async () => { throw new Error("down"); }) as unknown as typeof fetch, "/x", "print", "c", months);
    expect(net.ok).toBe(false);
    expect(net.ok ? "" : net.message).toMatch(/Could not reach the server/);
  });
});
