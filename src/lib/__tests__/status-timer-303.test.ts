import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createStatusTimer } from "../status-timer";

// Card #303 (code-review WARNING on card #301): a first save's "Saved → idle" timer must
// never fire during a second save. If it did, it would unlock the inputs mid-save, and the
// second save's result would then overwrite whatever was typed.

afterEach(() => vi.useRealTimers());

describe("createStatusTimer", () => {
  it("fires once after the delay", () => {
    vi.useFakeTimers();
    const idle = vi.fn();
    const t = createStatusTimer(idle, 2000);
    t.arm();
    vi.advanceTimersByTime(1999);
    expect(idle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(idle).toHaveBeenCalledTimes(1);
  });

  it("a new save (cancel) stops the old timer from firing", () => {
    vi.useFakeTimers();
    const idle = vi.fn();
    const t = createStatusTimer(idle, 2000);
    t.arm(); // first save done
    vi.advanceTimersByTime(1000);
    t.cancel(); // second save starts
    vi.advanceTimersByTime(5000);
    expect(idle).not.toHaveBeenCalled();
  });

  it("re-arming replaces the old timer (only one idle, timed from the last save)", () => {
    vi.useFakeTimers();
    const idle = vi.fn();
    const t = createStatusTimer(idle, 2000);
    t.arm();
    vi.advanceTimersByTime(1500);
    t.arm();
    vi.advanceTimersByTime(1500);
    expect(idle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(idle).toHaveBeenCalledTimes(1);
  });
});

describe("useSavedDraft uses it", () => {
  const ui = readFileSync(path.resolve(__dirname, "../../app/settings/settings-page.tsx"), "utf8");
  const i = ui.search(/function useSavedDraft[(<]/);
  const hook = ui.slice(i, ui.indexOf("\nfunction ", i + 10));

  it("cancels the idle timer when a save starts, arms it only after success, and on unmount", () => {
    expect(hook).toContain("createStatusTimer(");
    const start = hook.indexOf('setStatus("saving")');
    expect(hook.lastIndexOf("statusTimer.cancel()", start)).toBeGreaterThan(-1);
    expect(hook.indexOf("statusTimer.arm()")).toBeGreaterThan(hook.indexOf("if (!res.ok)"));
    expect(hook).not.toMatch(/setTimeout\(\(\) => setStatus\("idle"\)/);
    expect(hook).toMatch(/useEffect\(\(\) => \(\) => statusTimer\.cancel\(\), \[statusTimer\]\)/);
  });
});
