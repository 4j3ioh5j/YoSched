// Card #266: bundle the engine worker twice, stamped with the release it was built from (the same
// version and short commit next.config inlines, see src/lib/build-info.ts):
//  - for the server's worker threads (src/lib/engine-worker-entry.ts) into one file next to the
//    standalone server, the stamp on its first line. The server's pool refuses a bundle from
//    another release, so a stale bundle only means an inline trial.
//  - for the browser's Web Workers (src/lib/engine-web-worker-entry.ts) into
//    <web-dir>/engine-worker-<commit>.js, the stamp defined in the code (the worker says hello with
//    it). Older engine-worker-<hex>.js files in <web-dir> are removed once the new one is in place.
//
//   node scripts/build-engine-worker.mjs [--out <file>] [--entry <file>] [--web-dir <dir>] [--web-entry <file>]
//
// Exits non-zero (and writes neither output, nor removes an older browser bundle) when the version
// or commit is unknown or either build fails, so `pnpm build` fails too.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(name);
  if (i < 0) return dflt;
  const v = args[i + 1];
  if (!v) { console.error(`build-engine-worker: ${name} needs a value`); process.exit(2); }
  return path.resolve(root, v);
};
const out = arg("--out", path.join(root, ".next/standalone/engine-worker.cjs"));
const entry = arg("--entry", path.join(root, "src/lib/engine-worker-entry.ts"));
const webDir = arg("--web-dir", path.join(root, "public"));
const webEntry = arg("--web-entry", path.join(root, "src/lib/engine-web-worker-entry.ts"));

let version = "";
let commit = "";
try { version = String(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version ?? "").trim(); } catch { /* reported below */ }
try { commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* reported below */ }
if (!version || !commit) {
  console.error(`build-engine-worker: cannot stamp the bundle (version "${version}", commit "${commit}")`);
  process.exit(1);
}

const stamp = { version, commit };
const webName = `engine-worker-${commit}.js`;
const webOut = path.join(webDir, webName);
const tmp = `${out}.tmp-${process.pid}`;
const webTmp = `${webOut}.tmp-${process.pid}`;
try {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.mkdirSync(webDir, { recursive: true });
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outfile: tmp,
    banner: { js: `/* yosched-engine-worker ${JSON.stringify(stamp)} */` },
    logLevel: "error",
  });
  await build({
    entryPoints: [webEntry],
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2020",
    minify: true,
    outfile: webTmp,
    define: { __YOSCHED_ENGINE_STAMP__: JSON.stringify(stamp) },
    banner: { js: `/* yosched-engine-worker ${JSON.stringify(stamp)} */` },
    logLevel: "error",
  });
  fs.renameSync(tmp, out);
  fs.renameSync(webTmp, webOut);
} catch (e) {
  fs.rmSync(tmp, { force: true });
  fs.rmSync(webTmp, { force: true });
  console.error(`build-engine-worker: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
// Only now, with the new browser bundle in place: remove the older ones (an old tab asking for
// one gets a 404 and runs its Live edits on the main thread).
for (const f of fs.readdirSync(webDir)) {
  if (f !== webName && /^engine-worker-[0-9a-f]{4,40}\.js$/.test(f)) fs.rmSync(path.join(webDir, f), { force: true });
}
console.log(`build-engine-worker: ${path.relative(root, out)}, ${path.relative(root, webOut)} (${version} ${commit})`);
