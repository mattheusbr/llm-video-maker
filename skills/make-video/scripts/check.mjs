#!/usr/bin/env node
// One-shot VALIDATE gate: lint + validate (console + WCAG contrast) + inspect (layout),
// printed as one compact report so the model fixes everything in a single pass.
// Usage: node check.mjs <project-dir> [--engine 0.8.206]
// Exit code: 0 = clean, 1 = something to fix.

import { spawnSync } from "node:child_process";
import { basename } from "node:path";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
const engineIdx = args.indexOf("--engine");
const engine = engineIdx >= 0 ? args[engineIdx + 1] : "0.8.206";
if (!dir) {
  console.error("usage: node check.mjs <project-dir> [--engine 0.8.206]");
  process.exit(2);
}

function run(cmd) {
  const r = spawnSync("npx", [`hyperframes@${engine}`, cmd, dir, "--json"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = (r.stdout || "").trim();
  const start = out.indexOf("{");
  if (start < 0) return { crashed: (r.stderr || out || "no output").slice(0, 400) };
  try {
    return JSON.parse(out.slice(start));
  } catch {
    return { crashed: out.slice(0, 400) };
  }
}

const cut = (s, n = 160) => (s && s.length > n ? s.slice(0, n) + "…" : s || "");
const lines = [];
let bad = 0;

const lint = run("lint");
if (lint.crashed) {
  lines.push(`LINT crashed: ${lint.crashed}`);
  bad++;
} else {
  const seen = new Set();
  for (const f of lint.findings || []) {
    const key = `${f.code}|${f.file}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (f.severity === "error") bad++;
    lines.push(`LINT ${f.severity} ${f.code} ${basename(f.file || "")}: ${cut(f.message)}${f.severity === "error" ? ` | fix: ${cut(f.fixHint)}` : ""}`);
  }
}

const val = run("validate");
if (val.crashed) {
  lines.push(`VALIDATE crashed: ${val.crashed}`);
  bad++;
} else {
  for (const e of val.errors || []) {
    bad++;
    lines.push(`VALIDATE error: ${cut(typeof e === "string" ? e : JSON.stringify(e))}`);
  }
  for (const w of val.warnings || []) lines.push(`VALIDATE warn: ${cut(typeof w === "string" ? w : JSON.stringify(w))}`);
  const low = (val.contrast || []).filter((c) => c.wcagAA === false);
  for (const c of low) {
    bad++;
    lines.push(`CONTRAST ${c.ratio} @${c.time}s ${c.selector} "${cut(c.text, 40)}" fg ${c.fg} on ${c.bg}`);
  }
}

const insp = run("inspect");
if (insp.crashed) {
  lines.push(`INSPECT crashed: ${insp.crashed}`);
  bad++;
} else {
  for (const i of insp.issues || []) {
    if (i.severity !== "info") bad++;
    lines.push(`INSPECT ${i.severity || ""} ${cut(JSON.stringify(i), 240)}`);
  }
}

console.log(bad ? `CHECK: ${bad} issue(s) to fix` : "CHECK: clean");
for (const l of lines) console.log(l);
process.exit(bad ? 1 : 0);
