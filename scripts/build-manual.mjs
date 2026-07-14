#!/usr/bin/env node
// Convert docs/USER-MANUAL.md -> src/app/manual/manual-html.ts (a TS module that
// exports the styled, standalone HTML as a string). The Markdown is the single
// source of truth; the /manual route imports the string and serves it after a
// manual:view permission check. We emit a bundled module rather than a loose file
// because the app deploys as a Next.js standalone build (process.cwd() is
// .next/standalone), so a runtime fs read of a repo path would not resolve in prod.
// Re-run after editing the manual:  node scripts/build-manual.mjs
import { readFile, writeFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "docs", "USER-MANUAL.md");
const OUT = join(ROOT, "src", "app", "manual", "manual-html.ts");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// GitHub-style heading slug (so in-document #anchor links resolve).
const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/^\s+|\s+$/g, "")
    .replace(/\s/g, "-");

function inline(s) {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return out;
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function parseTable(lines, start) {
  let i = start;
  const header = splitRow(lines[i]); i += 2; // header + separator
  const rows = [];
  while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
  let html = "<table><thead><tr>" + header.map((h) => `<th>${inline(h)}</th>`).join("") + "</tr></thead><tbody>";
  for (const r of rows) html += "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>";
  html += "</tbody></table>";
  return { html, i };
}

function parseList(lines, start) {
  // Build a tree first, then render — so each item's text (including soft-wrapped
  // continuation lines) is joined BEFORE inline() runs. Inlining per physical line
  // would split a **bold** span across a wrap and corrupt the pairing.
  const re = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
  let i = start;
  const root = { children: [] };
  const stack = []; // { indent, list }
  const top = () => (stack.length ? stack[stack.length - 1].list : null);
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") break;
    const m = re.exec(line);
    if (!m) { // soft-wrapped continuation of the current item
      const t = top();
      if (t && t.items.length) { t.items[t.items.length - 1].text += " " + line.trim(); i++; continue; }
      break;
    }
    const indent = m[1].length;
    const type = /\d+\./.test(m[2]) ? "ol" : "ul";
    const content = m[3];
    if (!stack.length) {
      const list = { type, items: [] }; root.children.push(list); stack.push({ indent, list });
      list.items.push({ text: content, child: null });
    } else if (indent > stack[stack.length - 1].indent) {
      const parent = top(); const parentItem = parent.items[parent.items.length - 1];
      const list = { type, items: [] }; parentItem.child = list; stack.push({ indent, list });
      list.items.push({ text: content, child: null });
    } else if (indent === stack[stack.length - 1].indent) {
      top().items.push({ text: content, child: null });
    } else {
      while (stack.length && indent < stack[stack.length - 1].indent) stack.pop();
      if (!stack.length) {
        const list = { type, items: [] }; root.children.push(list); stack.push({ indent, list });
        list.items.push({ text: content, child: null });
      } else top().items.push({ text: content, child: null });
    }
    i++;
  }
  const render = (list) => {
    let h = `<${list.type}>`;
    for (const it of list.items) h += "<li>" + inline(it.text) + (it.child ? render(it.child) : "") + "</li>";
    return h + `</${list.type}>`;
  };
  let html = "";
  for (const c of root.children) html += render(c);
  return { html, i };
}

function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let html = "";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i++; continue; }

    let m;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      const level = m[1].length;
      const text = m[2].trim();
      const id = slug(text);
      // Brand the title's "YoSched" like the site logo: "Yo" in the heading color,
      // "Sched" in the accent blue. inline() has already run esc(), so "YoSched" is a
      // plain literal here — a string replace can't collide with escaped markup.
      let rendered = inline(text);
      if (level === 1) rendered = rendered.replace(/YoSched/g, 'Yo<span class="brand">Sched</span>');
      html += `<h${level} id="${id}">${rendered}<a class="anchor" href="#${id}" aria-hidden="true">#</a></h${level}>`;
      i++; continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { html += "<hr>"; i++; continue; }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, "")); i++; }
      html += `<blockquote><p>${inline(buf.join(" "))}</p></blockquote>`;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const r = parseTable(lines, i); html += r.html; i = r.i; continue;
    }
    if (/^(\s*)([-*]|\d+\.)\s+/.test(line)) {
      const r = parseList(lines, i); html += r.html; i = r.i; continue;
    }
    // paragraph
    const buf = [];
    while (i < lines.length && lines[i].trim() !== "" &&
      !/^(#{1,6})\s+/.test(lines[i]) && !/^(-{3,}|\*{3,})\s*$/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) && !/^(\s*)([-*]|\d+\.)\s+/.test(lines[i]) &&
      !(/^\s*\|.*\|\s*$/.test(lines[i]) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1]))) {
      buf.push(lines[i]); i++;
    }
    html += `<p>${inline(buf.join(" "))}</p>`;
  }
  return html;
}

