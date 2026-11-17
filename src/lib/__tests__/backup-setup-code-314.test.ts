import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureSetupCode, verifySetupCode, removeSetupCode } from "@/lib/backup/setup-code";

// Card #314: the first-run restore's one-time code.
describe("setup code (card #314)", () => {
  let dir: string;
  beforeEach(() => { dir = path.join(mkdtempSync(path.join(os.tmpdir(), "ys-setup-")), "backups"); });

  it("no code file: nothing verifies", async () => {
    expect(await verifySetupCode(dir, "anything")).toBe(false);
  });
  it("creates a private code once and keeps it", async () => {
    await ensureSetupCode(dir);
    const file = path.join(dir, "setup-code");
    const code = readFileSync(file, "utf8").trim();
    expect(code.length).toBeGreaterThanOrEqual(24);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    await ensureSetupCode(dir);
    expect(readFileSync(file, "utf8").trim()).toBe(code);
    expect(await verifySetupCode(dir, code)).toBe(true);
    expect(await verifySetupCode(dir, ` ${code}\n`)).toBe(true);
    expect(await verifySetupCode(dir, code + "x")).toBe(false);
    expect(await verifySetupCode(dir, "")).toBe(false);
  });
  it("a used code stops working once removed", async () => {
    await ensureSetupCode(dir);
    const code = readFileSync(path.join(dir, "setup-code"), "utf8");
    await removeSetupCode(dir);
    expect(await verifySetupCode(dir, code)).toBe(false);
  });
});
