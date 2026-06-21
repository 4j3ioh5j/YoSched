import { describe, it, expect } from "vitest";
import {
  buildAlerts,
  buildPPHoursAlerts,
  buildRequestAlerts,
  buildAlertSections,
  groupAlertsByDate,
  parseAlertKey,
  ALERT_CATEGORIES,
  MAX_ALERT_KEY_LENGTH,
  type Alert,
  type PPHoursEntry,
} from "../alerts";
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
    expect(alerts.every((a) => a.category === "staffing")).toBe(true);
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
      { category: "staffing", key: "staffing|2026-07-10|too many", date: "2026-07-10", message: "too many", type: "error" },
      { category: "staffing", key: "staffing|2026-07-10|too few", date: "2026-07-10", message: "too few", type: "warn" },
    ]);
  });

  it("emits no alerts when there are no warnings", () => {
    const dates = ["2026-07-01", "2026-07-02"];
    expect(buildAlerts(dates, new Map(), "2026-07-01", "2026-07-31")).toEqual([]);
  });
});

describe("buildPPHoursAlerts", () => {
  const entry = (over: PPHoursEntry): PPHoursEntry => over;

  it("anchors a PP-hours alert to the pay-period end date and keys it by value", () => {
    const entries: PPHoursEntry[] = [
      entry({
        staffId: "s1",
        ppStartDate: "2026-07-01",
        anchorDate: "2026-07-14",
        hours: 76,
        target: 80,
        warning: w("under-hours", "AB: 76/80hrs this pay period (-4)"),
      }),
    ];

    const alerts = buildPPHoursAlerts(entries, "2026-07-01", "2026-07-31");

    expect(alerts).toEqual([
      {
        category: "pp-hours",
        key: "pp|s1|2026-07-01|76|80",
        date: "2026-07-14",
        message: "AB: 76/80hrs this pay period (-4)",
        type: "warn",
      },
    ]);
  });

  // A pay period straddling June→July must surface its alert exactly once, in
  // the month that contains its END date — never disappear, never double up.
  it("surfaces a cross-month PP in the month containing its end date, not the start month", () => {
    const crossing: PPHoursEntry = {
      staffId: "s1",
      ppStartDate: "2026-06-29", // starts in June
      anchorDate: "2026-07-12", // ends in July
      hours: 90,
      target: 80,
      warning: w("over-hours", "AB: 90/80hrs this pay period (+10)"),
    };

    // Viewing June: the July-ending PP is NOT shown.
    expect(buildPPHoursAlerts([crossing], "2026-06-01", "2026-06-30")).toEqual([]);

    // Viewing July: it shows.
    const july = buildPPHoursAlerts([crossing], "2026-07-01", "2026-07-31");
    expect(july).toHaveLength(1);
    expect(july[0].key).toBe("pp|s1|2026-06-29|90|80");
  });

  it("rounds fractional hours/target into the key deterministically", () => {
    const alerts = buildPPHoursAlerts(
      [{
        staffId: "s2",
        ppStartDate: "2026-07-01",
        anchorDate: "2026-07-14",
        hours: 38.0001, // sub-precision noise collapses
        target: 37.5,
        warning: w("over-hours", "x"),
      }],
      "2026-07-01",
      "2026-07-31",
    );
    expect(alerts[0].key).toBe("pp|s2|2026-07-01|38|37.5");
  });
});

