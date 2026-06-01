import { describe, it, expect } from "vitest";
import { buildAlerts, groupAlertsByDate } from "../alerts";
import type { Warning } from "../constraints";

const w = (type: Warning["type"], message: string): Warning => ({ type, message });

describe("buildAlerts", () => {
  // The grid renders pay-period padding rows from adjacent months. Those days
  // must never produce alerts — this is the regression guard for that filter.
  it("excludes days outside the viewed month even when they have warnings", () => {
    const dates = ["2026-06-28", "2026-07-01", "2026-07-31", "2026-08-02"];
    const dayWarnings = new Map<string, Warning[]>([
      ["2026-06-28", [w("understaffed", "prev-month")]],
      ["2026-07-01", [w("understaffed", "first")]],
      ["2026-07-31", [w("understaffed", "last")]],
      ["2026-08-02", [w("understaffed", "next-month")]],
    ]);

    const alerts = buildAlerts(dates, dayWarnings, "2026-07-01", "2026-07-31");

    expect(alerts.map((a) => a.date)).toEqual(["2026-07-01", "2026-07-31"]);
    expect(alerts.map((a) => a.message)).toEqual(["first", "last"]);
  });

  it("includes both inclusive month boundaries", () => {
    const dates = ["2026-06-30", "2026-07-01", "2026-07-31", "2026-08-01"];
    const dayWarnings = new Map<string, Warning[]>([
      ["2026-06-30", [w("understaffed", "before")]],
      ["2026-07-01", [w("understaffed", "start")]],
      ["2026-07-31", [w("understaffed", "end")]],
      ["2026-08-01", [w("understaffed", "after")]],
    ]);

    const alerts = buildAlerts(dates, dayWarnings, "2026-07-01", "2026-07-31");

    expect(alerts.map((a) => a.date)).toEqual(["2026-07-01", "2026-07-31"]);
  });

  it("maps shift-count warnings to error and everything else to warn", () => {
    const dates = ["2026-07-10"];
    const dayWarnings = new Map<string, Warning[]>([
      ["2026-07-10", [w("shift-count", "too many"), w("understaffed", "too few")]],
    ]);

    const alerts = buildAlerts(dates, dayWarnings, "2026-07-01", "2026-07-31");

    expect(alerts).toEqual([
      { date: "2026-07-10", message: "too many", type: "error" },
      { date: "2026-07-10", message: "too few", type: "warn" },
    ]);
  });

  it("emits no alerts when there are no warnings", () => {
    const dates = ["2026-07-01", "2026-07-02"];
    expect(buildAlerts(dates, new Map(), "2026-07-01", "2026-07-31")).toEqual([]);
  });
});

describe("groupAlertsByDate", () => {
  it("collapses multiple alerts for a date into one block, preserving order", () => {
    const groups = groupAlertsByDate([
      { date: "2026-07-01", message: "a", type: "warn" },
      { date: "2026-07-03", message: "b", type: "error" },
      { date: "2026-07-01", message: "c", type: "error" },
    ]);

    expect(groups).toEqual([
      { date: "2026-07-01", items: [
        { message: "a", type: "warn" },
        { message: "c", type: "error" },
      ] },
      { date: "2026-07-03", items: [{ message: "b", type: "error" }] },
    ]);
  });

  it("returns an empty array for no alerts", () => {
    expect(groupAlertsByDate([])).toEqual([]);
  });
});
