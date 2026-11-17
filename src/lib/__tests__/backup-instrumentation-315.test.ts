import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Card #315: the scheduler starts once per server process. Next gives instrumentation and each
// route their own copy of a module (card #266 lesson), so "started" must live on globalThis.

const h = vi.hoisted(() => ({ start: vi.fn(() => true) }));
vi.mock("@/lib/backup/auto-service", () => ({ startAutoBackups: h.start }));

const env = { ...process.env };
beforeEach(() => { h.start.mockClear(); });
afterEach(() => { process.env = { ...env }; });

describe("server start (card #315)", () => {
  it("starts the scheduler only in the Node server, never during a build", async () => {
    const { register } = await import("@/instrumentation");
    process.env.NEXT_RUNTIME = "edge";
    await register();
    process.env.NEXT_RUNTIME = "nodejs"; process.env.NEXT_PHASE = "phase-production-build";
    await register();
    expect(h.start).not.toHaveBeenCalled();
    delete process.env.NEXT_PHASE;
    await register();
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  it("two separate copies of the job module start only one scheduler", async () => {
    vi.resetModules();
    const a = await import("@/lib/backup/auto-job");
    vi.resetModules();
    const b = await import("@/lib/backup/auto-job");
    expect(a).not.toBe(b); // really two copies
    const make = vi.fn();
    try {
      expect(a.startAutoBackup(make, { firstMs: 3_600_000, everyMs: 3_600_000 })).toBe(true);
      expect(b.startAutoBackup(make, { firstMs: 3_600_000, everyMs: 3_600_000 })).toBe(false);
      expect(b.schedulerState().timers).toHaveLength(2);
    } finally { a.stopAutoBackup(); }
    expect(make).not.toHaveBeenCalled();
  });

  it("a tick runs on the schedule and a second copy's tick is refused while one runs", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const a = await import("@/lib/backup/auto-job");
    vi.resetModules();
    const b = await import("@/lib/backup/auto-job");
    let release!: () => void;
    const readState = vi.fn(() => new Promise<never>((_, rej) => { release = () => rej(new Error("stop")); }));
    const deps = { readState, log: () => {} } as unknown as import("@/lib/backup/auto-job").JobDeps;
    try {
      a.startAutoBackup(() => deps, { firstMs: 1000, everyMs: 60_000 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(readState).toHaveBeenCalledTimes(1);
      expect(await b.autoTick(deps)).toBe("busy");
      release();
    } finally { a.stopAutoBackup(); vi.useRealTimers(); }
  });
});
