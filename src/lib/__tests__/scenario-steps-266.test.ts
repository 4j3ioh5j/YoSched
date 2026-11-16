// Card #266 slice B: Live edits as steps (batches of independent runs) that the browser can send to
// Web Workers, with exactly the outcome of the plain synchronous call.
import { describe, it, expect } from "vitest";
import { trialRun, trialInput, type TrialBatch, type TrialRun } from "../auto-scheduler";
import { applyScenario, applyScenarioExpanding, applyScenarioSteps, applyScenarioExpandingSteps, runStepsSync } from "../scenario";
import { fixture } from "./engine-266-fixture";

const runAll = (b: TrialBatch): TrialRun[] => b.variants.map((v) => trialRun(trialInput(b.base, v)));

describe("Live edit steps (card #266 slice B)", { timeout: 60_000 }, () => {
  const input = fixture();
  const base = { ...input, existingAssignments: [] };
  const someFree = () => {
    const out = applyScenario(base, [], []);
    const c = out.grid.find((g) => g.code !== "X")!;
    return { grid: out.grid, free: { staffId: c.staffId, date: c.date } };
  };

  it("applyScenarioSteps driven batch by batch gives applyScenario's outcome", () => {
    const { grid, free } = someFree();
    const b2 = { ...input, existingAssignments: grid.map((g) => ({ ...g, isLocked: false, source: "auto" })) };
    const plain = applyScenario(b2, [], [free]);
    let batches = 0;
    const stepped = runStepsSync(applyScenarioSteps(b2, [], [free]), (b) => { batches++; return runAll(b); });
    expect(batches).toBeGreaterThan(0);
    expect(JSON.stringify(stepped)).toBe(JSON.stringify(plain));
  });

  it("applyScenarioExpandingSteps gives applyScenarioExpanding's outcome", () => {
    const { grid, free } = someFree();
    const b2 = { ...input, existingAssignments: grid.map((g) => ({ ...g, isLocked: false, source: "auto" })) };
    const touched = new Set([free.date]);
    const pinned = new Map<string, string>();
    const plain = applyScenarioExpanding(b2, [], [free], touched, pinned, "range");
    const stepped = runStepsSync(applyScenarioExpandingSteps(b2, [], [free], touched, pinned, "range"), runAll);
    expect(JSON.stringify(stepped)).toBe(JSON.stringify(plain));
  });
});
