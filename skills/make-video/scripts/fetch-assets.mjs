#!/usr/bin/env node
// Stage 3 — ASSETS: resolves a storyboard asset manifest into local files.
// Usage: node fetch-assets.mjs <manifest.json> --dest <assets-dir> [--strict]
//
// Manifest entries (array):
//   { "type": "icon",  "set": "lucide", "name": "rocket", "out": "icons/rocket.svg", "color": "#5eead4" }
//   { "type": "brand", "slug": "github", "out": "icons/github.svg", "color": "ffffff" }
//   { "type": "image", "provider": "pixabay", "query": "city night aerial", "out": "img/city.jpg", "orientation": "vertical" }
//   { "type": "imagegen", "prompt": "isometric illustration of …", "out": "gen/hero.png", "size": "1024x1536" }
//   { "type": "gif",   "query": "mind blown", "out": "gifs/mind-blown.mp4" }          // Giphy/Tenor (key) — saved as mp4
//   { "type": "meme",  "template": "Drake Hotline Bling", "out": "memes/drake.jpg" }  // imgflip templates, keyless
//   { "type": "video", "query": "typing on laptop", "out": "vid/typing.mp4", "orientation": "landscape", "max_s": 15 }
//   { "type": "sfx",   "name": "whoosh", "out": "sfx/whoosh.mp3" }                          // layer 1: bundled library (no key)
//   { "type": "sfx",   "query": "cash register", "out": "sfx/cash.mp3", "max_s": 3 }        // layer 2: Freesound CC0 (key)
//   { "type": "web",   "url": "https://…/file.png", "out": "img/chart.png",
//     "license": "CC-BY 4.0", "source": "https://…/page" }                            // license fields REQUIRED
//   { "type": "capture", "url": "https://myapp.dev", "out": "demo/tour.mp4",
//     "actions": [{ "scroll": { "by": 900, "duration": 1500 } }], "width": 1280, "height": 800 }
//
// Sources: Iconify (keyless), simple-icons CDN (keyless), imgflip templates (keyless),
// Pixabay images+videos (PIXABAY_API_KEY), Pexels images+videos (PEXELS_API_KEY),
// Giphy (GIPHY_API_KEY) / Tenor (TENOR_API_KEY), Freesound CC0 (FREESOUND_API_KEY),
// OpenAI image gen (OPENAI_API_KEY, opt-in via IMAGE_GEN=openai),
// live browser capture via capture-demo.mjs (system Chrome).
// imagegen default: write a .prompt.json sidecar — the composition renders a styled placeholder slot.
// Everything is vendored locally with license sidecars; compositions must never hotlink
// (determinism contract — the only network is at BUILD time, right here).

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname, resolve, sep, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

export const FETCH_TIMEOUT_MS = 20_000;
export const MAX_RESPONSE_BYTES = 25_000_000;

// `out` comes from an LLM-authored manifest — clamp it inside dest (path traversal guard).
export function safePath(dest, out) {
  if (isAbsolute(out)) throw new Error(`absolute out path rejected: ${out}`);
  const p = resolve(dest, out);
  if (p !== dest && !p.startsWith(dest + sep)) throw new Error(`out path escapes assets dir: ${out}`);
  return p;
}

function save(ctx, out, data) {
  const p = safePath(ctx.dest, out);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
  return p;
}

// API keys travel in the query string (Pixabay, Giphy, Tenor, Freesound): never let them reach an
// error message — those land in the console, manifest.resolved.json and the model's context.
const SECRET_PARAMS = ["key", "api_key", "apikey", "token", "access_token", "client_secret"];
export function redactUrl(url) {
  try {
    const u = new URL(String(url));
    for (const p of SECRET_PARAMS) if (u.searchParams.has(p)) u.searchParams.set(p, "REDACTED");
    return u.toString();
  } catch {
    return String(url).replace(/([?&](?:key|api_key|apikey|token|access_token|client_secret)=)[^&]*/gi, "$1REDACTED");
  }
}

