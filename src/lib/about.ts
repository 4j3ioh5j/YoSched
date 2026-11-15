// Card #230: the values Settings › About YoSched shows, validated. Input comes from the
// build (see build-info.ts). Anything missing or malformed is null — the page shows
// it as unknown, never a guessed date, year or link.

export type AboutInput = {
  version?: string;
  commit?: string;
  committedAt?: string;
  makerName?: string;
  makerUrl?: string;
};

export type About = {
  version: string | null;
  build: string | null;
  /** YYYY-MM-DD: the release commit's own calendar date (its timezone, not UTC). */
  releaseDate: string | null;
  copyrightYear: number | null;
  makerName: string | null;
  makerUrl: string | null;
};

const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const SHA = /^[0-9a-f]{7,40}$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function realDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function httpsUrl(raw: string | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && u.hostname ? s : null;
  } catch {
    return null;
  }
}

export function aboutInfo(input: AboutInput): About {
  const version = input.version?.trim() ?? "";
  const commit = input.commit?.trim() ?? "";
  const m = ISO.exec(input.committedAt?.trim() ?? "");
  const releaseDate = m && realDate(+m[1], +m[2], +m[3]) ? `${m[1]}-${m[2]}-${m[3]}` : null;
  const makerName = input.makerName?.trim() ?? "";
  return {
    version: VERSION.test(version) ? version : null,
    build: SHA.test(commit) ? commit : null,
    releaseDate,
    copyrightYear: releaseDate ? Number(releaseDate.slice(0, 4)) : null,
    makerName: makerName || null,
    makerUrl: httpsUrl(input.makerUrl),
  };
}
