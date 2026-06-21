import { describe, it, expect } from "vitest";
import {
  matchesSearch,
  compareByKey,
  filterAndSortRequests,
  type RequestSortFields,
} from "../request-list";

const f = (over: Partial<RequestSortFields>): RequestSortFields => ({
  staff: "",
  startDate: "2026-07-01",
  endDate: "2026-07-01",
  request: "",
  statusRank: 0,
  source: "",
  receivedAt: "2026-07-01T00:00:00.000Z",
  approvedAt: null,
  haystack: "",
  ...over,
});

describe("matchesSearch", () => {
  it("matches everything on an empty / blank query", () => {
    expect(matchesSearch("anything", "")).toBe(true);
    expect(matchesSearch("anything", "   ")).toBe(true);
  });

  it("is case-insensitive substring match", () => {
    expect(matchesSearch("Jane Doe — Off", "jane")).toBe(true);
    expect(matchesSearch("Jane Doe — Off", "OFF")).toBe(true);
    expect(matchesSearch("Jane Doe — Off", "bob")).toBe(false);
  });

  it("requires every whitespace-split term to appear (AND)", () => {
    expect(matchesSearch("jane doe approved", "jane approved")).toBe(true);
    expect(matchesSearch("jane doe approved", "jane declined")).toBe(false);
  });
});

describe("compareByKey", () => {
  it("compares staff names case-insensitively via localeCompare", () => {
    expect(compareByKey(f({ staff: "Adams" }), f({ staff: "Brown" }), "staff")).toBeLessThan(0);
  });

  it("orders dates by start then end", () => {
    expect(compareByKey(f({ startDate: "2026-07-01" }), f({ startDate: "2026-07-02" }), "dates")).toBeLessThan(0);
    // same start, different end → tie-break on end
    expect(
      compareByKey(
        f({ startDate: "2026-07-01", endDate: "2026-07-03" }),
        f({ startDate: "2026-07-01", endDate: "2026-07-05" }),
        "dates",
      ),
    ).toBeLessThan(0);
  });

  it("orders status by rank, not alphabetically", () => {
    expect(compareByKey(f({ statusRank: 1 }), f({ statusRank: 4 }), "status")).toBeLessThan(0);
  });

  it("orders approved timestamps lexicographically (treating null as empty)", () => {
    expect(
      compareByKey(f({ approvedAt: "2026-07-01T00:00:00Z" }), f({ approvedAt: "2026-07-02T00:00:00Z" }), "approved"),
    ).toBeLessThan(0);
  });
});

describe("filterAndSortRequests", () => {
  type Row = { id: string; fields: RequestSortFields };
  const rows: Row[] = [
    { id: "a", fields: f({ staff: "Carol", statusRank: 2, haystack: "carol approved", approvedAt: "2026-07-03T00:00:00Z" }) },
    { id: "b", fields: f({ staff: "Alice", statusRank: 1, haystack: "alice pending", approvedAt: null }) },
    { id: "c", fields: f({ staff: "Bob", statusRank: 4, haystack: "bob fulfilled", approvedAt: "2026-07-01T00:00:00Z" }) },
  ];
  const fieldsOf = (r: Row) => r.fields;

  it("returns original order when no query and no sort", () => {
    const out = filterAndSortRequests(rows, fieldsOf, { query: "", sort: null });
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input array when sorting", () => {
    const before = rows.map((r) => r.id);
    filterAndSortRequests(rows, fieldsOf, { query: "", sort: { key: "staff", dir: "asc" } });
    expect(rows.map((r) => r.id)).toEqual(before);
  });

  it("filters by search before sorting", () => {
    const out = filterAndSortRequests(rows, fieldsOf, { query: "alice", sort: { key: "staff", dir: "asc" } });
    expect(out.map((r) => r.id)).toEqual(["b"]);
  });

  it("sorts ascending and reverses on desc", () => {
    const asc = filterAndSortRequests(rows, fieldsOf, { query: "", sort: { key: "staff", dir: "asc" } });
    expect(asc.map((r) => r.id)).toEqual(["b", "c", "a"]); // Alice, Bob, Carol
    const desc = filterAndSortRequests(rows, fieldsOf, { query: "", sort: { key: "staff", dir: "desc" } });
    expect(desc.map((r) => r.id)).toEqual(["a", "c", "b"]);
  });

  it("keeps unapproved (null approvedAt) rows last in BOTH directions on the approved column", () => {
    const asc = filterAndSortRequests(rows, fieldsOf, { query: "", sort: { key: "approved", dir: "asc" } });
    expect(asc.map((r) => r.id)).toEqual(["c", "a", "b"]); // c(Jul1), a(Jul3), null last
    const desc = filterAndSortRequests(rows, fieldsOf, { query: "", sort: { key: "approved", dir: "desc" } });
    expect(desc.map((r) => r.id)).toEqual(["a", "c", "b"]); // a(Jul3), c(Jul1), null STILL last
  });
});
