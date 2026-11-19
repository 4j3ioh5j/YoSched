import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { EXCLUDED_TABLES } from "../../backup/tables";

// Card #367: who may see the Ask page, what it ships, and where saved questions are cleaned up.
const src = (p: string) => readFileSync(path.resolve(__dirname, "../../../..", p), "utf8");

describe("Ask page permissions", () => {
  const page = src("src/app/ask/page.tsx");
  it("needs statistics:view AND schedule:view, because it ships the schedule", () => {
    expect(page).toContain('getPageSession(["statistics:view", "schedule:view"])');
    expect(page).toContain('if (session.error) redirect("/")');
  });
  it("ships requests only to people with requests:view", () => {
    expect(page).toContain('session.permissions.includes("requests:view")');
    expect(page).toMatch(/canSeeRequests\s*\n?\s*\? prisma\.scheduleRequest\.findMany/);
  });
  it("works out today and received dates in the Settings time zone", () => {
    expect(page).toContain("resolveZone(schedPrefs?.timeZone)");
    expect(page).toContain("receivedDate: zoneDate(r.receivedAt, zone)");
    expect(page).toContain("today={zoneDate(new Date(), zone)}");
  });
  it("lists the same saved questions as the API: shared plus the viewer's own", () => {
    expect(page).toContain("where: { OR: [{ isShared: true }, { ownerId: session.userId }] }");
  });
  it("the nav shows Ask only with both permissions", () => {
    const nav = src("src/app/nav-header.tsx");
    expect(nav).toContain('{ label: "Ask", href: "/ask", requiredPermission: ["statistics:view", "schedule:view"] }');
    expect(nav).toContain("[item.requiredPermission].flat().every((p) => permissions.includes(p))");
  });
});

describe("saved questions API", () => {
  const list = src("src/app/api/ask/questions/route.ts");
  const one = src("src/app/api/ask/questions/[id]/route.ts");
  it("reading needs both view permissions; writing needs statistics:manage", () => {
    expect(list).toContain('getSession(["statistics:view", "schedule:view"])');
    expect(list).toContain('getSession(["statistics:manage", "schedule:view"])');
    expect(one.match(/getSession\(\["statistics:manage", "schedule:view"\]\)/g)).toHaveLength(2);
  });
  it("checks every spec on the server and stores the checked one", () => {
    expect(list).toContain("validateAskSpec(body?.spec)");
    expect(list).toContain("spec: v.spec");
    expect(one).toContain("validateAskSpec(body.spec)");
    expect(one).toContain("data.spec = v.spec");
  });
  it("hides another person's private question (404) and every write goes through the write gate", () => {
    expect(one.match(/!existing \|\| !canManageView\(existing, result\.userId\)/g)).toHaveLength(2);
    for (const f of [list, one]) expect(f).toMatch(/export const \w+ = gated\(/);
  });
});

describe("saved questions table", () => {
  const mig = src("prisma/migrations/20261211000000_saved_questions/migration.sql");
  it("is a new table only, its owner link set to null when the login is deleted", () => {
    expect(mig).toContain('CREATE TABLE "saved_questions"');
    expect(mig).toContain('REFERENCES "users"("id") ON DELETE SET NULL');
    expect(mig).not.toMatch(/ALTER TABLE "(?!saved_questions)/);
  });
  it("is in backups (the catalog takes every table not excluded)", () => {
    expect(EXCLUDED_TABLES as readonly string[]).not.toContain("saved_questions");
  });
  it("private questions are removed with their owner, like private views", () => {
    const life = src("src/lib/user-lifecycle.ts");
    expect(life).toContain('"user" | "savedGraphView" | "savedQuestion"');
    expect(life).toContain("await db.savedQuestion.deleteMany({ where: { ownerId: login!.id, isShared: false } });");
    expect(src("src/app/api/users/route.ts")).toContain("await prisma.savedQuestion.deleteMany({ where: { ownerId: id, isShared: false } });");
  });
});

describe("Statistics and Ask read the schedule the same way", () => {
  it("both pages use the shared loader", () => {
    expect(src("src/app/equity/page.tsx")).toContain("loadRawStatsData()");
    expect(src("src/app/ask/page.tsx")).toContain("loadRawStatsData()");
  });
});

describe("the page never broadens a question", () => {
  const ui = src("src/app/ask/ask-page.tsx");
  it("runs the same validator as the server, and answer() refuses deleted ids", () => {
    expect(ui).toContain("return validateAskSpec(s);");
    expect(ui).toContain("setAsked(s.ok ? { spec: s.spec } : { error: s.error })");
  });
  it("removing deleted picks keeps a list (an empty list must be re-picked, never 'everyone')", () => {
    expect(ui).toContain("onChange({ ids: [...ids!].filter((x) => !missing.includes(x)) })");
  });
});

describe("Refresh recomputes the answer (card #367 review r1)", () => {
  const ui = src("src/app/ask/ask-page.tsx");
  it("keeps the asked question, not a computed answer, and derives the table from it and the current data", () => {
    expect(ui).not.toContain("setResult(");
    expect(ui).toContain('asked === null ? null : "error" in asked ? asked : answer(asked.spec, data, today)');
    expect(ui).toContain("[asked, data, today]");
  });
});

describe("the builder offers every approved variant", () => {
  const ui = src("src/app/ask/ask-page.tsx");
  it("streaks of chosen shifts, who had a shift on any day, request kinds and grouping, gaps over a range", () => {
    expect(ui).toContain('<option value="shifts">Chosen shifts</option>');
    expect(ui).toContain('<option value="anyDay">Any day (who had the shift)</option>');
    expect(ui).toContain('<option value="kind">Kind of request</option><option value="status">Status</option>');
    expect(ui).toContain('label="Kinds of request"');
    expect(ui).toContain('s = { v: 1, kind: "gap", shifts: d.shifts, staff: d.staff, range }');
  });
});