describe("buildAlertSections", () => {
  it("orders pending requests, then pay-period hours, then daily staffing and preserves each list", () => {
    const staffing: Alert[] = [
      { category: "staffing", key: "staffing|2026-07-10|x", date: "2026-07-10", message: "x", type: "warn" },
    ];
    const pp: Alert[] = [
      { category: "pp-hours", key: "pp|s1|2026-07-01|76|80", date: "2026-07-14", message: "y", type: "warn" },
    ];
    const requests: Alert[] = [
      { category: "requests", key: "request|r1", date: "2026-07-04", message: "z", type: "warn" },
    ];
    const sections = buildAlertSections(staffing, pp, requests);
    expect(sections.map((s) => s.category)).toEqual(["requests", "pp-hours", "staffing"]);
    expect(sections[0].alerts).toBe(requests);
    expect(sections[1].alerts).toBe(pp);
    expect(sections[2].alerts).toBe(staffing);
  });

  it("defaults the requests section to empty when omitted", () => {
    const sections = buildAlertSections([], []);
    expect(sections.map((s) => s.category)).toEqual(["requests", "pp-hours", "staffing"]);
    expect(sections[0].alerts).toEqual([]);
  });

  it("orders sections by the canonical ALERT_CATEGORIES list (single source)", () => {
    const sections = buildAlertSections([], [], []);
    expect(sections.map((s) => s.category)).toEqual(ALERT_CATEGORIES);
  });
});

describe("buildRequestAlerts", () => {
  const entry = (id: string, startDate: string, endDate: string, message = "m") => ({ id, startDate, endDate, message });

  it("emits a warn alert keyed by request id, anchored to the start date", () => {
    const alerts = buildRequestAlerts([entry("r1", "2026-07-04", "2026-07-04", "JD: Off (Jul 4)")], "2026-07-01", "2026-07-31");
    expect(alerts).toEqual([
      { category: "requests", key: "request|r1", date: "2026-07-04", message: "JD: Off (Jul 4)", type: "warn" },
    ]);
  });

  it("clamps the anchor to the first of the month when the request started earlier", () => {
    const alerts = buildRequestAlerts([entry("r2", "2026-06-28", "2026-07-03")], "2026-07-01", "2026-07-31");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].date).toBe("2026-07-01");
  });

  it("excludes requests whose range does not overlap the viewed month", () => {
    const before = entry("r3", "2026-06-01", "2026-06-30");
    const after = entry("r4", "2026-08-01", "2026-08-05");
    expect(buildRequestAlerts([before, after], "2026-07-01", "2026-07-31")).toEqual([]);
  });
});

describe("groupAlertsByDate", () => {
  it("collapses multiple alerts for a date into one block, preserving order and keys", () => {
    const groups = groupAlertsByDate([
      { category: "staffing", key: "k1", date: "2026-07-01", message: "a", type: "warn" },
      { category: "staffing", key: "k2", date: "2026-07-03", message: "b", type: "error" },
      { category: "staffing", key: "k3", date: "2026-07-01", message: "c", type: "error" },
    ]);

    expect(groups).toEqual([
      { date: "2026-07-01", items: [
        { key: "k1", message: "a", type: "warn" },
        { key: "k3", message: "c", type: "error" },
      ] },
      { date: "2026-07-03", items: [{ key: "k2", message: "b", type: "error" }] },
    ]);
  });

  it("returns an empty array for no alerts", () => {
    expect(groupAlertsByDate([])).toEqual([]);
  });
});

describe("parseAlertKey", () => {
  it("accepts and trims a normal key", () => {
    expect(parseAlertKey("  pp|s1|2026-07-01|76|80  ")).toBe("pp|s1|2026-07-01|76|80");
  });

  it("rejects non-strings, empty, and whitespace-only", () => {
    expect(parseAlertKey(undefined)).toBeNull();
    expect(parseAlertKey(null)).toBeNull();
    expect(parseAlertKey(123)).toBeNull();
    expect(parseAlertKey({})).toBeNull();
    expect(parseAlertKey("")).toBeNull();
    expect(parseAlertKey("   ")).toBeNull();
  });

  it("rejects keys over the max length", () => {
    expect(parseAlertKey("a".repeat(MAX_ALERT_KEY_LENGTH))).not.toBeNull();
    expect(parseAlertKey("a".repeat(MAX_ALERT_KEY_LENGTH + 1))).toBeNull();
  });
});
