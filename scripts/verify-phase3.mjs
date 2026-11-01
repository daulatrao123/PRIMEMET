#!/usr/bin/env node
/**
 * Independent Phase 3 (technical SEO) verification.
 *
 * Deliberately independent of `scripts/check-seo.mjs` and of `src/lib/seo.ts`: it imports no
 * project code and derives its expectations from two other sources —
 *   1. the filesystem (every `page.tsx` under `src/app/(site)`), and
 *   2. the built artefacts in `.next/server/app` (HTML, sitemap.xml, robots.txt).
 * If the SEO registry and the pages disagree, this script and check-seo.mjs fail differently.
 *
 * Usage:
 *   node scripts/verify-phase3.mjs                       artefact checks
 *   EXPECT_ORIGIN=https://example.com node ...            also require that exact origin
 *   SMOKE_BASE=http://127.0.0.1:3000 node ...             also check live HTTP status codes
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const APP = join(ROOT, ".next", "server", "app");
const SITE = join(ROOT, "src", "app", "(site)");
const EXPECT_ORIGIN = process.env.EXPECT_ORIGIN?.replace(/\/+$/, "");
const BASE = process.env.SMOKE_BASE?.replace(/\/+$/, "");

let passed = 0;
const failures = [];
const ok = (cond, label) => (cond ? passed++ : failures.push(label));

if (!existsSync(APP)) {
  console.error("No build output at .next/server/app — run `npm run build` first.");
  process.exit(2);
}

/* ---- 1. Expected public URLs from the filesystem ------------------------------------------ */
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const pageFiles = walk(SITE).filter((p) => p.endsWith(`${sep}page.tsx`));
const staticPaths = [];
const dynamicDirs = [];
for (const file of pageFiles) {
  const rel = relative(SITE, file).split(sep).slice(0, -1);
  if (rel.some((seg) => seg.startsWith("["))) dynamicDirs.push(rel);
  else staticPaths.push(rel.length ? `/${rel.join("/")}` : "/");
}
// Dynamic routes: expand from what the build actually prerendered.
const dynamicPaths = [];
for (const rel of dynamicDirs) {
  const parent = rel.slice(0, rel.findIndex((s) => s.startsWith("[")));
  const dir = join(APP, ...parent);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".html")) dynamicPaths.push(`/${[...parent, f.slice(0, -5)].join("/")}`);
  }
}
const expected = [...staticPaths, ...dynamicPaths].sort();
ok(staticPaths.length >= 16, `filesystem: at least 16 static public pages (found ${staticPaths.length})`);
ok(dynamicPaths.length >= 11, `build: at least 11 prerendered detail pages (found ${dynamicPaths.length})`);

/* ---- 2. robots.txt ------------------------------------------------------------------------ */
const robots = readFileSync(join(APP, "robots.txt.body"), "utf8");
const sitemapLine = robots.match(/^Sitemap:\s*(\S+)/m)?.[1];
const hostLine = robots.match(/^Host:\s*(\S+)/m)?.[1];
ok(Boolean(sitemapLine), "robots: has Sitemap line");
ok(/^User-Agent:\s*\*/m.test(robots), "robots: has User-Agent *");
for (const prefix of ["/admin", "/buyer", "/seller", "/api", "/login", "/register"]) {
  ok(new RegExp(`^Disallow:\\s*${prefix}$`, "m").test(robots), `robots: disallows ${prefix}`);
}
ok(!/^Disallow:\s*\/\s*$/m.test(robots), "robots: does not disallow the whole site");
const origin = sitemapLine ? new URL(sitemapLine).origin : "";
ok(hostLine === origin, "robots: Host equals Sitemap origin");

/* ---- 3. sitemap.xml ----------------------------------------------------------------------- */
const sitemap = readFileSync(join(APP, "sitemap.xml.body"), "utf8");
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const locPaths = locs.map((u) => new URL(u).pathname.replace(/\/$/, "") || "/").sort();
ok(locs.every((u) => new URL(u).origin === origin), "sitemap: every <loc> shares the robots origin");
ok(new Set(locs).size === locs.length, "sitemap: no duplicate <loc>");
ok(!/<lastmod>/.test(sitemap), "sitemap: no fabricated <lastmod>");
const missing = expected.filter((p) => !locPaths.includes(p));
const extra = locPaths.filter((p) => !expected.includes(p));
ok(missing.length === 0, `sitemap: lists every public page (missing: ${missing.join(", ") || "none"})`);
ok(extra.length === 0, `sitemap: lists nothing that is not a public page (extra: ${extra.join(", ") || "none"})`);
ok(!locPaths.some((p) => /^\/(admin|buyer|seller|api|login|register)(\/|$)/.test(p)), "sitemap: no non-public URL");

