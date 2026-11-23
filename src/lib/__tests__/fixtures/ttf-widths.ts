// A small TrueType reader for tests: each character's advance width in em, from the font's
// own hmtx table (cmap format 4). Independent of jsPDF, so tests can check jsPDF's widths.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../../..");

function readTtf(file: string) {
  const b = readFileSync(join(ROOT, "public/fonts", file));
  const u16 = (o: number) => b.readUInt16BE(o);
  const tables = new Map<string, number>();
  for (let i = 0, n = u16(4); i < n; i++) tables.set(b.toString("latin1", 12 + i * 16, 16 + i * 16), b.readUInt32BE(12 + i * 16 + 8));
  const upm = u16(tables.get("head")! + 18);
  const nHm = u16(tables.get("hhea")! + 34);
  const hmtx = tables.get("hmtx")!;
  const cmap = tables.get("cmap")!;
  let sub = -1;
  for (let i = 0, n = u16(cmap + 2); i < n; i++) {
    const pid = u16(cmap + 4 + i * 8), eid = u16(cmap + 6 + i * 8), off = b.readUInt32BE(cmap + 8 + i * 8);
    if (pid === 3 && eid === 1 && u16(cmap + off) === 4) sub = cmap + off;
  }
  if (sub < 0) throw new Error(`${file}: no Unicode cmap`);
  const seg = u16(sub + 6) / 2;
  const ends = sub + 14, starts = ends + seg * 2 + 2, deltas = starts + seg * 2, ranges = deltas + seg * 2;
  const gid = (c: number) => {
    for (let s = 0; s < seg; s++) {
      if (u16(ends + s * 2) < c) continue;
      if (u16(starts + s * 2) > c) return 0;
      const ro = u16(ranges + s * 2), d = u16(deltas + s * 2);
      if (ro === 0) return (c + d) & 0xffff;
      const g = u16(ranges + s * 2 + ro + (c - u16(starts + s * 2)) * 2);
      return g ? (g + d) & 0xffff : 0;
    }
    return 0;
  };
  const glyphEm = (g: number) => u16(hmtx + Math.min(g, nHm - 1) * 4) / upm;
  return { gid, glyphEm };
}

export function ttfAdvanceEm(file: string): (ch: string) => number {
  const t = readTtf(file);
  return (ch: string) => t.glyphEm(t.gid(ch.charCodeAt(0)));
}

/** Advance in em of a glyph id (how jsPDF writes custom-font text: hex glyph ids). */
export function ttfGlyphEm(file: string): (glyphId: number) => number {
  return readTtf(file).glyphEm;
}

/** Width in points of `s` at `size` in that font file. */
export function ttfWidth(file: string): (s: string, size: number) => number {
  const adv = ttfAdvanceEm(file);
  return (s, size) => [...s].reduce((a, ch) => a + adv(ch), 0) * size;
}
