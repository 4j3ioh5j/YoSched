#!/usr/bin/env node
// Card #235: every release raises the version (Settings › About YoSched shows it).
// Usage: check-release-version.mjs <head sha> <released sha> <head version> <released version>
//   exit 0  head is the released commit (a re-deploy), or its version is higher
//   exit 1  a new commit with the same or a lower version: raise it first
//   exit 2  missing or malformed input — never treated as a pass
const [head, released, headVer, releasedVer] = process.argv.slice(2);
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const fail = (code, msg) => { process.stderr.write(`check-release-version: ${msg}\n`); process.exit(code); };

if (!head || !released || !headVer || !releasedVer) fail(2, "need <head sha> <released sha> <head version> <released version>");
const a = SEMVER.exec(headVer), b = SEMVER.exec(releasedVer);
if (!a || !b) fail(2, `versions must look like 1.2.3 (got "${headVer}" and "${releasedVer}")`);
if (head === released) process.exit(0);

const cmp = [1, 2, 3].map((i) => Number(a[i]) - Number(b[i])).find((d) => d !== 0) ?? 0;
if (cmp > 0) process.exit(0);
const next = `${b[1]}.${Number(b[2]) + 1}.0`;
fail(1, `version ${headVer} is not higher than the released ${releasedVer}. Set "version" in package.json to ${next} and commit it with this release.`);