async function fetchOk(ctx, url, init = {}) {
  const timeout = init.timeoutMs ?? FETCH_TIMEOUT_MS;
  const r = await ctx.fetchImpl(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${redactUrl(url)}`);
  const len = +(r.headers.get("content-length") || 0);
  if (len > MAX_RESPONSE_BYTES) throw new Error(`response too large (${len} bytes) — ${redactUrl(url)}`);
  return r;
}

// Manifests are LLM-authored: only http(s), and never loopback/private/link-local hosts
// (cloud metadata, intranet) unless the caller opts in (capture may demo http://localhost).
export function assertSafeUrl(raw, { allowLocal = false } = {}) {
  let u;
  try { u = new URL(String(raw)); } catch { throw new Error(`invalid URL: ${redactUrl(raw)}`); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`only http(s) URLs are allowed (got ${u.protocol}) — ${redactUrl(raw)}`);
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const local = h === "localhost" || h.endsWith(".localhost") || h === "::1" || h === "::" ||
    /^(127|10|0)\./.test(h) || /^169\.254\./.test(h) || /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^(fc|fd|fe80)/.test(h) || h.endsWith(".internal");
  if (local && !allowLocal) throw new Error(`local/private address refused — ${redactUrl(raw)}`);
  return u;
}

// binary download with the size cap enforced on the ACTUAL bytes (content-length may
// be absent) and a generous timeout — stock videos/gifs routinely outlive 20s.
async function fetchBuf(ctx, url, init = {}) {
  const r = await fetchOk(ctx, url, { timeoutMs: 120_000, ...init });
  if (!r.body || typeof r.body.getReader !== "function") {
    const buf = await r.arrayBuffer();
    if (buf.byteLength > MAX_RESPONSE_BYTES) throw new Error(`response too large (${buf.byteLength} bytes) — ${redactUrl(url)}`);
    return Buffer.from(buf);
  }
  // stream with a running byte cap, so a response without content-length cannot exhaust memory
  const chunks = [];
  let total = 0;
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`response too large (> ${MAX_RESPONSE_BYTES} bytes) — ${redactUrl(url)}`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

async function icon(e, ctx) {
  // Iconify: 275k+ icons, keyless. color is applied via ?color= for monotone sets.
  const color = e.color ? `?color=${encodeURIComponent(e.color)}` : "";
  const url = `https://api.iconify.design/${encodeURIComponent(e.set)}/${encodeURIComponent(e.name)}.svg${color}`;
  const svg = await (await fetchOk(ctx, url)).text();
  if (!svg.includes("<svg")) throw new Error(`not an svg: ${url}`);
  return save(ctx, e.out, svg);
}

async function brand(e, ctx) {
  // simple-icons: brand logos, CC0 (trademarks still apply). color = hex without '#'.
  const url = `https://cdn.simpleicons.org/${encodeURIComponent(e.slug)}${e.color ? "/" + encodeURIComponent(e.color.replace("#", "")) : ""}`;
  const svg = await (await fetchOk(ctx, url)).text();
  return save(ctx, e.out, svg);
}

// One vocabulary in the manifest (landscape | portrait/vertical | square), mapped per provider.
const norm = (o) => ({ horizontal: "landscape", landscape: "landscape", vertical: "portrait", portrait: "portrait", square: "square" })[String(o || "").toLowerCase()] || null;
const pixabayOrientation = (o) => ({ landscape: "horizontal", portrait: "vertical" })[norm(o)] || "all";
const pexelsOrientation = (o) => norm(o) || "landscape";

async function image(e, ctx) {
  const provider = e.provider || (ctx.env.PIXABAY_API_KEY ? "pixabay" : "pexels");
  if (provider === "pixabay") {
    const key = ctx.env.PIXABAY_API_KEY;
    if (!key) throw new Error("PIXABAY_API_KEY not set");
    const u = new URL("https://pixabay.com/api/");
    u.searchParams.set("key", key);
    u.searchParams.set("q", e.query);
    u.searchParams.set("image_type", "photo");
    u.searchParams.set("orientation", pixabayOrientation(e.orientation));
    u.searchParams.set("safesearch", "true");
    u.searchParams.set("per_page", "5");
    const j = await (await fetchOk(ctx, u)).json();
    const hit = j.hits?.[0];
    if (!hit) throw new Error(`no pixabay results for "${e.query}"`);
    const img = await fetchBuf(ctx, hit.largeImageURL);
    save(ctx, e.out + ".credit.json", JSON.stringify({
      source: hit.pageURL, provider: "Pixabay",
      license: "Pixabay Content License (free use, no attribution required)",
    }, null, 2));
    return save(ctx, e.out, img);
  }
  if (provider === "pexels") {
    const key = ctx.env.PEXELS_API_KEY;
    if (!key) throw new Error("PEXELS_API_KEY not set");
    const u = new URL("https://api.pexels.com/v1/search");
    u.searchParams.set("query", e.query);
    u.searchParams.set("orientation", pexelsOrientation(e.orientation));
    u.searchParams.set("per_page", "5");
    const j = await (await fetchOk(ctx, u, { headers: { Authorization: key } })).json();
    const hit = j.photos?.[0];
    if (!hit) throw new Error(`no pexels results for "${e.query}"`);
    const img = await fetchBuf(ctx, hit.src.large2x);
    save(ctx, e.out + ".credit.json", JSON.stringify({ photographer: hit.photographer, url: hit.url, source: "Pexels" }, null, 2));
    return save(ctx, e.out, img);
  }
  throw new Error(`unknown image provider: ${provider}`);
}

async function imagegen(e, ctx) {
  if (ctx.imageGen === "openai" && ctx.env.OPENAI_API_KEY) {
    const r = await fetchOk(ctx, "https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: ctx.env.IMAGE_GEN_MODEL || "gpt-image-1-mini",
        prompt: e.prompt,
        size: e.size || "1024x1024",
        n: 1,
      }),
    });
    const j = await r.json();
    const b64 = j.data?.[0]?.b64_json;
    if (!b64) throw new Error("no image in response");
    return save(ctx, e.out, Buffer.from(b64, "base64"));
  }
  // placeholder mode: sidecar carries the prompt; the composition renders a styled slot.
  return save(ctx, e.out + ".prompt.json", JSON.stringify({ prompt: e.prompt, size: e.size || "1024x1024", status: "placeholder" }, null, 2));
}

