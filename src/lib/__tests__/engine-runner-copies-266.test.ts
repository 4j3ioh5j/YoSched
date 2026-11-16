// Card #266 r1 (#1301 CRITICAL): Next's production build gives src/instrumentation.ts and each API
// route their own copy of auto-scheduler.ts, so a runner kept in a module-local variable was never
// seen by POST /api/auto-schedule. The runner lives on globalThis: installed in one copy, every
// copy uses it. Two separate esbuild bundles stand in for Next's two copies.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";
import { setTrialBatchRunner, trialRun, trialInput, type TrialBatch } from "../auto-scheduler";
import { fixture } from "./engine-266-fixture";

type Copy = typeof import("../auto-scheduler");
let dir = "";
let a: Copy, b: Copy;
const load = (name: string): Copy => {
  const entry = path.join(dir, `${name}.ts`);
  fs.writeFileSync(entry, `export * from ${JSON.stringify(path.resolve(__dirname, "../auto-scheduler"))};\n`);
  const out = path.join(dir, `${name}.cjs`);
  buildSync({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", outfile: out, logLevel: "silent" });
  return createRequire(__filename)(out) as Copy;
};
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-copies-266-"));
  a = load("a");
  b = load("b");
});
afterAll(() => { a?.setTrialBatchRunner(null); setTrialBatchRunner(null); fs.rmSync(dir, { recursive: true, force: true }); });

describe("the trial batch runner is shared by every copy of the module (card #266 r1)", { timeout: 120_000 }, () => {
  it("the two bundles really are separate copies", () => {
    expect(a.autoSchedule).not.toBe(b.autoSchedule);
  });

  it("a runner installed in one copy is called by another copy's autoSchedule and scenario runs", () => {
    let calls = 0;
    a.setTrialBatchRunner((batch: TrialBatch) => { calls++; return batch.variants.map((v) => trialRun(trialInput(batch.base, v))); });
    try {
      const stats = { pooled: 0, inline: 0 };
      b.autoSchedule(fixture(), { trialStats: stats });
      expect(calls).toBeGreaterThan(0);
      expect(stats.pooled).toBe(calls);
      // The step drivers' batch function (server Live edits) uses it too.
      const before = calls;
      const run = b.trialBatchRunFor();
      run({ base: fixture(6), variants: [null, null] });
      expect(calls).toBe(before + 1);
      // And this file's own copy (vitest's) sees it.
      expect(setTrialBatchRunner(null)).toBeTypeOf("function");
      expect(b.setTrialBatchRunner(null)).toBeNull();
    } finally { a.setTrialBatchRunner(null); }
  });

  it("each run passes when it started, so the runner can hold an overall deadline", () => {
    const seen: number[] = [];
    a.setTrialBatchRunner((_batch: TrialBatch, ctx: { startedAt: number }) => { seen.push(ctx.startedAt); return null; });
    try {
      const t = performance.now();
      b.autoSchedule(fixture());
      expect(seen.length).toBeGreaterThan(1);
      expect(new Set(seen).size).toBe(1);
      expect(seen[0]).toBeGreaterThanOrEqual(t);
    } finally { a.setTrialBatchRunner(null); }
  });
});
