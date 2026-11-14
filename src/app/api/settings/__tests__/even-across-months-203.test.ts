import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// Card #203: the two new Settings — "Keep counts even across months" on a shift type, and the
// "Count shifts from" date. Strict on write; a save that doesn't mention them leaves them alone.

type Shift = { id: string; code: string; name: string; evenAcrossMonths?: boolean; spreadOverMonth?: boolean };
const db = vi.hoisted(() => ({ shifts: [] as Shift[], prefs: null as Record<string, unknown> | null }));

vi.mock("@/lib/auth-guard", () => ({ getSession: async () => ({ error: null, session: { user: { id: "u" } }, userId: "u", permissions: ["settings:edit"], staffId: null }) }));
vi.mock("@/lib/prisma", () => {
  const shiftType = {
    findUnique: async (a: { where: { id: string } }) => { const s = db.shifts.find((x) => x.id === a.where.id); return s ? { ...s } : null; },
    update: async (a: { where: { id: string }; data: Partial<Shift> }) => { const s = db.shifts.find((x) => x.id === a.where.id)!; Object.assign(s, a.data); return { ...s }; },
  };
  const schedulingPreferences = {
    findFirst: async () => (db.prefs ? { ...db.prefs } : null),
    upsert: async (a: { update: Record<string, unknown>; create: Record<string, unknown> }) => {
      db.prefs = db.prefs ? { ...db.prefs, ...a.update } : { ...a.create };
      return { ...db.prefs };
    },
  };
  const client = { shiftType, schedulingPreferences };
  return { prisma: { ...client, $transaction: async (fn: (tx: typeof client) => Promise<unknown>) => fn(client) } };
});

import { PUT as putShiftType } from "../shift-types/route";
import { PUT as putPrefs } from "../scheduling-preferences/route";
import { SHIFT_TYPE_EDITABLE_FIELDS } from "@/lib/shift-type-fields";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;

beforeEach(() => {
  db.shifts = [{ id: "st-call", code: "CALL", name: "Call", evenAcrossMonths: false, spreadOverMonth: true }];
  db.prefs = { id: "default", payPeriodLengthDays: 14, shiftBalanceFrom: null };
});

describe("Keep counts even across months (shift type)", () => {
  it("is an editable field, and a save turns it on", async () => {
    expect(SHIFT_TYPE_EDITABLE_FIELDS).toContain("evenAcrossMonths");
    expect((await putShiftType(req({ id: "st-call", evenAcrossMonths: true }))).status).toBe(200);
    expect(db.shifts[0].evenAcrossMonths).toBe(true);
  });
  it("a save that doesn't mention it (an older page) keeps it", async () => {
    db.shifts[0].evenAcrossMonths = true;
    expect((await putShiftType(req({ id: "st-call", name: "Night call" }))).status).toBe(200);
    expect(db.shifts[0]).toMatchObject({ name: "Night call", evenAcrossMonths: true, spreadOverMonth: true });
  });
});

describe("Count shifts from (scheduling preferences)", () => {
  it("saves a date and clears it with null", async () => {
    expect((await putPrefs(req({ shiftBalanceFrom: "2027-02-01" }))).status).toBe(200);
    expect((db.prefs!.shiftBalanceFrom as Date).toISOString()).toBe("2027-02-01T00:00:00.000Z");
    expect((await putPrefs(req({ shiftBalanceFrom: null }))).status).toBe(200);
    expect(db.prefs!.shiftBalanceFrom).toBeNull();
  });
  it.each(["2027-02-30", "2027-2-1", "01/02/2027", "", 20270201, true])("rejects %j with 400 and writes nothing", async (bad) => {
    db.prefs!.shiftBalanceFrom = new Date("2027-02-01T00:00:00Z");
    const res = await putPrefs(req({ shiftBalanceFrom: bad }));
    expect(res.status).toBe(400);
    expect((db.prefs!.shiftBalanceFrom as Date).toISOString()).toBe("2027-02-01T00:00:00.000Z");
  });
  it("a save that doesn't mention it keeps it; a first save creates the row with it", async () => {
    db.prefs!.shiftBalanceFrom = new Date("2027-02-01T00:00:00Z");
    expect((await putPrefs(req({ prefer3DayWeekends: false }))).status).toBe(200);
    expect((db.prefs!.shiftBalanceFrom as Date).toISOString()).toBe("2027-02-01T00:00:00.000Z");
    db.prefs = null;
    expect((await putPrefs(req({ shiftBalanceFrom: "2027-03-01" }))).status).toBe(200);
    expect((db.prefs!.shiftBalanceFrom as Date).toISOString()).toBe("2027-03-01T00:00:00.000Z");
  });
});
