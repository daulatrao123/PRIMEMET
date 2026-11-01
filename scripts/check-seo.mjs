#!/usr/bin/env node
/**
 * Phase 3 — technical SEO assertions against the running production server.
 *
 * Deliberately dependency-free, matching the other checks in this repo. Run against `next start`:
 *
 *   SMOKE_BASE=http://127.0.0.1:3100 node scripts/check-seo.mjs
 *
 * What it proves:
 *   - the sitemap contains exactly the public URLs that exist, and nothing else;
 *   - every sitemap URL is reachable and self-canonical;
 *   - every public page carries a unique title, a usable description, one canonical, Open Graph and
 *     a Twitter card, and is indexable;
 *   - the portal and auth areas are noindex and appear nowhere in the sitemap;
 *   - robots.txt allows crawling, disallows the non-public prefixes and advertises the sitemap;
 *   - structured data parses, and no page declares a Product, price, rating or review that the
 *     catalogue cannot support.
 *
 * It cannot prove ranking, indexing or traffic: those require Google's own evidence.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Two modes, identical assertions:
 *   default        reads the prerendered output in `.next/server/app` — writes nothing
 *   SMOKE_BASE=…   fetches a running server, for checking a deployed environment
 *
 * The artefact mode is the default because `next start` writes `.next/server/route-cache` on every
 * request: a server-based check would mutate the build it is supposed to be verifying.
 */
const SERVER_BASE = process.env.SMOKE_BASE?.replace(/\/+$/, "") ?? null;
const BUILD_DIR = join(process.cwd(), ".next", "server", "app");

if (!SERVER_BASE && !existsSync(BUILD_DIR)) {
  console.error(`No build output at ${BUILD_DIR}. Run \`npm run build\` first, or set SMOKE_BASE.`);
  process.exit(2);
}

/**
 * Origin resolution — deterministic, and independent of the shell.
 *
 * The expected origin must be the one the build actually used, otherwise every canonical assertion
 * fails against a correct build. Node does not load `.env.local`, so a developer with no exported
 * variable would otherwise be compared against a hardcoded default. The layers are therefore:
 *
 *   1. EXPECTED_ORIGIN          explicit override, for CI and ad-hoc checks
 *   2. SMOKE_BASE               the server under test, in server mode
 *   3. NEXT_PUBLIC_APP_URL      the same variable `next build` reads
 *   4. .env.local / .env.production / .env   read directly, in the order Next.js loads them
 *   5. PRODUCTION_ORIGIN        the documented production origin, as .env.example records it
 *
 * There is no loopback fallback: a check that silently expected http://localhost:3000 would report a
 * failure on a healthy build, which is what this replaces.
 */
const PRODUCTION_ORIGIN = "https://primemet.in";

function claimOrigin(value) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  let origin;
  try {
    origin = new URL(trimmed);
  } catch {
    return null;
  }
  if (origin.protocol !== "http:" && origin.protocol !== "https:") return null;
  return trimmed.replace(/\/+$/, "");
}

