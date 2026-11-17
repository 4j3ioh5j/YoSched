import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { isWriteOperation } from "@/lib/prisma-write-guard";

// Card #314: the fence must cover every writer. Routes hold it for their whole run;
// getPayPeriods (the one page-rendered writer) holds it from its first read; anything
// else that writes without it throws.

const ROOT = path.resolve(__dirname, "../..");

describe("isWriteOperation (card #314)", () => {
  it("model writes and executeRaw are writes; reads are not", () => {
    for (const op of ["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany", "$executeRaw", "$executeRawUnsafe"]) {
      expect(isWriteOperation(op, {})).toBe(true);
    }
    for (const op of ["findMany", "findFirst", "findUnique", "count", "aggregate", "groupBy"]) expect(isWriteOperation(op, {})).toBe(false);
  });
  it("queryRaw counts as a write only when its SQL writes", () => {
    expect(isWriteOperation("$queryRaw", { strings: ["SELECT id FROM \"staff\" WHERE id = ", " FOR UPDATE"] })).toBe(false);
    expect(isWriteOperation("$queryRawUnsafe", ["DELETE FROM x"])).toBe(true);
    expect(isWriteOperation("$queryRaw", { strings: ["INSERT INTO x VALUES (", ") RETURNING id"] })).toBe(true);
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

describe("every route handler holds the write gate (card #314)", () => {
  const routes = walk(path.join(ROOT, "app"));
  it("finds the routes", () => { expect(routes.length).toBeGreaterThan(60); });
  for (const file of routes) {
    const rel = path.relative(ROOT, file);
    it(rel, () => {
      const src = readFileSync(file, "utf8");
      const bad: string[] = [];
      for (const m of src.matchAll(/export\s+(async\s+function|const|function)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b([^\n]*)/g)) {
        if (m[1] !== "const" || !/=\s*(gated|exclusiveRoute)\(/.test(m[3])) bad.push(m[2]);
      }
      for (const m of src.matchAll(/export\s+const\s+\{([^}]*)\}\s*=\s*([^;\n]+)/g)) {
        if (!/^gatedHandlers\(/.test(m[2].trim())) bad.push(m[1].trim());
      }
      expect(bad).toEqual([]);
    });
  }
});

describe("the fail-closed backstop and the page writer (card #314)", () => {
  it("prisma.ts refuses writes outside the gate", () => {
    const src = readFileSync(path.join(ROOT, "lib/prisma.ts"), "utf8");
    expect(src).toMatch(/\$allOperations/);
    expect(src).toMatch(/isWriteOperation\(operation, args\)/);
    expect(src).toMatch(/writeGate\.requireToken\(/);
  });
  it("getPayPeriods holds the gate from its first statement", () => {
    const src = readFileSync(path.join(ROOT, "lib/pay-periods-server.ts"), "utf8");
    expect(src).toMatch(/export async function getPayPeriods\(\): Promise<PayPeriodRow\[\]> \{\n(\s*\/\/[^\n]*\n)*\s*return writeGate\.shared\(/);
  });
});
