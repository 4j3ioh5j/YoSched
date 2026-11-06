import { describe, it, expect } from "vitest";
import {
  deriveConditionCodes,
  conditionsReference,
  buildConditionsSave,
  parseConditionsIn,
  printSaveErrorMessage,
  PRINT_COLUMN_RULES_SAVE_URL,
  PRINT_AGGREGATE_COLUMNS_SAVE_URL,
} from "../print-conditions";
import { STALE_CLIENT, saveErrorMessage } from "../stale-client";

// Printed-schedule conditions name shifts by id; the codes the admin sees are derived from the
// shift list loaded in the same request, and a save never carries a code.

// Two shifts whose codes are each other's ids: any code/id mix-up shows up.
const shifts = [
  { id: "st-a", code: "st-b" },
  { id: "st-b", code: "st-a" },
  { id: "st-icu", code: "ICUX" }, // renamed ICU → ICUX
];
const cond = (shiftTypeIds: string[], exceptIds: string[] = [], over: Partial<{ quantifier: string; categories: string[] }> = {}) => ({
  quantifier: "has_any", categories: [] as string[], shiftTypeIds, exceptIds, ...over,
});

describe("deriveConditionCodes", () => {
  it("adds the shifts' CURRENT codes in order beside the ids; an unknown id is dropped, never invented", () => {
    const out = deriveConditionCodes([cond(["st-a", "st-icu"], ["st-b", "st-gone"])], shifts);
    expect(out).toEqual([{ ...cond(["st-a", "st-icu"], ["st-b", "st-gone"]), codes: ["st-b", "ICUX"], except: ["st-a"] }]);
  });
});

describe("conditionsReference", () => {
  it("is true when the shift is selected or excepted by any condition", () => {
    const conds = [cond(["st-a"]), cond([], ["st-icu"], { categories: ["work"] })];
    expect(conditionsReference(conds, "st-a")).toBe(true);
    expect(conditionsReference(conds, "st-icu")).toBe(true);
    expect(conditionsReference(conds, "st-b")).toBe(false);
    expect(conditionsReference([], "st-a")).toBe(false);
  });
});

describe("buildConditionsSave", () => {
  it("sends ids only (no codes/except key), drops selector-less conditions and copies the arrays", () => {
    const state = [
      { ...cond(["st-a"], ["st-b"]), codes: ["st-b"], except: ["st-a"] } as unknown as ReturnType<typeof cond>,
      cond([], [], { quantifier: "has_none" }), // no selector → dropped
      cond([], [], { categories: ["work"] }),
    ];
    const payload = buildConditionsSave(state);
    expect(payload).toEqual([
      { quantifier: "has_any", categories: [], shiftTypeIds: ["st-a"], exceptIds: ["st-b"] },
      { quantifier: "has_any", categories: ["work"], shiftTypeIds: [], exceptIds: [] },
    ]);
    expect(JSON.stringify(payload)).not.toMatch(/"codes"|"except"|shiftCodes|shiftMatch/);
    payload[0].shiftTypeIds.push("x");
    expect(state[0].shiftTypeIds).toEqual(["st-a"]);
    expect(PRINT_COLUMN_RULES_SAVE_URL).toBe("/api/settings/print-column-rules/by-shift-id");
    expect(PRINT_AGGREGATE_COLUMNS_SAVE_URL).toBe("/api/settings/print-aggregate-columns/by-shift-id");
  });
});

describe("parseConditionsIn (server-side validation of a new-client payload)", () => {
  const current = { ids: new Set(["st-a", "st-b", "st-icu"]), codes: new Set(["st-b", "st-a", "ICUX"]) };

  it("accepts ids (incl. a code-looking string that IS an id), coerces shape, drops selector-less conditions", () => {
    const res = parseConditionsIn(
      [
        { quantifier: "has_none", categories: ["work", "bogus"], shiftTypeIds: ["st-a"], exceptIds: ["st-icu"] },
        { quantifier: "weird", categories: [] },
      ],
      current,
      "rule 0",
    );
    expect(res).toEqual({ ok: true, conditions: [{ quantifier: "has_none", categories: ["work"], shiftTypeIds: ["st-a"], exceptIds: ["st-icu"] }] });
    expect(parseConditionsIn(undefined, current, "rule 0")).toEqual({ ok: true, conditions: [] });
  });

  it("a codes/except key → 400 (pre-slice tab)", () => {
    const res = parseConditionsIn([{ quantifier: "has_any", categories: [], codes: ["st-b"], except: [] }], current, "rule 0");
    expect(res).toMatchObject({ ok: false, status: 400, body: { reason: "bad-request" } });
  });

  it("a current CODE where an id belongs → 409 stale-client; an unknown id → 400 unknown-shift", () => {
    expect(parseConditionsIn([cond(["ICUX"])], current, "rule 0")).toEqual({ ok: false, status: 409, body: STALE_CLIENT });
    expect(parseConditionsIn([cond([], ["ICUX"])], current, "rule 0")).toEqual({ ok: false, status: 409, body: STALE_CLIENT });
    expect(parseConditionsIn([cond(["st-nope"])], current, "rule 0")).toMatchObject({ ok: false, status: 400, body: { reason: "unknown-shift", shiftTypeId: "st-nope" } });
  });

  it("duplicates and bad shapes → 400", () => {
    expect(parseConditionsIn([cond(["st-a", "st-a"])], current, "c")).toMatchObject({ ok: false, status: 400, body: { reason: "duplicate" } });
    expect(parseConditionsIn("nope", current, "c")).toMatchObject({ ok: false, status: 400 });
    expect(parseConditionsIn(["nope"], current, "c")).toMatchObject({ ok: false, status: 400 });
    expect(parseConditionsIn([{ shiftTypeIds: "st-a" }], current, "c")).toMatchObject({ ok: false, status: 400 });
    expect(parseConditionsIn([{ shiftTypeIds: [1] }], current, "c")).toMatchObject({ ok: false, status: 400 });
  });
});

describe("printSaveErrorMessage", () => {
  it("is the shared save-error rule (404/405 → reload message)", () => {
    expect(printSaveErrorMessage).toBe(saveErrorMessage);
    expect(printSaveErrorMessage(404, "")).toBe(STALE_CLIENT.error);
  });
});