function readEnvFileOrigin(name) {
  try {
    const text = readFileSync(join(process.cwd(), name), "utf8");
    const match = text.match(/^NEXT_PUBLIC_APP_URL\s*=(.*)$/m);
    if (!match) return null;
    return match[1].replace(/(^|\s)#.*$/, "").trim().replace(/^["']|["']$/g, "");
  } catch {
    return null;
  }
}

function resolveExpectedOrigin() {
  const candidates = [
    ["EXPECTED_ORIGIN", process.env.EXPECTED_ORIGIN],
    ["SMOKE_BASE", SERVER_BASE],
    ["NEXT_PUBLIC_APP_URL", process.env.NEXT_PUBLIC_APP_URL],
  ];
  for (const [source, value] of candidates) {
    const origin = claimOrigin(value);
    if (origin) return { origin, source };
  }
  for (const file of [".env.local", ".env.production", ".env"]) {
    const origin = claimOrigin(readEnvFileOrigin(file));
    if (origin) return { origin, source: file };
  }
  return { origin: PRODUCTION_ORIGIN, source: "documented production origin" };
}

const { origin: ORIGIN, source: ORIGIN_SOURCE } = resolveExpectedOrigin();
console.log(`expected origin: ${ORIGIN} (from ${ORIGIN_SOURCE})`);

let pass = 0;
let fail = 0;
const failures = [];

function ok() {
  pass += 1;
}
function bad(name, detail) {
  fail += 1;
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}
function assert(name, condition, detail) {
  if (condition) ok(name);
  else bad(name, detail);
}

function artefactFor(path) {
  const clean = path.replace(/^\/+/, "").replace(/\/+$/, "");
  if (clean === "") return { file: join(BUILD_DIR, "index.html") };
  const html = join(BUILD_DIR, `${clean}.html`);
  if (existsSync(html)) return { file: html };
  const body = join(BUILD_DIR, `${clean}.body`); // sitemap.xml and robots.txt payloads
  if (existsSync(body)) return { body };
  return {};
}

async function fetchText(path) {
  if (SERVER_BASE) {
    const res = await fetch(SERVER_BASE + path, { redirect: "manual" });
    return { status: res.status, body: await res.text(), headers: res.headers };
  }

  const artefact = artefactFor(path);
  if (artefact.file) {
    return {
      status: 200,
      body: readFileSync(artefact.file, "utf8"),
      headers: new Headers({ "content-type": "text/html" }),
    };
  }
  if (artefact.body) {
    const type = path.endsWith(".xml") ? "application/xml" : "text/plain";
    return {
      status: 200,
      body: readFileSync(artefact.body, "utf8"),
      headers: new Headers({ "content-type": type }),
    };
  }
  return { status: 404, body: "", headers: new Headers() };
}

/* ------------------------------------------------------------------ */
/* 1. Expected public routes, derived from the filesystem + content    */
/* ------------------------------------------------------------------ */

const APP = join(process.cwd(), "src", "app");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === "page.tsx") out.push(full);
  }
  return out;
}

function slugsIn(file) {
  const src = readFileSync(join(process.cwd(), file), "utf8");
  // `slug: "..."` entries inside the exported catalogue arrays.
  return [...src.matchAll(/^\s+slug:\s*"([^"]+)"/gm)].map((m) => m[1]);
}

const SITE_DIR = join(APP, "(site)");
const sitePages = walk(SITE_DIR);
const materialSlugs = slugsIn("src/lib/content/materials.ts");
const partSlugs = slugsIn("src/lib/content/parts.ts");

const expected = new Set();
for (const page of sitePages) {
  const rel = page.slice(SITE_DIR.length).replace(/\\/g, "/").replace(/\/page\.tsx$/, "");
  if (rel.includes("[")) continue; // expanded from the content modules below
  expected.add(rel === "" ? "/" : rel);
}
for (const slug of materialSlugs) expected.add(`/scrap-metals/${slug}`);
for (const slug of partSlugs) expected.add(`/spare-parts/${slug}`);

assert("expected: content modules discovered", materialSlugs.length > 0 && partSlugs.length > 0,
  `materials=${materialSlugs.length} parts=${partSlugs.length}`);

/* ------------------------------------------------------------------ */
/* 2. Sitemap                                                          */
/* ------------------------------------------------------------------ */

const sitemap = await fetchText("/sitemap.xml");
assert("sitemap: 200", sitemap.status === 200, String(sitemap.status));
assert("sitemap: content-type xml", /xml/.test(sitemap.headers.get("content-type") ?? ""),
  sitemap.headers.get("content-type") ?? "none");

const locs = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
assert("sitemap: is a urlset", /<urlset[\s>]/.test(sitemap.body));
assert("sitemap: has entries", locs.length > 0, String(locs.length));

// Exactly one entry per expected URL: no duplicates, no omissions, nothing extra.
const sitemapPaths = locs.map((url) => {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/\/$/, "") || "/";
  } catch {
    return url;
  }
});
assert("sitemap: no duplicate URLs", new Set(sitemapPaths).size === sitemapPaths.length,
  `${sitemapPaths.length} entries, ${new Set(sitemapPaths).size} unique`);

