import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWriteGate } from "@/lib/write-gate";
import { autoTick, runAutoBackup, type JobDeps } from "@/lib/backup/auto-job";
import { DEFAULT_AUTO, type AutoSettings, type AutoStatus } from "@/lib/backup/auto";
import { BackupFileError } from "@/lib/backup/format";

// Card #315: the automatic backup job. It rereads its settings and key only after it holds the
// write gate exclusively (plan r1), and a file a restore would refuse is never published and
// never prunes the older ones.

const keyA = { publicKey: "PK-A", keyId: "aaaaaaaaaaaaaaaa", keyCreatedAt: new Date("2026-11-01T00:00:00Z"), verifiedAt: new Date("2026-11-01T00:00:00Z") };
const keyB = { publicKey: "PK-B", keyId: "bbbbbbbbbbbbbbbb", keyCreatedAt: new Date("2026-11-16T00:00:00Z"), verifiedAt: new Date("2026-11-16T00:00:00Z") };

type World = { settings: AutoSettings; status: AutoStatus; files: string[]; events: string[] };

function setup(over: Partial<JobDeps> = {}) {
  process.env.TZ = "UTC";
  const gate = createWriteGate({ drainMs: 5_000 });
  const w: World = {
    settings: { ...DEFAULT_AUTO, autoEnabled: true, autoTime: "01:00", keepDaily: 2, keepWeekly: 0, keepMonthly: 0, ...keyA },
    status: { lastAutoSuccessAt: null, lastAutoAttemptAt: null, lastAutoError: null },
    files: ["YoSched auto 2026-11-15 0100 UTC.yosched-backup", "YoSched auto 2026-11-16 0100 UTC.yosched-backup", "pre-restore-2026-11-10T00-00-00-000Z.yosched-backup"],
    events: [],
  };
  const encoded: Array<{ keyId: string; publicKey: string }> = [];
  const deps: JobDeps = {
    now: () => new Date("2026-11-17T03:00:00Z"),
    exclusive: gate.exclusive,
    readState: async () => {
      w.events.push(`read:${gate.holding() ?? "none"}`);
      return { settings: { ...w.settings }, status: { ...w.status }, zone: "UTC" };
    },
    recordAttempt: async (at) => { w.events.push("attempt"); w.status.lastAutoAttemptAt = at; },
    buildPayload: async () => { w.events.push("build"); return { format: 1, tables: {} }; },
    encode: async (_p, key) => { w.events.push(`encode:${key.keyId}`); encoded.push(key); return Buffer.from("file"); },
    write: async (name) => { w.events.push(`write:${name}`); w.files.push(name); },
    recordSuccess: async (at) => { w.events.push("success"); w.status.lastAutoSuccessAt = at; w.status.lastAutoError = null; },
    recordFailure: async (at, err) => { w.events.push(`failure:${err}`); w.status.lastAutoError = err; },
    list: async () => [...w.files],
    remove: async (names) => { w.events.push(`remove:${names.length}`); w.files = w.files.filter((f) => !names.includes(f)); },
    cleanPartials: async () => { w.events.push("clean"); },
    log: () => {},
    ...over,
  };
  return { gate, w, deps, encoded };
}

