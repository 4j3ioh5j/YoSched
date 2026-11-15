import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { aboutInfo } from "@/lib/about";
import { readBuildInfo } from "@/lib/build-info";

// Card #230: Settings › About YoSched shows the version, its release date, the
// copyright year and the maker's site. Every value is derived (package.json + git at
// build time), never typed into the page — and a missing value shows as missing,
// never as a made-up date or year.

const full = {
  version: "0.1.0",
  commit: "43dc982",
  committedAt: "2026-11-15T00:41:07+00:00",
  makerName: "YoLogiq.com",
  makerUrl: "https://yologiq.com",
};

describe("aboutInfo", () => {
  it("derives the release date and copyright year from the release commit", () => {
    const a = aboutInfo(full);
    expect(a.version).toBe("0.1.0");
    expect(a.build).toBe("43dc982");
    expect(a.releaseDate).toBe("2026-11-15");
    expect(a.copyrightYear).toBe(2026);
    expect(a.makerName).toBe("YoLogiq.com");
    expect(a.makerUrl).toBe("https://yologiq.com");
  });

  it("uses the commit's own calendar date, not UTC, for the date and year", () => {
    // 23:30 on 31 Dec in UTC-5 is already 1 Jan in UTC: the release is still that 31 Dec.
    const a = aboutInfo({ ...full, committedAt: "2026-12-31T23:30:00-05:00" });
    expect(a.releaseDate).toBe("2026-12-31");
    expect(a.copyrightYear).toBe(2026);
  });

  it("shows unknown values as missing, never invented", () => {
    const a = aboutInfo({});
    expect(a).toEqual({ version: null, build: null, releaseDate: null, copyrightYear: null, makerName: null, makerUrl: null });
  });

  it("rejects malformed values instead of showing them", () => {
    const a = aboutInfo({ version: " ", commit: "not-a-sha", committedAt: "2026-13-45T00:00:00Z", makerName: "", makerUrl: "javascript:alert(1)" });
    expect(a).toEqual({ version: null, build: null, releaseDate: null, copyrightYear: null, makerName: null, makerUrl: null });
  });

  it("keeps the maker's name when the link is unusable", () => {
    const a = aboutInfo({ ...full, makerUrl: "http://yologiq.com" });
    expect(a.makerName).toBe("YoLogiq.com");
    expect(a.makerUrl).toBeNull();
  });
});

describe("readBuildInfo", () => {
  const pkg = { version: "0.1.0", author: { name: "YoLogiq.com", url: "https://yologiq.com" } };
  const git = (args: string) => (args.includes("%cI") ? "2026-11-15T00:41:07+00:00\n" : "43dc982\n");

  it("reads the version and maker from package.json and the release from git", () => {
    expect(readBuildInfo(() => pkg, git)).toEqual({
      YOSCHED_VERSION: "0.1.0",
      YOSCHED_COMMIT: "43dc982",
      YOSCHED_COMMITTED_AT: "2026-11-15T00:41:07+00:00",
      YOSCHED_MAKER_NAME: "YoLogiq.com",
      YOSCHED_MAKER_URL: "https://yologiq.com",
    });
  });

  it("still builds when git is missing (empty values, not a failed build)", () => {
    const out = readBuildInfo(() => pkg, () => { throw new Error("not a git repository"); });
    expect(out.YOSCHED_COMMIT).toBe("");
    expect(out.YOSCHED_COMMITTED_AT).toBe("");
    expect(out.YOSCHED_VERSION).toBe("0.1.0");
  });

  it("still builds when package.json can't be read or has no author", () => {
    expect(readBuildInfo(() => { throw new Error("ENOENT"); }, git).YOSCHED_VERSION).toBe("");
    const out = readBuildInfo(() => ({ version: "0.1.0" }), git);
    expect(out.YOSCHED_MAKER_NAME).toBe("");
    expect(out.YOSCHED_MAKER_URL).toBe("");
  });

  it("accepts the npm string form of author", () => {
    const out = readBuildInfo(() => ({ version: "1.0.0", author: "YoLogiq.com (https://yologiq.com)" }), git);
    expect(out.YOSCHED_MAKER_NAME).toBe("YoLogiq.com");
    expect(out.YOSCHED_MAKER_URL).toBe("https://yologiq.com");
  });
});

describe("Settings page", () => {
  const src = readFileSync(join(__dirname, "..", "..", "app", "settings", "settings-page.tsx"), "utf8");
  it("puts About YoSched first", () => {
    const groups = [...src.matchAll(/<SectionGroup label="([^"]+)"/g)].map((m) => m[1]);
    expect(groups[0]).toBe("About YoSched");
  });
  it("types no version, year or site into the page", () => {
    const about = src.slice(src.indexOf("function AboutSection"), src.indexOf("// ─── end About"));
    expect(about.length).toBeGreaterThan(0);
    expect(about).not.toMatch(/yologiq/i);
    expect(about).not.toMatch(/\b20\d\d\b/);
    expect(about).not.toMatch(/\d+\.\d+\.\d+/);
  });
});
