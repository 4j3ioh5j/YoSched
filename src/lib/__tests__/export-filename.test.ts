import { describe, it, expect } from "vitest";
import { DEFAULT_EXPORT_FILE_NAME, exportFileNameError, resolveExportFileName, exportYearChoices } from "../export-filename";

// Card #299: the year export's base file name. A setting holds the template ({YEAR} is
// filled in); the dialog lets the user edit the result before saving.

describe("export file name (card #299)", () => {
  it("the built-in default is generic, with the year filled in", () => {
    expect(DEFAULT_EXPORT_FILE_NAME).toBe("SCHEDULE_{YEAR}");
    expect(resolveExportFileName(null, 2026)).toBe("SCHEDULE_2026");
    expect(resolveExportFileName("", 2026)).toBe("SCHEDULE_2026");
  });

  it("fills every {YEAR} in the setting", () => {
    expect(resolveExportFileName("MDSCHEDULE_{YEAR}", 2027)).toBe("MDSCHEDULE_2027");
    expect(resolveExportFileName("{YEAR}-{YEAR}", 2026)).toBe("2026-2026");
    expect(resolveExportFileName("Plain", 2026)).toBe("Plain");
  });

  it("accepts ordinary names", () => {
    for (const ok of ["MDSCHEDULE_2026", "a", "Schedule 2026 (final)", "x".repeat(100), "ÉCOLE-2026"]) {
      expect(exportFileNameError(ok)).toBeNull();
    }
  });

  it("rejects empty, too long, reserved characters and a leading or trailing dot or space", () => {
    for (const bad of ["", "x".repeat(101), "a/b", "a\\b", "a:b", "a*b", "a?b", 'a"b', "a<b", "a>b", "a|b", ".hidden", "name.", " name", "name ", "a\nb", "a\u0000b"]) {
      expect(exportFileNameError(bad), JSON.stringify(bad)).not.toBeNull();
    }
  });

  it("year choices: the years with data plus the current one, newest first, no duplicates", () => {
    expect(exportYearChoices(["2025-03-01", "2026-12-31", "2024-01-01"], 2026)).toEqual([2026, 2025, 2024]);
    expect(exportYearChoices([], 2026)).toEqual([2026]);
    expect(exportYearChoices(["2027-01-01"], 2026)).toEqual([2027, 2026]);
  });
});

describe("the dialog's name follows the year until edited (card #299)", () => {
  it("follows the year while untouched, then keeps the typed name", async () => {
    const { initExportName, exportNameSetYear, exportNameEdit } = await import("../export-filename");
    let s = initExportName("MD_{YEAR}", 2026);
    expect(s).toEqual({ year: 2026, name: "MD_2026", edited: false });
    s = exportNameSetYear(s, "MD_{YEAR}", 2025);
    expect(s.name).toBe("MD_2025");
    s = exportNameEdit(s, "Mine");
    s = exportNameSetYear(s, "MD_{YEAR}", 2024);
    expect(s).toEqual({ year: 2024, name: "Mine", edited: true });
  });

  it("clearing the edited name lets it follow the year again", async () => {
    const { initExportName, exportNameSetYear, exportNameEdit } = await import("../export-filename");
    let s = exportNameEdit(initExportName(null, 2026), "");
    expect(s.edited).toBe(false);
    s = exportNameSetYear(s, null, 2027);
    expect(s.name).toBe("SCHEDULE_2027");
  });
});