describe("automatic backup job (card #315)", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("writes a file, records the success, then prunes old automatic files only", async () => {
    const { w, deps } = setup();
    expect(await runAutoBackup(deps)).toBe("ok");
    expect(w.events).toEqual([
      "read:exclusive", "attempt", "build", "encode:aaaaaaaaaaaaaaaa", "clean",
      "write:YoSched auto 2026-11-17 0300 UTC.yosched-backup", "success", "remove:1",
    ]);
    expect(w.files).toEqual(["YoSched auto 2026-11-16 0100 UTC.yosched-backup", "pre-restore-2026-11-10T00-00-00-000Z.yosched-backup", "YoSched auto 2026-11-17 0300 UTC.yosched-backup"]);
  });

  it("does nothing when not due (a success since the slot)", async () => {
    const { w, deps } = setup();
    w.status.lastAutoSuccessAt = new Date("2026-11-17T01:00:10Z");
    expect(await runAutoBackup(deps)).toBe("not-due");
    expect(w.events).toEqual(["read:exclusive"]);
  });

  it("a file too large to restore is not written, older files are kept, and the failure is recorded", async () => {
    const { w, deps } = setup({ encode: async () => { throw new BackupFileError("This backup would be too large to restore, so it wasn't made and nothing was changed"); } });
    const before = [...w.files];
    expect(await runAutoBackup(deps)).toBe("failed");
    expect(w.files).toEqual(before);
    expect(w.status.lastAutoSuccessAt).toBeNull();
    expect(w.status.lastAutoError).toMatch(/too large to restore/);
    expect(w.events.some((e) => e.startsWith("write:") || e.startsWith("remove:") || e === "success")).toBe(false);
  });

  it("a failed write records the failure and prunes nothing", async () => {
    const { w, deps } = setup({ write: async () => { throw Object.assign(new Error("EACCES: permission denied, open '/x'"), { code: "EACCES" }); } });
    expect(await runAutoBackup(deps)).toBe("failed");
    expect(w.status.lastAutoError).toMatch(/can't be written/);
    expect(w.events.some((e) => e.startsWith("remove:"))).toBe(false);
  });

  it("a future-dated file (clock moved back) never gets the new file pruned (r1)", async () => {
    const { w, deps } = setup();
    w.files = ["YoSched auto 2027-03-01 0100 UTC.yosched-backup"];
    w.settings.keepDaily = 1;
    expect(await runAutoBackup(deps)).toBe("ok");
    expect(w.files).toContain("YoSched auto 2026-11-17 0300 UTC.yosched-backup");
  });

  it("a failed prune keeps the success and says so", async () => {
    const { w, deps } = setup({ remove: async () => { throw new Error("EBUSY"); } });
    expect(await runAutoBackup(deps)).toBe("ok");
    expect(w.status.lastAutoSuccessAt).not.toBeNull();
    expect(w.status.lastAutoError).toMatch(/older automatic backups couldn't be removed/);
  });
});

describe("rereads settings and key after taking the gate (card #315 plan r1)", () => {
  // A request holds the gate shared; the tick sees key A and queues; the admin's change lands
  // while it waits; then the request finishes and the job runs.
  async function interleave(change: (w: World) => void) {
    const t = setup();
    let finish!: () => void;
    const holding = t.gate.shared(() => new Promise<void>((r) => { finish = r; }));
    const run = autoTick(t.deps);
    await new Promise((r) => setTimeout(r, 10));
    expect(t.w.events).toEqual(["read:none"]); // the tick's cheap check, outside the gate
    change(t.w);
    finish();
    await holding;
    return { ...t, result: await run };
  }

  it("a key replaced while waiting: the file uses the new key", async () => {
    const { encoded, result } = await interleave((w) => { Object.assign(w.settings, keyB); });
    expect(result).toBe("ok");
    expect(encoded.map((k) => k.keyId)).toEqual(["bbbbbbbbbbbbbbbb"]);
  });

  it("switched off while waiting: nothing is written", async () => {
    const { w, result } = await interleave((x) => { x.settings.autoEnabled = false; });
    expect(result).toBe("not-due");
    expect(w.events.filter((e) => e.startsWith("write:") || e === "attempt")).toEqual([]);
  });

  it("a restore while waiting: the restored settings are what count", async () => {
    const { w, encoded, result } = await interleave((x) => { x.settings = { ...DEFAULT_AUTO, autoEnabled: true, autoTime: "01:00", ...keyB }; });
    expect(result).toBe("ok");
    expect(encoded[0].keyId).toBe("bbbbbbbbbbbbbbbb");
    expect(w.events.filter((e) => e.startsWith("read:"))).toEqual(["read:none", "read:exclusive"]);
  });

  it("a restore that switches automatic backups off: nothing is written", async () => {
    const { w, result } = await interleave((x) => { x.settings = { ...DEFAULT_AUTO }; });
    expect(result).toBe("not-due");
    expect(w.events.filter((e) => e.startsWith("write:"))).toEqual([]);
  });

  it("one run at a time: a second tick while one runs does nothing", async () => {
    const t = setup();
    let finish!: () => void;
    const holding = t.gate.shared(() => new Promise<void>((r) => { finish = r; }));
    const a = autoTick(t.deps);
    const b = autoTick(t.deps);
    await new Promise((r) => setTimeout(r, 10));
    finish(); await holding;
    expect(await b).toBe("busy");
    expect(await a).toBe("ok");
    expect(t.w.events.filter((e) => e.startsWith("write:"))).toHaveLength(1);
  });

  it("a tick when not due never takes the gate", async () => {
    const t = setup();
    t.w.settings.autoEnabled = false;
    const spy = vi.fn(t.deps.exclusive);
    expect(await autoTick({ ...t.deps, exclusive: spy as unknown as JobDeps["exclusive"] })).toBe("not-due");
    expect(spy).not.toHaveBeenCalled();
  });

  it("a busy gate is a failed try, recorded, and retried later", async () => {
    const t = setup({ exclusive: async () => { throw Object.assign(new Error("busy"), { name: "GateDrainTimeoutError" }); } });
    expect(await autoTick(t.deps)).toBe("failed");
    expect(t.w.status.lastAutoError).toBeNull(); // no gate, no write: logged only
  });
});