async function gif(e, ctx) {
  // Saved as MP4 when the provider offers it (smaller, loops cleanly as a <video> clip).
  if (ctx.env.GIPHY_API_KEY) {
    const u = new URL("https://api.giphy.com/v1/gifs/search");
    u.searchParams.set("api_key", ctx.env.GIPHY_API_KEY);
    u.searchParams.set("q", e.query);
    u.searchParams.set("limit", "5");
    u.searchParams.set("rating", e.rating || "pg");
    const j = await (await fetchOk(ctx, u)).json();
    const hit = j.data?.[0];
    if (!hit) throw new Error(`no giphy results for "${e.query}"`);
    const mp4 = hit.images?.original_mp4?.mp4;
    const media = mp4 || hit.images?.original?.url;
    const out = mp4 ? e.out : e.out.replace(/\.mp4$/, ".gif"); // container must match extension
    const buf = await fetchBuf(ctx, media);
    save(ctx, e.out + ".credit.json", JSON.stringify({
      title: hit.title, source: hit.url, provider: "Giphy",
      license: "Giphy library content — see Giphy ToS; attribution badge recommended",
    }, null, 2));
    return save(ctx, out, buf);
  }
  if (ctx.env.TENOR_API_KEY) {
    const u = new URL("https://tenor.googleapis.com/v2/search");
    u.searchParams.set("key", ctx.env.TENOR_API_KEY);
    u.searchParams.set("q", e.query);
    u.searchParams.set("limit", "5");
    u.searchParams.set("media_filter", "mp4,gif");
    const j = await (await fetchOk(ctx, u)).json();
    const hit = j.results?.[0];
    if (!hit) throw new Error(`no tenor results for "${e.query}"`);
    const mp4t = hit.media_formats?.mp4?.url;
    const media = mp4t || hit.media_formats?.gif?.url;
    const out = mp4t ? e.out : e.out.replace(/\.mp4$/, ".gif");
    const buf = await fetchBuf(ctx, media);
    save(ctx, e.out + ".credit.json", JSON.stringify({
      title: hit.content_description, source: hit.itemurl, provider: "Tenor",
      license: "Tenor library content — see Tenor ToS",
    }, null, 2));
    return save(ctx, out, buf);
  }
  throw new Error("GIPHY_API_KEY or TENOR_API_KEY not set (both have free tiers)");
}

