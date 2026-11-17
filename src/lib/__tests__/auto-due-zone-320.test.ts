// Card #320: the backup time is a wall-clock time in the Settings time zone, not the server's.
import { describe, it, expect } from "vitest";
import { autoDue, DEFAULT_AUTO, type AutoSettings, type AutoStatus } from "../backup/auto";
import { runAutoBackup, type JobDeps } from "../backup/auto-job";

const on: AutoSettings = { ...DEFAULT_AUTO, autoEnabled: true, autoTime: "17:00", publicKey: "pk", keyId: "k1", keyCreatedAt: new Date("2026-01-01T00:00:00Z") };
const none: AutoStatus = { lastAutoSuccessAt: null, lastAutoAttemptAt: null, lastAutoError: null };
const LA = "America/Los_Angeles";
const d = (s: string) => new Date(s);

describe("autoDue in the Settings zone (server clock is UTC)", () => {
  it("17:00 LA in winter is 01:00Z", () => {
    process.env.TZ = "UTC";
    const ok: AutoStatus = { ...none, lastAutoSuccessAt: d("2026-11-16T01:00:00Z") };
    expect(autoDue(d("2026-11-17T00:59:00Z"), on, ok, LA)).toBe(false);
    expect(autoDue(d("2026-11-17T01:00:00Z"), on, ok, LA)).toBe(true);
  });
  it("17:00 LA in summer is 00:00Z", () => {
    const ok: AutoStatus = { ...none, lastAutoSuccessAt: d("2026-07-14T00:00:00Z") };
    expect(autoDue(d("2026-07-14T23:59:00Z"), on, ok, LA)).toBe(false);
    expect(autoDue(d("2026-07-15T00:00:00Z"), on, ok, LA)).toBe(true);
  });
  it("the server's own TZ no longer matters", () => {
    const ok: AutoStatus = { ...none, lastAutoSuccessAt: d("2026-11-16T01:00:00Z") };
    process.env.TZ = "Asia/Tokyo";
    expect(autoDue(d("2026-11-17T01:00:00Z"), on, ok, LA)).toBe(true);
    expect(autoDue(d("2026-11-17T00:59:00Z"), on, ok, LA)).toBe(false);
    process.env.TZ = "UTC";
  });
  it("no zone given behaves as UTC (rollout: setting not chosen yet)", () => {
    const s = { ...on, autoTime: "01:00" };
    const ok: AutoStatus = { ...none, lastAutoSuccessAt: d("2026-11-16T01:00:00Z") };
    expect(autoDue(d("2026-11-17T00:59:00Z"), s, ok)).toBe(false);
    expect(autoDue(d("2026-11-17T01:00:00Z"), s, ok)).toBe(true);
  });
});

describe("the job reads the zone with the settings, after taking the gate", () => {
  it("uses the zone from the read inside the gate", async () => {
    const calls: string[] = [];
    let inGate = false;
    const deps: JobDeps = {
      now: () => d("2026-11-17T01:00:00Z"),
      exclusive: async (fn) => { inGate = true; try { return await fn(); } finally { inGate = false; } },
      readState: async () => {
        calls.push(`read:${inGate}`);
        return { settings: on, status: { ...none, lastAutoSuccessAt: d("2026-11-16T17:30:00Z") }, zone: LA };
      },
      recordAttempt: async () => { calls.push("attempt"); },
      buildPayload: async () => ({}),
      encode: async () => Buffer.from("x"),
      write: async () => { calls.push("write"); },
      recordSuccess: async () => {},
      recordFailure: async () => {},
      list: async () => [],
      remove: async () => {},
      cleanPartials: async () => {},
      log: () => {},
    };
    expect(await runAutoBackup(deps)).toBe("ok");
    expect(calls).toEqual(["read:true", "attempt", "write"]);
    // Same moment, zone UTC: the last 17:00 UTC slot (16th 17:00Z) already has a success → not due.
    const utc = { ...deps, readState: async () => ({ settings: on, status: { ...none, lastAutoSuccessAt: d("2026-11-16T17:30:00Z") }, zone: "UTC" }) };
    expect(await runAutoBackup(utc)).toBe("not-due");
  });
});
