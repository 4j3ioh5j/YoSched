// Card #366: the matcher behind the Settings search box. The page builds the entries from
// what it renders (section titles, field rows, labels, named controls), so nothing here
// lists the settings by hand.

export type SettingsSearchEntry = {
  key: string;
  sectionId: string;
  section: string;
  group: string;
  label: string;
  desc: string;
  kind: "section" | "control";
  order: number;
};

export type SettingsSearchHit = SettingsSearchEntry & { score: number };

export const SETTINGS_SEARCH_LIMIT = 12;

export function normalizeSearchText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function words(s: string): string[] {
  return normalizeSearchText(s).split(/[^a-z0-9]+/).filter(Boolean);
}

function allTokensStartWords(tokens: string[], ws: string[]): boolean {
  return tokens.every((t) => ws.some((w) => w.startsWith(t)));
}

function score(entry: SettingsSearchEntry, q: string, tokens: string[]): number {
  const label = normalizeSearchText(entry.label);
  const labelWords = words(entry.label);
  if (label === q) return 100;
  if (label.startsWith(q) && allTokensStartWords(tokens, labelWords)) return 80;
  if (allTokensStartWords(tokens, labelWords)) return 60;
  const withSection = [...labelWords, ...words(entry.section)];
  if (allTokensStartWords(tokens, withSection)) return 40;
  if (allTokensStartWords(tokens, [...withSection, ...words(entry.desc), ...words(entry.group)])) return 20;
  return 0;
}

/** Entries matching every word of the query (at a word start), best first, page order within a score. */
export function searchSettings(entries: readonly SettingsSearchEntry[], query: string, limit = SETTINGS_SEARCH_LIMIT): SettingsSearchHit[] {
  const q = normalizeSearchText(query);
  const tokens = words(query);
  if (!q || tokens.length === 0) return [];
  const hits: SettingsSearchHit[] = [];
  for (const entry of entries) {
    const s = score(entry, q, tokens);
    if (s > 0) hits.push({ ...entry, score: s });
  }
  hits.sort((a, b) => b.score - a.score || a.order - b.order);
  return hits.slice(0, limit);
}

/** One entry per label per section (first wins); no blank labels; no control that only repeats its section's title. */
export function dedupeSettingsEntries(entries: readonly SettingsSearchEntry[]): SettingsSearchEntry[] {
  const seen = new Set<string>();
  const out: SettingsSearchEntry[] = [];
  for (const entry of entries) {
    const label = normalizeSearchText(entry.label);
    if (!label) continue;
    if (entry.kind === "control" && label === normalizeSearchText(entry.section)) continue;
    const k = `${entry.sectionId}\u0000${label}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(entry);
  }
  return out;
}