async function meme(e, ctx) {
  // imgflip's template catalog is keyless. We vendor the TEMPLATE — the composition
  // overlays the caption text itself (sharper, on-palette, and animatable).
  const j = await (await fetchOk(ctx, "https://api.imgflip.com/get_memes")).json();
  if (!j.success) throw new Error("imgflip get_memes failed");
  const want = e.template.toLowerCase();
  const hit = j.data.memes.find(m => m.name.toLowerCase() === want)
    || j.data.memes.find(m => m.name.toLowerCase().includes(want));
  if (!hit) throw new Error(`no imgflip template matching "${e.template}" — browse https://imgflip.com/memetemplates`);
  const buf = await fetchBuf(ctx, hit.url);
  save(ctx, e.out + ".credit.json", JSON.stringify({
    template: hit.name, source: `https://imgflip.com/meme/${hit.id}`, provider: "imgflip",
    license: "Meme template — rights vary by underlying image; user assumes editorial-use responsibility",
    boxCount: hit.box_count,
  }, null, 2));
  return save(ctx, e.out, Buffer.from(buf));
}

async function video(e, ctx) {
  const provider = e.provider || (ctx.env.PEXELS_API_KEY ? "pexels" : "pixabay");
  if (provider === "pexels") {
    const key = ctx.env.PEXELS_API_KEY;
    if (!key) throw new Error("PEXELS_API_KEY not set");
    const u = new URL("https://api.pexels.com/videos/search");
    u.searchParams.set("query", e.query);
    u.searchParams.set("orientation", pexelsOrientation(e.orientation));
    u.searchParams.set("per_page", "10");
    const j = await (await fetchOk(ctx, u, { headers: { Authorization: key } })).json();
    const hit = (j.videos || []).find(v => !e.max_s || v.duration <= e.max_s) || j.videos?.[0];
    if (!hit) throw new Error(`no pexels videos for "${e.query}"`);
    const files = (hit.video_files || []).filter(f => f.file_type === "video/mp4")
      .sort((a, b) => (b.width || 0) - (a.width || 0));
    const file = files.find(f => (f.width || 0) <= 1920) || files[files.length - 1];
    if (!file) throw new Error(`pexels video ${hit.id} has no mp4 rendition`);
    const buf = await fetchBuf(ctx, file.link);
    save(ctx, e.out + ".credit.json", JSON.stringify({
      videographer: hit.user?.name, source: hit.url, provider: "Pexels",
      license: "Pexels License (free use, no attribution required)", duration_s: hit.duration,
    }, null, 2));
    return save(ctx, e.out, buf);
  }
  if (provider === "pixabay") {
    const key = ctx.env.PIXABAY_API_KEY;
    if (!key) throw new Error("PIXABAY_API_KEY not set");
    const u = new URL("https://pixabay.com/api/videos/");
    u.searchParams.set("key", key);
    u.searchParams.set("q", e.query);
    u.searchParams.set("safesearch", "true");
    u.searchParams.set("per_page", "10");
    const j = await (await fetchOk(ctx, u)).json();
    const hit = (j.hits || []).find(v => !e.max_s || v.duration <= e.max_s) || j.hits?.[0];
    if (!hit) throw new Error(`no pixabay videos for "${e.query}"`);
    const file = hit.videos?.large?.url || hit.videos?.medium?.url || hit.videos?.small?.url;
    const buf = await fetchBuf(ctx, file);
    save(ctx, e.out + ".credit.json", JSON.stringify({
      source: hit.pageURL, provider: "Pixabay",
      license: "Pixabay Content License (free use, no attribution required)", duration_s: hit.duration,
    }, null, 2));
    return save(ctx, e.out, buf);
  }
  throw new Error(`unknown video provider: ${provider}`);
}

