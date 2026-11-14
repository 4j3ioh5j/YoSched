import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// Card #210: every holiday links to a holiday type by id. A new row gets the type named like it
// (" (observed)" dropped); an existing row keeps its type unless the body sets one; an older tab
// that sends no type never unlinks anything.

type H = { id: string; date: Date; name: string; holidayTypeId: string | null };
type T = { id: string; name: string };
const db = vi.hoisted(() => ({ holidays: [] as H[], types: [] as T[], seq: 0 }));

vi.mock("@/lib/auth-guard", () => ({ getSession: async () => ({ error: null, session: { user: { id: "u" } }, userId: "u", permissions: ["settings:edit"], staffId: null }) }));
vi.mock("@/lib/prisma", () => {
  const key = (d: Date) => d.toISOString();
  const holiday = {
    findUnique: async (a: { where: { date: Date } }) => db.holidays.find((h) => key(h.date) === key(a.where.date)) ?? null,
    upsert: async (a: { where: { date: Date }; update: Partial<H>; create: Omit<H, "id"> }) => {
      const h = db.holidays.find((x) => key(x.date) === key(a.where.date));
      if (h) { Object.assign(h, a.update); return { ...h }; }
      const n = { id: `h${++db.seq}`, ...a.create } as H;
      db.holidays.push(n);
      return { ...n };
    },
    delete: async () => ({}),
  };
  const holidayType = {
    findUnique: async (a: { where: { id: string } }) => db.types.find((t) => t.id === a.where.id) ?? null,
    upsert: async (a: { where: { name: string }; create: { name: string } }) => {
      let t = db.types.find((x) => x.name === a.where.name);
      if (!t) { t = { id: `t${++db.seq}`, name: a.create.name }; db.types.push(t); }
      return { id: t.id };
    },
  };
  return { prisma: { holiday, holidayType } };
});

import { POST } from "../holidays/route";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const post = async (body: unknown) => { const r = await POST(req(body)); return { status: r.status, body: (await r.json()) as Record<string, unknown> }; };

beforeEach(() => { db.holidays = []; db.types = [{ id: "tg", name: "Thanksgiving Day" }]; db.seq = 0; });

describe("POST /api/settings/holidays — holiday types", () => {
  it("a new holiday gets the existing type with its name", async () => {
    const r = await post({ date: "2026-11-26", name: "Thanksgiving Day" });
    expect(r.body.holidayTypeId).toBe("tg");
  });

  it("an observed holiday shares the real one's type; a new name creates its type", async () => {
    const a = await post({ date: "2026-07-03", name: "Independence Day (observed)" });
    const b = await post({ date: "2027-07-04", name: "Independence Day" });
    expect(a.body.holidayTypeId).toBe(b.body.holidayTypeId);
    expect(db.types.filter((t) => t.name === "Independence Day")).toHaveLength(1);
  });

  it("an older tab's save (no type in the body) keeps the row's type", async () => {
    db.holidays.push({ id: "h1", date: new Date("2026-11-26T00:00:00Z"), name: "Thanksgiving Day", holidayTypeId: "custom" });
    db.types.push({ id: "custom", name: "Custom" });
    const r = await post({ date: "2026-11-26", name: "Thanksgiving" });
    expect(r.body.holidayTypeId).toBe("custom");
  });

  it("an explicit type is used; null unlinks; an unknown id is refused", async () => {
    db.types.push({ id: "other", name: "Other" });
    expect((await post({ date: "2026-11-26", name: "Thanksgiving Day", holidayTypeId: "other" })).body.holidayTypeId).toBe("other");
    expect((await post({ date: "2026-11-26", name: "Thanksgiving Day", holidayTypeId: null })).body.holidayTypeId).toBeNull();
    const bad = await post({ date: "2026-11-26", name: "Thanksgiving Day", holidayTypeId: "gone" });
    expect(bad.status).toBe(400);
    expect(db.holidays[0].holidayTypeId).toBeNull();
  });

  it("auto-populate links every federal holiday to a type", async () => {
    const r = await POST(req({ action: "auto-populate", years: [2026] }));
    const rows = (await r.json()) as { name: string; holidayTypeId: string | null }[];
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.every((h) => !!h.holidayTypeId)).toBe(true);
    expect(rows.find((h) => h.name.startsWith("Thanksgiving"))?.holidayTypeId).toBeTruthy();
  });

  it("card #218: a holiday set to No type stays unlinked on a save without a type and on auto-populate", async () => {
    await post({ date: "2026-11-26", name: "Thanksgiving Day", holidayTypeId: null });
    expect((await post({ date: "2026-11-26", name: "Thanksgiving Day" })).body.holidayTypeId).toBeNull();
    const rows = (await (await POST(req({ action: "auto-populate", years: [2026] }))).json()) as { date: string; name: string; holidayTypeId: string | null }[];
    expect(rows.find((h) => h.name.startsWith("Thanksgiving"))?.holidayTypeId).toBeNull();
    // A new row is still linked by its name.
    expect(rows.find((h) => h.name.startsWith("Christmas"))?.holidayTypeId).toBeTruthy();
  });
});
