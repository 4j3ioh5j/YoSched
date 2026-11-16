// Card #266: bundle the engine worker (src/lib/engine-worker-entry.ts) into one file next to the
// standalone server, stamped on its first line with the release it was built from (the same
// version and short commit next.config inlines, see src/lib/build-info.ts). The server's pool
// refuses a bundle from another release, so a stale bundle only means an inline trial.
//
//   node scripts/build-engine-worker.mjs [--out <file>] [--entry <file>]
//
// Exits non-zero (and leaves no output file) when the version or commit is unknown or the build
// fails, so `pnpm build` fails too.
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

let version = "";
let commit = "";
try { version = String(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version ?? "").trim(); } catch { /* reported below */ }
try { commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* reported below */ }
if (!version || !commit) {
  console.error(`build-engine-worker: cannot stamp the bundle (version "${version}", commit "${commit}")`);
  process.exit(1);
}

const tmp = `${out}.tmp-${process.pid}`;
try {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outfile: tmp,
    banner: { js: `/* yosched-engine-worker ${JSON.stringify({ version, commit })} */` },
    logLevel: "error",
  });
  fs.renameSync(tmp, out);
} catch (e) {
  fs.rmSync(tmp, { force: true });
  console.error(`build-engine-worker: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
console.log(`build-engine-worker: ${path.relative(root, out)} (${version} ${commit})`);