// SFX in two layers (both vendored; the composition never hotlinks):
//  1. `name`  → bundled media-use library (21 curated Pixabay-license files, no key, no network).
//  2. `query` → Freesound CC0 search; takes the top results by relevance and picks the best
//     rated / most downloaded one (objective tie-break, no model tokens, no blind results[0]).
const SFX_LIB_DIRS = [".agents/skills/media-use/audio/assets/sfx", ".claude/skills/media-use/audio/assets/sfx"];

function sfxLibrary(ctx) {
  const base = ctx.root || process.cwd();
  for (const d of ctx.sfxLib ? [ctx.sfxLib] : SFX_LIB_DIRS.map((x) => resolve(base, x))) {
    const mf = join(d, "manifest.json");
    if (!existsSync(mf)) continue;
    const m = JSON.parse(readFileSync(mf, "utf8"));
    return { dir: d, items: m.sounds ?? m };
  }
  return null;
}

const slug = (s) => String(s).toLowerCase().replace(/\.mp3$/, "").trim().replace(/[\s_]+/g, "-");

function sfxFromLibrary(e, ctx) {
  const lib = sfxLibrary(ctx);
  if (!lib) throw new Error("sfx library not found — run `npx skills add heygen-com/hyperframes --all` (media-use)");
  const key = Object.keys(lib.items).find((k) => slug(k) === slug(e.name));
  if (!key) throw new Error(`no bundled sfx "${e.name}" — available: ${Object.keys(lib.items).join(", ")}; or use "query" for Freesound`);
  const file = lib.items[key].file || `${key}.mp3`;
  const p = safePath(ctx.dest, e.out);
  mkdirSync(dirname(p), { recursive: true });
  copyFileSync(join(lib.dir, file), p);
  save(ctx, e.out + ".credit.json", JSON.stringify({
    name: key, provider: "media-use bundled library (Pixabay)", license: "Pixabay Content License",
    source: "https://pixabay.com/service/license-summary/", duration_s: lib.items[key].duration ?? null,
  }, null, 2));
  return p;
}

async function sfxFromFreesound(e, ctx) {
  const key = ctx.env.FREESOUND_API_KEY;
  if (!key) throw new Error("FREESOUND_API_KEY not set (free at freesound.org/apiv2/apply) — or use a bundled `name`");
  const u = new URL("https://freesound.org/apiv2/search/text/");
  u.searchParams.set("query", e.query);
  u.searchParams.set("filter", `license:"Creative Commons 0"${e.max_s ? ` duration:[0 TO ${e.max_s}]` : ""}`);
  u.searchParams.set("fields", "id,name,username,license,previews,url,duration,avg_rating,num_ratings,num_downloads");
  u.searchParams.set("sort", "score");
  u.searchParams.set("page_size", "8");
  u.searchParams.set("token", key);
  const j = await (await fetchOk(ctx, u)).json();
  const results = j.results || [];
  if (!results.length) throw new Error(`no CC0 freesound results for "${e.query}"`);
  const quality = (r) => (r.num_ratings >= 2 ? r.avg_rating : 0) * 1e6 + (r.num_downloads || 0);
  const hit = [...results].sort((a, b) => quality(b) - quality(a))[0];
  const buf = await fetchBuf(ctx, hit.previews["preview-hq-mp3"]);
  save(ctx, e.out + ".credit.json", JSON.stringify({
    name: hit.name, author: hit.username, source: hit.url, provider: "Freesound",
    license: "CC0 1.0", duration_s: hit.duration, avg_rating: hit.avg_rating, downloads: hit.num_downloads,
  }, null, 2));
  return save(ctx, e.out, buf);
}