/* ---- 4. Origin policy --------------------------------------------------------------------- */
const LOOPBACK = /^(localhost|127(\.\d+){3}|0\.0\.0\.0|\[?::1\]?)$/i;
const host = origin ? new URL(origin).hostname : "";
const originIsProduction = origin.startsWith("https://") && !LOOPBACK.test(host);
if (EXPECT_ORIGIN) {
  ok(origin === EXPECT_ORIGIN, `origin: built origin ${origin} equals EXPECT_ORIGIN ${EXPECT_ORIGIN}`);
  ok(originIsProduction, `origin: ${origin} is https and not loopback`);
}

/* ---- 5. Per-page HTML --------------------------------------------------------------------- */
const htmlFile = (p) => join(APP, p === "/" ? "index.html" : `${p.slice(1)}.html`);
const titles = new Map();
for (const p of expected) {
  const file = htmlFile(p);
  if (!existsSync(file)) { failures.push(`html: ${p} has no prerendered file`); continue; }
  const html = readFileSync(file, "utf8");
  const canon = [...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map((m) => m[1]);
  ok(canon.length === 1, `html ${p}: exactly one canonical (found ${canon.length})`);
  if (canon[0]) {
    const cu = new URL(canon[0]);
    ok(cu.origin === origin, `html ${p}: canonical origin matches sitemap origin`);
    ok((cu.pathname.replace(/\/$/, "") || "/") === p, `html ${p}: canonical is self-referential`);
  }
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
  ok(title.length > 0, `html ${p}: has <title>`);
  if (titles.has(title)) failures.push(`html ${p}: duplicate title with ${titles.get(title)}`);
  else titles.set(title, p);
  ok(/<meta name="description" content="[^"]{50,}"/.test(html), `html ${p}: meta description >= 50 chars`);
  ok((html.match(/<h1[\s>]/g) ?? []).length === 1, `html ${p}: exactly one <h1>`);
  ok(!/name="robots" content="[^"]*noindex/.test(html), `html ${p}: not noindex`);
  for (const block of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let data;
    try { data = JSON.parse(block[1]); } catch { failures.push(`html ${p}: JSON-LD does not parse`); continue; }
    const s = JSON.stringify(data);
    ok(!/"@type":"(Product|Offer|AggregateRating|Review)"/.test(s), `html ${p}: no Product/Offer/Rating markup`);
    ok(!/"(price|telephone|aggregateRating)":/.test(s), `html ${p}: no price/telephone/rating fields`);
  }
}

/* ---- 6. Portal/auth pages are noindex ----------------------------------------------------- */
for (const p of ["/admin/dashboard", "/buyer/dashboard", "/seller/dashboard", "/login"]) {
  const file = htmlFile(p);
  if (!existsSync(file)) { failures.push(`noindex: ${p} not prerendered`); continue; }
  ok(/name="robots" content="[^"]*noindex/.test(readFileSync(file, "utf8")), `noindex: ${p}`);
}

/* ---- 7. Live status codes (optional) ------------------------------------------------------ */
if (BASE) {
  for (const p of [...expected, "/sitemap.xml", "/robots.txt"]) {
    const res = await fetch(`${BASE}${p}`, { redirect: "manual" });
    ok(res.status === 200, `http ${p}: 200 (got ${res.status})`);
  }
  const nf = await fetch(`${BASE}/definitely-not-a-page-${Date.now()}`);
  ok(nf.status === 404, `http unknown route: 404 (got ${nf.status})`);
}

console.log(`origin in build: ${origin}${originIsProduction ? "" : "  [NOT production-grade]"}`);
console.log(`expected public URLs: ${expected.length}  sitemap URLs: ${locs.length}`);
console.log(`verify-phase3: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(failures.length ? 1 : 0);