const missing = [...expected].filter((p) => !sitemapPaths.includes(p));
const extra = sitemapPaths.filter((p) => !expected.has(p));
assert("sitemap: every public page present", missing.length === 0, missing.join(", "));
assert("sitemap: no unexpected URL", extra.length === 0, extra.join(", "));

// Absolute, same-origin URLs only.
assert("sitemap: all URLs absolute and same-origin",
  locs.every((url) => url.startsWith(`${ORIGIN}/`) || url === ORIGIN),
  locs.find((url) => !url.startsWith(ORIGIN)) ?? "");

// Portal, auth and API routes must never leak in.
const privatePrefixes = ["/admin", "/buyer", "/seller", "/api", "/login", "/register"];
const leaked = sitemapPaths.filter((p) => privatePrefixes.some((x) => p === x || p.startsWith(`${x}/`)));
assert("sitemap: no admin/buyer/seller/api/auth URLs", leaked.length === 0, leaked.join(", "));

// No trailing-slash duplicates and no query strings.
assert("sitemap: no query strings", locs.every((url) => !url.includes("?")),
  locs.find((url) => url.includes("?")) ?? "");

/* ------------------------------------------------------------------ */
/* 3. robots.txt                                                       */
/* ------------------------------------------------------------------ */

const robots = await fetchText("/robots.txt");
assert("robots: 200", robots.status === 200, String(robots.status));
assert("robots: allows crawling root", /^Allow:\s*\/\s*$/m.test(robots.body),
  robots.body.slice(0, 120));
assert("robots: does not disallow everything", !/^Disallow:\s*\/\s*$/m.test(robots.body));

for (const prefix of privatePrefixes) {
  assert(`robots: disallows ${prefix}`,
    new RegExp(`^Disallow:\\s*${prefix}\\s*$`, "m").test(robots.body));
}
assert("robots: advertises sitemap", /^Sitemap:\s*https?:\/\/\S+\/sitemap\.xml\s*$/m.test(robots.body),
  robots.body);

/* ------------------------------------------------------------------ */
/* 4. Per-page metadata                                                */
/* ------------------------------------------------------------------ */

function head(html) {
  const at = html.indexOf("</head>");
  return at === -1 ? html : html.slice(0, at);
}

function metaContents(h, attr, value) {
  const re = new RegExp(`<meta[^>]*${attr}="${value}"[^>]*content="([^"]*)"`, "g");
  const reReversed = new RegExp(`<meta[^>]*content="([^"]*)"[^>]*${attr}="${value}"`, "g");
  return [...[...h.matchAll(re)].map((m) => m[1]), ...[...h.matchAll(reReversed)].map((m) => m[1])];
}

function canonicalOf(h) {
  const m = h.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/) ??
    h.match(/<link[^>]*href="([^"]+)"[^>]*rel="canonical"/);
  return m ? m[1] : null;
}

function titleOf(h) {
  const m = h.match(/<title>([^<]*)<\/title>/);
  return m ? m[1] : null;
}

const titles = new Map();
const canonicals = new Map();
let productSchemas = 0;
let jsonLdBlocks = 0;
const jsonLdTypes = new Map();

const publicPages = [...expected].sort();

