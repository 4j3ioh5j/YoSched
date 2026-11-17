// Card #316: when busy saves keep the automatic backup from taking the write gate, the try is
// recorded like any failure: it shows in Settings (lastAutoError) and waits the usual hour
// (lastAutoAttemptAt). Other check failures (database down) stay log-only.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createWriteGate, GateBusyError, GateDrainTimeoutError } from "@/lib/write-gate";
import { autoTick, stopAutoBackup, BUSY_REASON, type JobDeps } from "@/lib/backup/auto-job";
import { DEFAULT_AUTO, autoDue, autoHealth, type AutoStatus } from "@/lib/backup/auto";

const NOW = new Date("2026-11-17T03:00:00Z");
const settings = { ...DEFAULT_AUTO, autoEnabled: true, autoTime: "01:00", publicKey: "PK", keyId: "aaaaaaaaaaaaaaaa", keyCreatedAt: NOW, verifiedAt: NOW };

function setup(over: Partial<JobDeps> = {}) {
  process.env.TZ = "UTC";
  stopAutoBackup();
  const status: AutoStatus = { lastAutoSuccessAt: null, lastAutoAttemptAt: null, lastAutoError: null };
  const events: string[] = [];
  const logs: string[] = [];
  const deps: JobDeps = {
    now: () => NOW,
    exclusive: async () => { throw new GateDrainTimeoutError(); },
    readState: async () => ({ settings: { ...settings }, status: { ...status }, zone: "UTC" }),
    recordAttempt: async () => { events.push("attempt"); },
    buildPayload: async () => ({}),
    encode: async () => Buffer.from("x"),
    write: async () => {},
    recordSuccess: async () => {},
    recordFailure: async () => { events.push("failure"); },
    recordBusy: async (at, why) => { events.push(`busy:${why}`); status.lastAutoAttemptAt = at; status.lastAutoError = why; },
    list: async () => [],
    remove: async () => {},
    cleanPartials: async () => {},
    log: (m) => logs.push(m),
    ...over,
  };
  return { deps, status, events, logs };
}

describe("a backup try blocked by busy saves (card #316)", () => {
  it("is recorded: shown in Settings and the next try waits the usual hour", async () => {
    const { deps, status, events } = setup();
    expect(await autoTick(deps)).toBe("failed");
    expect(events).toEqual([`busy:${BUSY_REASON}`]);
    expect(autoHealth(NOW, settings, status)).toContain(BUSY_REASON);
    expect(autoDue(new Date(NOW.getTime() + 10 * 60_000), settings, status, "UTC")).toBe(false);
    expect(autoDue(new Date(NOW.getTime() + 61 * 60_000), settings, status, "UTC")).toBe(true);
  });

  it("also when the gate refuses outright (a backup or restore holds it)", async () => {
    const { deps, events } = setup({ exclusive: async () => { throw new GateBusyError(); } });
    await autoTick(deps);
    expect(events).toEqual([`busy:${BUSY_REASON}`]);
  });

  it("with the real gate: a save that never finishes blocks the backup, and the try is recorded", async () => {
    const gate = createWriteGate({ drainMs: 50, sharedWaitMs: 50 });
    let release!: () => void;
    const save = gate.shared(() => new Promise<void>((r) => { release = r; }));
    const { deps, events } = setup({ exclusive: gate.exclusive });
    expect(await autoTick(deps)).toBe("failed");
    expect(events).toEqual([`busy:${BUSY_REASON}`]);
    release(); await save;
  });

  it("other check failures (database down) are not recorded as busy", async () => {
    const { deps, events, logs } = setup({ readState: async () => { throw new Error("connect ECONNREFUSED"); } });
    expect(await autoTick(deps)).toBe("failed");
    expect(events).toEqual([]);
    expect(logs.join("\n")).toMatch(/check failed/);
  });

  it("a failure to record the busy try is logged, never thrown", async () => {
    const { deps, logs } = setup({ recordBusy: async () => { throw new GateBusyError(); } });
    expect(await autoTick(deps)).toBe("failed");
    expect(logs.join("\n")).toMatch(/busy/);
  });

  it("the real recorder writes under the shared gate (status writes need its token)", () => {
    const src = readFileSync(path.join(__dirname, "../backup/auto-service.ts"), "utf8");
    expect(src).toMatch(/recordBusy: \(at, why\) => writeGate\.shared\(\(\) => setStatus\(\{ lastAutoAttemptAt: at, lastAutoError: why/);
  });
});