async function sfx(e, ctx) {
  if (e.name) return sfxFromLibrary(e, ctx);
  if (e.query) return sfxFromFreesound(e, ctx);
  throw new Error('sfx entry needs "name" (bundled library) or "query" (Freesound)');
}

async function web(e, ctx) {
  // Arbitrary web download — the escape hatch for anything found by media research.
  // License provenance is NOT optional: refuse entries that don't carry it.
  if (!e.url) throw new Error("web asset needs url");
  if (!e.license || !e.source) {
    throw new Error(`web asset "${e.out}" missing license/source — record where it came from and under what terms, or use a provider type`);
  }
  assertSafeUrl(e.url);
  const buf = await fetchBuf(ctx, e.url);
  save(ctx, e.out + ".credit.json", JSON.stringify({
    source: e.source, directUrl: e.url, license: e.license, note: e.note || null,
  }, null, 2));
  return save(ctx, e.out, buf);
}

async function capture(e, ctx) {
  // Live browser demonstration (any URL, incl. http://localhost — local app demos).
  assertSafeUrl(e.url, { allowLocal: true }); // http(s) only; localhost is the point of a local demo
  const { captureDemo } = await import("./capture-demo.mjs");
  const outPath = safePath(ctx.dest, e.out);
  mkdirSync(dirname(outPath), { recursive: true });
  const result = await captureDemo({
    url: e.url,
    actions: { steps: e.actions || [] },
    out: outPath,
    width: e.width || 1280,
    height: e.height || 800,
  });
  save(ctx, e.out + ".credit.json", JSON.stringify({
    source: e.url, provider: "live capture (playwright + system Chrome)",
    license: "own recording — subject to the captured site's content rights",
    duration_s: result.duration,
  }, null, 2));
  return outPath;
}

const handlers = { icon, brand, image, imagegen, gif, meme, video, sfx, web, capture };

// Resolve every manifest entry; never throws — failures land in results as status:"error".
export async function resolveManifest(manifest, ctx) {
  ctx = { fetchImpl: globalThis.fetch, env: process.env, imageGen: "placeholder", ...ctx };
  mkdirSync(ctx.dest, { recursive: true });
  const results = [];
  for (const e of manifest) {
    const h = handlers[e.type];
    try {
      if (!h) throw new Error(`unknown asset type: ${e.type}`);
      const p = await h(e, ctx);
      results.push({ ...e, status: "ok", path: p });
      ctx.quiet || console.log(`✓ ${e.type} ${e.out}`);
    } catch (err) {
      results.push({ ...e, status: "error", error: String(err.message || err) });
      ctx.quiet || console.error(`✗ ${e.type} ${e.out}: ${err.message}`);
    }
  }
  writeFileSync(join(ctx.dest, "manifest.resolved.json"), JSON.stringify(results, null, 2));
  return results;
}

// --strict: any failure is fatal (CI / transcript-locked contexts). Default: all-fail only.
export function exitCode(results, strict) {
  const failed = results.filter(r => r.status === "error").length;
  return failed && (strict || failed === results.length) ? 1 : 0;
}

async function main() {
  const args = process.argv.slice(2);
  const manifestPath = args[0];
  const destIdx = args.indexOf("--dest");
  const dest = resolve(destIdx > -1 ? args[destIdx + 1] : "assets");
  const strict = args.includes("--strict");
  if (!manifestPath) {
    console.error("usage: node fetch-assets.mjs <manifest.json> --dest <assets-dir> [--strict]");
    process.exit(1);
  }
  if (!existsSync(manifestPath)) {
    console.error(`manifest not found: ${manifestPath}`);
    process.exit(1);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    console.error(`manifest is not valid JSON: ${manifestPath} — ${e.message}`);
    process.exit(1);
  }
  const results = await resolveManifest(manifest, { dest, imageGen: process.env.IMAGE_GEN || "placeholder" });
  const failed = results.filter(r => r.status === "error").length;
  console.log(`${results.length - failed}/${results.length} assets resolved → ${dest}`);
  process.exit(exitCode(results, strict));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
