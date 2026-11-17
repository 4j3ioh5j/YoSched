import { describe, it, expect, afterAll } from "vitest";
import {
  autoDue, autoHealth, planPrune, planSafetyPrune, autoFileName, parseAutoSettings, RETRY_MS,
  type AutoSettings, type AutoStatus,
} from "@/lib/backup/auto";
import { zonedSlot } from "@/lib/time-zone";
const LA = "America/Los_Angeles";

// Card #315: when an automatic backup is due, when the amber note shows, and which files the
// keep rule removes. All pure.
const savedTz = process.env.TZ;
afterAll(() => { process.env.TZ = savedTz; });

const on: AutoSettings = {
  autoEnabled: true, autoTime: "02:00", keepDaily: 7, keepWeekly: 4, keepMonthly: 12, keepSafety: 10,
  publicKey: "pk", keyId: "0123456789abcdef", keyCreatedAt: new Date("2026-11-01T00:00:00Z"), verifiedAt: new Date("2026-11-01T00:00:00Z"),
};
const none: AutoStatus = { lastAutoSuccessAt: null, lastAutoAttemptAt: null, lastAutoError: null };
const d = (s: string) => new Date(s);

describe("the last scheduled time (Settings time zone, card #320)", () => {
  it("is today's time once it has passed, else yesterday's", () => {
    process.env.TZ = "UTC";
    expect(zonedSlot(d("2026-11-17T03:00:00Z"), "02:00", "UTC").toISOString()).toBe("2026-11-17T02:00:00.000Z");
    expect(zonedSlot(d("2026-11-17T01:59:00Z"), "02:00", "UTC").toISOString()).toBe("2026-11-16T02:00:00.000Z");
    expect(zonedSlot(d("2026-11-17T02:00:00Z"), "02:00", "UTC").toISOString()).toBe("2026-11-17T02:00:00.000Z");
  });

  it("follows daylight saving time in the Settings zone", () => {
    process.env.TZ = "America/Los_Angeles";
    // Summer (UTC-7) and winter (UTC-8): 02:00 local each day.
    expect(zonedSlot(d("2026-07-01T12:00:00Z"), "02:00", LA).toISOString()).toBe("2026-07-01T09:00:00.000Z");
    expect(zonedSlot(d("2026-12-01T12:00:00Z"), "02:00", LA).toISOString()).toBe("2026-12-01T10:00:00.000Z");
    // The day the clocks go forward (2026-03-08): 02:30 doesn't exist; it still runs that day.
    const spring = zonedSlot(d("2026-03-08T20:00:00Z"), "02:30", LA);
    expect(spring.getTime()).toBeLessThanOrEqual(d("2026-03-08T20:00:00Z").getTime());
    expect(spring.getTime()).toBeGreaterThan(d("2026-03-08T08:00:00Z").getTime());
    process.env.TZ = "UTC";
  });
});

describe("is an automatic backup due?", () => {
  const now = d("2026-11-17T03:00:00Z");
  it("no: switched off, or no key", () => {
    process.env.TZ = "UTC";
    expect(autoDue(now, { ...on, autoEnabled: false }, none)).toBe(false);
    expect(autoDue(now, { ...on, publicKey: null }, none)).toBe(false);
    expect(autoDue(now, { ...on, keyId: null }, none)).toBe(false);
  });
  it("yes: never made one", () => { expect(autoDue(now, on, none)).toBe(true); });
  it("no: one succeeded since the last scheduled time", () => {
    expect(autoDue(now, on, { ...none, lastAutoSuccessAt: d("2026-11-17T02:00:05Z") })).toBe(false);
  });
  it("yes: catch-up when the computer was off at the set time", () => {
    expect(autoDue(now, on, { ...none, lastAutoSuccessAt: d("2026-11-15T02:00:05Z") })).toBe(true);
  });
  it("after a failure since the slot, waits an hour before trying again", () => {
    const failed = { ...none, lastAutoSuccessAt: d("2026-11-16T02:00:05Z"), lastAutoAttemptAt: d("2026-11-17T02:30:00Z"), lastAutoError: "disk full" };
    expect(autoDue(now, on, failed)).toBe(false);
    expect(autoDue(new Date(d("2026-11-17T02:30:00Z").getTime() + RETRY_MS), on, failed)).toBe(true);
  });
  it("an attempt before the slot doesn't hold back today's run", () => {
    expect(autoDue(now, on, { ...none, lastAutoAttemptAt: d("2026-11-17T01:50:00Z") })).toBe(true);
  });
});

