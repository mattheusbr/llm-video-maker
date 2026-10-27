#!/usr/bin/env node
// One-shot VALIDATE gate: a single `hyperframes check --json` (lint + runtime + layout + contrast + craft in one
// browser session), printed as one compact report so the model fixes everything in a single pass.
// Usage: node check.mjs <project-dir> [--engine <version>]
// Exit code: 0 = clean, 1 = something to fix.

import { spawnSync } from "node:child_process";
import { basename, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
const engineIdx = args.indexOf("--engine");
// Default engine = the version installed in this project (same one `render` uses); fallback to the pin.
function installedEngine() {
  try {
    return JSON.parse(readFileSync(join("node_modules", "hyperframes", "package.json"), "utf8")).version;
  } catch {
    return "0.8.206";
  }
}
const engine = engineIdx >= 0 ? args[engineIdx + 1] : installedEngine();
if (!dir) {
  console.error("usage: node check.mjs <project-dir> [--engine <version>]");
  process.exit(2);
}

const r = spawnSync("npx", [`hyperframes@${engine}`, "check", dir, "--json"], {
  encoding: "utf8",
  shell: process.platform === "win32",
  maxBuffer: 64 * 1024 * 1024,
});
const out = (r.stdout || "").trim();
const start = out.indexOf("{");
const end = out.lastIndexOf("}");
let res;
try {
  if (start < 0 || end < start) throw new Error("no JSON");
  res = JSON.parse(out.slice(start, end + 1));
} catch {
  console.log(`CHECK: crashed — ${(r.stderr || out || "no output").slice(0, 400)}`);
  process.exit(1);
}

const cut = (s, n = 160) => (s && s.length > n ? s.slice(0, n) + "…" : s || "");

// <project>/check.ignore: selectors (comma or line separated) the audits cannot judge: text on an <img>/SVG card
// (contrast cannot be sampled; verify the colour pair by hand) and elements that bleed or enter on purpose.
// Only list a selector after seeing it fine in the snapshot; never to silence a real overflow.
const ignoreFile = join(dir, "check.ignore");
const ignored = new Set(existsSync(ignoreFile) ? readFileSync(ignoreFile, "utf8").split(/[,\n]/).map((x) => x.trim()).filter(Boolean) : []);

const lines = [];
let bad = 0;
const seen = new Set();
for (const section of ["lint", "runtime", "layout", "motion", "contrast", "craft", "audio"]) {
  for (const f of res[section]?.findings || []) {
    if (f.selector && ignored.has(f.selector)) continue;
    const sev = f.severity || "info";
    if (section === "lint") {
      const key = `${f.code}|${f.sourceFile}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    if (sev === "error" || (section === "layout" && sev === "warning") || (section === "contrast" && sev !== "info")) bad++;
    const where = f.sourceFile ? basename(f.sourceFile) : f.selector || "";
    const at = f.time != null ? ` @${f.time}s` : "";
    const fix = sev === "error" ? ` | fix: ${cut(f.fixHint || f.suggestedColor || "")}` : "";
    lines.push(`${section.toUpperCase()} ${sev} ${f.code || ""} ${where}${at}: ${cut(f.message, 200)}${fix}`);
  }
}
// Fail closed: the gate said "not ok" (or the CLI failed) but no finding explained it.
if (!bad && (res.ok === false || r.status > 1)) {
  bad++;
  lines.push(`NOTE: hyperframes check reported ok=${res.ok} (exit ${r.status}) with no listed finding; run \`npx hyperframes@${engine} check ${dir}\` by hand`);
}
if (res.browserSkipped) lines.push("NOTE: browser audits skipped (fix the lint errors first; layout/contrast were not checked)");

console.log(bad ? `CHECK: ${bad} issue(s) to fix` : "CHECK: clean");
for (const l of lines) console.log(l);
process.exit(bad ? 1 : 0);