const CSS = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: #0f172a; color: #cbd5e1;
  font: 16px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.topbar { position: sticky; top: 0; z-index: 10; background: #0b1220ee; backdrop-filter: blur(6px);
  border-bottom: 1px solid #334155; padding: 12px 24px; font-weight: 700; color: #e2e8f0; }
.topbar span { color: #63b3ed; }
.brand { color: #63b3ed; }
main { max-width: 860px; margin: 0 auto; padding: 32px 24px 96px; }
h1, h2, h3, h4 { color: #f1f5f9; line-height: 1.25; scroll-margin-top: 64px; }
h1 { font-size: 2rem; margin: 0 0 .5rem; }
h2 { font-size: 1.5rem; margin: 2.5rem 0 1rem; padding-bottom: .3rem; border-bottom: 1px solid #334155; }
h3 { font-size: 1.2rem; margin: 1.8rem 0 .6rem; color: #e2e8f0; }
h4 { font-size: 1.02rem; margin: 1.3rem 0 .4rem; color: #cbd5e1; }
a { color: #63b3ed; text-decoration: none; }
a:hover { text-decoration: underline; }
.anchor { margin-left: .4rem; color: #475569; opacity: 0; font-weight: 400; }
h1:hover .anchor, h2:hover .anchor, h3:hover .anchor, h4:hover .anchor { opacity: 1; }
p { margin: .7rem 0; }
ul, ol { margin: .6rem 0; padding-left: 1.5rem; }
li { margin: .25rem 0; }
li > ul, li > ol { margin: .25rem 0; }
code { background: #1e293b; border: 1px solid #334155; border-radius: 4px; padding: .08em .35em;
  font: .85em ui-monospace, SFMono-Regular, Menlo, monospace; color: #e2e8f0; }
strong { color: #f1f5f9; }
hr { border: none; border-top: 1px solid #1e293b; margin: 2rem 0; }
blockquote { margin: 1rem 0; padding: .6rem 1rem; background: #15213a;
  border-left: 3px solid #3b82f6; border-radius: 0 6px 6px 0; color: #b6c2d4; }
blockquote p { margin: 0; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: .92rem; display: block; overflow-x: auto; }
th, td { border: 1px solid #334155; padding: .5rem .7rem; text-align: left; vertical-align: top; }
th { background: #1e293b; color: #e2e8f0; font-weight: 600; }
tr:nth-child(even) td { background: #131c30; }
.totop { position: fixed; right: 20px; bottom: 20px; background: #1e293b; border: 1px solid #475569;
  color: #cbd5e1; border-radius: 8px; padding: 8px 12px; font-size: .85rem; }
.totop:hover { background: #334155; text-decoration: none; }
`;

const md = await readFile(SRC, "utf8");
const body = mdToHtml(md);
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>YoSched — User Manual</title>
<style>${CSS}</style>
</head>
<body>
<div class="topbar">Yo<span>Sched</span> — User Manual</div>
<main>${body}</main>
<a class="totop" href="#top">↑ Top</a>
</body>
</html>
`;

const module = `/* eslint-disable */
// AUTO-GENERATED from docs/USER-MANUAL.md by scripts/build-manual.mjs — do not edit.
// Re-run \`node scripts/build-manual.mjs\` after editing the manual.
export const MANUAL_HTML = ${JSON.stringify(page)};
`;

await writeFile(OUT, module, "utf8");
console.log(`Wrote ${OUT} (${module.length} bytes) from ${SRC}`);