describe("the amber note", () => {
  const now = d("2026-11-17T12:00:00Z");
  it("none when switched off", () => {
    expect(autoHealth(now, { ...on, autoEnabled: false }, { ...none, lastAutoError: "x" })).toBeNull();
  });
  it("shows the last failure", () => {
    expect(autoHealth(now, on, { ...none, lastAutoSuccessAt: d("2026-11-17T02:00:00Z"), lastAutoError: "the folder can't be written" }))
      .toMatch(/failed.*the folder can't be written/);
  });
  it("shows after 2 days without a success, counted from switch-on when none yet", () => {
    expect(autoHealth(now, on, { ...none, lastAutoSuccessAt: d("2026-11-15T11:00:00Z") })).toMatch(/2 days/);
    expect(autoHealth(now, on, { ...none, lastAutoSuccessAt: d("2026-11-16T02:00:00Z") })).toBeNull();
    expect(autoHealth(now, { ...on, verifiedAt: d("2026-11-17T11:00:00Z") }, none)).toBeNull();
    expect(autoHealth(now, on, none)).toMatch(/2 days/);
  });
});

describe("file names and the keep rule", () => {
  it("names a file by its UTC time", () => {
    expect(autoFileName(d("2026-11-17T01:00:09Z"))).toBe("YoSched auto 2026-11-17 0100 UTC.yosched-backup");
  });

  const daily = (n: number, from = "2026-11-17") => Array.from({ length: n }, (_, i) => {
    const t = new Date(Date.parse(`${from}T01:00:00Z`) - i * 86_400_000);
    return autoFileName(t);
  });

  it("keeps the newest N days, N weeks and N months; removes the rest", () => {
    const names = daily(400);
    const del = planPrune(names, { keepDaily: 7, keepWeekly: 4, keepMonthly: 12 });
    const kept = names.filter((n) => !del.includes(n));
    for (const n of names.slice(0, 7)) expect(kept).toContain(n);
    expect(kept.length).toBeLessThanOrEqual(7 + 4 + 12);
    expect(kept.length).toBeGreaterThanOrEqual(12);
    expect(kept).toContain("YoSched auto 2026-11-01 0100 UTC.yosched-backup"); // the 4th week's newest (weeks run Monday to Sunday)
  });

  it("the newest file of each month is the one kept for that month", () => {
    const names = daily(90);
    const del = planPrune(names, { keepDaily: 1, keepWeekly: 0, keepMonthly: 3 });
    const kept = names.filter((n) => !del.includes(n)).sort();
    expect(kept).toEqual([
      "YoSched auto 2026-09-30 0100 UTC.yosched-backup",
      "YoSched auto 2026-10-31 0100 UTC.yosched-backup",
      "YoSched auto 2026-11-17 0100 UTC.yosched-backup",
    ]);
  });

  it("never touches files that aren't automatic backups", () => {
    const names = ["pre-restore-2026-11-01T00-00-00-000Z.yosched-backup", "YoSched backup 2026-11-17 0042 UTC.yosched-backup", "notes.txt", "my.yosched-key", ...daily(30)];
    const del = planPrune(names, { keepDaily: 1, keepWeekly: 0, keepMonthly: 0 });
    expect(del).toHaveLength(29);
    expect(del.every((n) => n.startsWith("YoSched auto "))).toBe(true);
  });

  it("always keeps the newest automatic file", () => {
    const names = daily(5);
    expect(planPrune(names, { keepDaily: 0, keepWeekly: 0, keepMonthly: 0 })).not.toContain(names[0]);
  });

  it("safety copies: keeps the newest N", () => {
    const names = Array.from({ length: 15 }, (_, i) => `pre-restore-2026-11-${String(i + 1).padStart(2, "0")}T00-00-00-000Z.yosched-backup`);
    const del = planSafetyPrune([...names, "YoSched auto 2026-11-17 0100 UTC.yosched-backup"], 10);
    expect(del.sort()).toEqual(names.slice(0, 5));
  });
});

describe("settings bounds", () => {
  it("accepts sensible values and refuses the rest with a plain message", () => {
    expect(parseAutoSettings({ autoTime: "01:00", keepDaily: 7, keepWeekly: 4, keepMonthly: 12, keepSafety: 10 }))
      .toEqual({ ok: true, value: { autoTime: "01:00", keepDaily: 7, keepWeekly: 4, keepMonthly: 12, keepSafety: 10 } });
    expect(parseAutoSettings({ autoTime: "24:00", keepDaily: 7, keepWeekly: 4, keepMonthly: 12, keepSafety: 10 })).toMatchObject({ ok: false });
    expect(parseAutoSettings({ autoTime: "1:00", keepDaily: 7, keepWeekly: 4, keepMonthly: 12, keepSafety: 10 })).toMatchObject({ ok: false });
    expect(parseAutoSettings({ autoTime: "01:00", keepDaily: 0, keepWeekly: 4, keepMonthly: 12, keepSafety: 10 })).toMatchObject({ ok: false });
    expect(parseAutoSettings({ autoTime: "01:00", keepDaily: 7, keepWeekly: -1, keepMonthly: 12, keepSafety: 10 })).toMatchObject({ ok: false });
    expect(parseAutoSettings({ autoTime: "01:00", keepDaily: 7, keepWeekly: 4, keepMonthly: 1.5, keepSafety: 10 })).toMatchObject({ ok: false });
    expect(parseAutoSettings({ autoTime: "01:00", keepDaily: 7, keepWeekly: 4, keepMonthly: 12, keepSafety: 0 })).toMatchObject({ ok: false });
    expect(parseAutoSettings(null)).toMatchObject({ ok: false });
  });
});

describe("pruning never removes the file just made (card #315 r1)", () => {
  it("a future-dated automatic file (clock moved back) can't push out the new one", async () => {
    const { planPrune } = await import("@/lib/backup/auto");
    const made = "YoSched auto 2026-11-17 0100 UTC.yosched-backup";
    const names = ["YoSched auto 2027-03-01 0100 UTC.yosched-backup", made];
    const del = planPrune(names, { keepDaily: 1, keepWeekly: 0, keepMonthly: 0 }, made);
    expect(del).not.toContain(made);
    expect(del).not.toContain(names[0]); // the newest by name is kept too
  });
  it("the new safety copy is kept even when older names sort later", async () => {
    const { planSafetyPrune } = await import("@/lib/backup/auto");
    const made = "pre-restore-2026-11-17T02-00-00-000Z.yosched-backup";
    const names = ["pre-restore-2027-01-01T00-00-00-000Z.yosched-backup", "pre-restore-2027-02-01T00-00-00-000Z.yosched-backup", made];
    const del = planSafetyPrune(names, 1, made);
    expect(del).not.toContain(made);
    expect(names.length - del.length).toBe(1);
  });
});
