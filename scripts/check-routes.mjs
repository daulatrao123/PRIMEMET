#!/usr/bin/env node
/**
 * Route and internal-link integrity check.
 *
 * No test framework is installed in Stage 1, so this script provides the automated
 * structural check: every required route file exists, no two route groups produce the
 * same URL, and every internal `href="/..."` points at a route that exists.
 *
 * Run with: npm.cmd run check:routes
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const APP_DIR = join(ROOT, "src", "app");

/** Routes Stage 1 must ship. */
const REQUIRED = [
  "/",
  "/about",
  "/scrap-metals",
  "/scrap-metals/[slug]",
  "/spare-parts",
  "/spare-parts/[slug]",
  "/sell-scrap",
  "/source-scrap",
  "/request-a-quote",
  "/how-it-works",
  "/industries",
  "/become-a-supplier",
  "/faqs",
  "/contact",
  "/privacy",
  "/terms",
  "/login",
  "/admin/login",
  "/register/buyer",
  "/register/seller",
  "/admin/dashboard",
  "/admin/enquiries",
  "/admin/suppliers",
  "/admin/buyers",
  "/admin/materials",
  "/admin/products",
  "/admin/pricing",
  "/admin/supplier-quotations",
  "/admin/quotations",
  "/admin/reports",
  "/admin/audit-log",
  "/buyer/dashboard",
  "/buyer/enquiries/new",
  "/buyer/scrap-sourcing",
  "/buyer/spare-parts",
  "/buyer/quotations",
  "/buyer/orders",
  "/buyer/profile",
  "/seller/dashboard",
  "/seller/profile",
  "/seller/tax",
  "/seller/materials",
  "/seller/products",
  "/seller/quotations",
  "/seller/enquiries",
  "/seller/orders",
];

/** Files that are not routes but live under src/app. */
const NON_ROUTE_FILES = new Set([
  "layout.tsx",
  "template.tsx",
  "loading.tsx",
  "error.tsx",
  "global-error.tsx",
  "not-found.tsx",
  "globals.css",
]);

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Directory segments → URL path, dropping route groups such as (site). */
function toRoute(file) {
  const rel = relative(APP_DIR, file).split(sep);
  const segments = rel.slice(0, -1).filter((s) => !/^\(.*\)$/.test(s));
  const name = rel[rel.length - 1];

  if (name === "page.tsx") {
    return segments.length ? `/${segments.join("/")}` : "/";
  }
  if (name === "route.ts") {
    return `/api${segments.length ? `/${segments.join("/")}` : ""}`;
  }
  return null;
}

const files = walk(APP_DIR);
const routeEntries = [];
const problems = [];

for (const file of files) {
  const base = file.split(sep).pop();
  if (NON_ROUTE_FILES.has(base)) continue;
  const route = toRoute(file);
  if (route) routeEntries.push({ route, file: relative(ROOT, file) });
}

const routes = new Set(routeEntries.map((entry) => entry.route));

// 1. Required routes present
for (const required of REQUIRED) {
  if (!routes.has(required)) problems.push(`MISSING ROUTE  ${required}`);
}

// 2. No duplicate URLs across route groups
const seen = new Map();
for (const entry of routeEntries) {
  if (seen.has(entry.route)) {
    problems.push(`DUPLICATE ROUTE  ${entry.route}  →  ${seen.get(entry.route)} and ${entry.file}`);
  } else {
    seen.set(entry.route, entry.file);
  }
}

// 3. Internal links resolve
const sourceFiles = walk(join(ROOT, "src")).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
const hrefPattern = /href=(?:"|\{`)((?:\/(?!\/)[^"`}]*))(?:`|")/g;
const staticRoutes = new Set([...routes].filter((r) => !r.includes("[")));

for (const file of sourceFiles) {
  const text = readFileSync(file, "utf8");
  let match;
  while ((match = hrefPattern.exec(text)) !== null) {
    const href = match[1];
    if (href.startsWith("//") || href.startsWith("/#")) continue; // external / anchor
    if (href.includes("${")) continue; // template literal, checked separately

    const path = href.split("#")[0].split("?")[0];
    if (!path || path === "/") continue;

    const resolved =
      staticRoutes.has(path) ||
      staticRoutes.has(path.replace(/\/$/, "")) ||
      [...staticRoutes].some((route) => {
        // /scrap-metals/[slug] style match for a concrete slug link
        if (!route.includes("[")) return false;
        const routeParts = route.split("/");
        const pathParts = path.split("/");
        if (routeParts.length !== pathParts.length) return false;
        return routeParts.every((part, i) => part.startsWith("[") || part === pathParts[i]);
      });

    if (!resolved) {
      problems.push(`BROKEN LINK  href="${href}"  in ${relative(ROOT, file)}`);
    }
  }
}

const summary = `routes: ${routes.size}  required: ${REQUIRED.length}  source files scanned: ${sourceFiles.length}`;

if (problems.length) {
  console.error(`\n✗ ${problems.length} problem(s) found\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(`\n${summary}\n`);
  process.exit(1);
}

console.log(`\n✓ all route and link checks passed — ${summary}\n`);