for (const path of publicPages) {
  const page = await fetchText(path);
  assert(`page ${path}: 200`, page.status === 200, String(page.status));
  if (page.status !== 200) continue;

  const h = head(page.body);

  const title = titleOf(h);
  assert(`page ${path}: has title`, Boolean(title && title.trim().length > 0));
  if (title) {
    const seen = titles.get(title);
    assert(`page ${path}: title unique`, !seen, seen ? `duplicate of ${seen}` : "");
    titles.set(title, path);
  }

  const description = metaContents(h, "name", "description")[0];
  assert(`page ${path}: has description`, Boolean(description && description.length >= 50),
    description ? `${description.length} chars` : "missing");
  assert(`page ${path}: description <= 320 chars`,
    Boolean(description && description.length <= 320), String(description?.length));

  const canonical = canonicalOf(h);
  assert(`page ${path}: exactly one canonical`,
    (h.match(/rel="canonical"/g) ?? []).length === 1,
    String((h.match(/rel="canonical"/g) ?? []).length));
  assert(`page ${path}: canonical is self-referential`,
    canonical === `${ORIGIN}${path === "/" ? "" : path}` || canonical === `${ORIGIN}/` && path === "/",
    `${canonical} vs ${ORIGIN}${path}`);
  if (canonical) {
    const seen = canonicals.get(canonical);
    assert(`page ${path}: canonical unique`, !seen, seen ? `duplicate of ${seen}` : "");
    canonicals.set(canonical, path);
  }

  assert(`page ${path}: og:title`, metaContents(h, "property", "og:title").length === 1);
  assert(`page ${path}: og:description`, metaContents(h, "property", "og:description").length === 1);
  assert(`page ${path}: og:url matches canonical`,
    metaContents(h, "property", "og:url")[0] === canonical,
    `${metaContents(h, "property", "og:url")[0]} vs ${canonical}`);
  assert(`page ${path}: og:site_name`, metaContents(h, "property", "og:site_name")[0] === "PRIMEMET",
    metaContents(h, "property", "og:site_name")[0]);
  assert(`page ${path}: og:type`, Boolean(metaContents(h, "property", "og:type")[0]));
  assert(`page ${path}: twitter:card`, Boolean(metaContents(h, "name", "twitter:card")[0]));

  // Indexability: in the sitemap ⇒ must be indexable, and must not be blocked by a meta noindex.
  const robotsMeta = metaContents(h, "name", "robots").join(",");
  assert(`page ${path}: indexable`, !/noindex/.test(robotsMeta), robotsMeta || "no robots meta");
  assert(`page ${path}: has h1`, /<h1[\s>]/.test(page.body));

  // Alt text on every image.
  const imgs = [...page.body.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  assert(`page ${path}: every img has alt`,
    imgs.every((tag) => /\balt="/.test(tag)),
    imgs.find((tag) => !/\balt="/.test(tag)) ?? "");

  // Structured data must parse and must not assert unsupported commerce facts.
  const blocks = [...page.body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const [, raw] of blocks) {
    jsonLdBlocks += 1;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      bad(`page ${path}: JSON-LD parses`, String(error));
      continue;
    }
    assert(`page ${path}: JSON-LD has @context`, parsed["@context"] === "https://schema.org");
    const type = parsed["@type"];
    assert(`page ${path}: JSON-LD has @type`, Boolean(type));
    jsonLdTypes.set(type, (jsonLdTypes.get(type) ?? 0) + 1);
    if (type === "Product") productSchemas += 1;
    if (type === "Product") {
      assert(`page ${path}: Product declares an offer`, Boolean(parsed.offers));
    }
  }

  // No invented commerce or rating markup, anywhere.
  assert(`page ${path}: no price markup`, !/"price"\s*:/.test(page.body),
    "page declares a price");
  assert(`page ${path}: no rating/review markup`,
    !/"aggregateRating"\s*:/.test(page.body) && !/"review"\s*:/.test(page.body));
}

/* ------------------------------------------------------------------ */
/* 5. Structured data coverage by page type                            */
/* ------------------------------------------------------------------ */

assert("structured data: no Product markup while prices are unpublished", productSchemas === 0,
  `${productSchemas} Product blocks`);
assert("structured data: Organization present", (jsonLdTypes.get("Organization") ?? 0) === 1,
  String(jsonLdTypes.get("Organization") ?? 0));
assert("structured data: WebSite present", (jsonLdTypes.get("WebSite") ?? 0) === 1,
  String(jsonLdTypes.get("WebSite") ?? 0));

const home = await fetchText("/");
const homeBlocks = [...home.body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .map(([, raw]) => JSON.parse(raw));
const org = homeBlocks.find((b) => b["@type"] === "Organization");
assert("home: Organization has name/url/logo",
  Boolean(org?.name && org?.url && org?.logo?.url), JSON.stringify(org ?? {}).slice(0, 120));
assert("home: Organization publishes no unverified contact",
  !org?.telephone && !org?.address && !org?.email,
  "contact detail present without a confirmed value");

const site = homeBlocks.find((b) => b["@type"] === "WebSite");
assert("home: WebSite has publisher and language",
  Boolean(site?.publisher?.["@id"] && site?.inLanguage));
assert("home: no SearchAction (no on-site search exists)", !site?.potentialAction);

// Breadcrumbs on interior pages, matching the visible trail.
for (const path of ["/scrap-metals", "/scrap-metals/heavy-melting-scrap", "/spare-parts/bearings-and-seals", "/about"]) {
  const page = await fetchText(path);
  const block = [...page.body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map(([, raw]) => JSON.parse(raw))
    .find((b) => b["@type"] === "BreadcrumbList");

  assert(`breadcrumb ${path}: present`, Boolean(block));
  if (!block) continue;

  const items = block.itemListElement ?? [];
  assert(`breadcrumb ${path}: starts at Home`,
    items[0]?.name === "Home" &&
      [ORIGIN, `${ORIGIN}/`].includes(items[0]?.item ?? ""),
    JSON.stringify(items[0] ?? {}));
  assert(`breadcrumb ${path}: positions are 1..n`,
    items.every((item, index) => item.position === index + 1));

  // The visible trail renders each crumb as a <li> in the breadcrumb nav.
  const navMatch = page.body.match(/<nav aria-label="Breadcrumb"[\s\S]*?<\/nav>/);
  const visible = navMatch ? (navMatch[0].match(/<li\b/g) ?? []).length : 0;
  assert(`breadcrumb ${path}: markup matches visible trail`, visible === items.length,
    `visible ${visible} vs markup ${items.length}`);
}

/* ------------------------------------------------------------------ */
/* 6. Non-public areas                                                 */
/* ------------------------------------------------------------------ */

for (const path of ["/admin/dashboard", "/buyer/dashboard", "/seller/dashboard", "/login", "/admin/login", "/register/buyer"]) {
  const page = await fetchText(path);
  assert(`noindex ${path}: 200`, page.status === 200, String(page.status));
  const robotsMeta = metaContents(head(page.body), "name", "robots").join(",");
  assert(`noindex ${path}: marked noindex`, /noindex/.test(robotsMeta), robotsMeta || "none");
}

/* ------------------------------------------------------------------ */
/* 7. Crawl plumbing                                                   */
/* ------------------------------------------------------------------ */

const unknown = await fetchText("/this-route-does-not-exist");
assert("unknown route returns 404", unknown.status === 404, String(unknown.status));

// Every sitemap URL is reachable — the sitemap must not advertise a dead page.
let dead = 0;
for (const path of publicPages) {
  const res = await fetchText(path);
  if (res.status !== 200) dead += 1;
}
assert("every sitemap URL returns 200", dead === 0, `${dead} unreachable`);

// No duplicated origin in canonical (a classic metadataBase bug).
for (const path of publicPages.slice(0, 5)) {
  const page = await fetchText(path);
  const canonical = canonicalOf(head(page.body));
  assert(`canonical ${path}: single origin`, Boolean(canonical) && !canonical.includes(`${ORIGIN}${ORIGIN}`),
    canonical ?? "");
}

/* ------------------------------------------------------------------ */

console.log(`\nSEO checks: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`\nmode: ${SERVER_BASE ? `server ${SERVER_BASE}` : `prerendered build output`}`);
console.log(`public URLs in sitemap: ${publicPages.length}`);
console.log(`JSON-LD blocks parsed: ${jsonLdBlocks} (${[...jsonLdTypes].map(([t, n]) => `${t}×${n}`).join(", ")})`);