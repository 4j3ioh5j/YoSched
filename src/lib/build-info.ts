// Card #230: what Settings › About YoSched shows, read ONCE at build time by
// next.config.ts and inlined as env values. No app imports: next.config loads this.
//
//   version, maker → package.json ("version", "author")
//   build, release → the git commit being built (its short sha and commit date)
//
// Every read may fail (no git in the build dir, unreadable package.json). A failure
// gives an empty value — the build must not break over an About box, and the page
// shows the value as unknown rather than inventing one.

export type BuildEnv = {
  YOSCHED_VERSION: string;
  YOSCHED_COMMIT: string;
  YOSCHED_COMMITTED_AT: string;
  YOSCHED_MAKER_NAME: string;
  YOSCHED_MAKER_URL: string;
};

type Pkg = { version?: unknown; author?: unknown };

function attempt<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

// npm's author field: { name, url } or "Name <email> (url)".
function parseAuthor(author: unknown): { name: string; url: string } {
  if (author && typeof author === "object") {
    const a = author as { name?: unknown; url?: unknown };
    return { name: str(a.name), url: str(a.url) };
  }
  const s = str(author);
  if (!s) return { name: "", url: "" };
  const url = /\(([^)]*)\)/.exec(s)?.[1]?.trim() ?? "";
  const name = s.replace(/<[^>]*>/, "").replace(/\([^)]*\)/, "").trim();
  return { name, url };
}

export function readBuildInfo(readPkg: () => Pkg, git: (args: string) => string): BuildEnv {
  const pkg = attempt(readPkg) ?? {};
  const author = parseAuthor(pkg.author);
  return {
    YOSCHED_VERSION: str(pkg.version),
    YOSCHED_COMMIT: str(attempt(() => git("rev-parse --short HEAD"))),
    YOSCHED_COMMITTED_AT: str(attempt(() => git("log -1 --format=%cI HEAD"))),
    YOSCHED_MAKER_NAME: author.name,
    YOSCHED_MAKER_URL: author.url,
  };
}
