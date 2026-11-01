#!/usr/bin/env node
/**
 * One-off codemod: attach `pageMetadata(...)` to each static public page.
 *
 * It replaces a page's `export const metadata` block with a `pageMetadata({ title, description, path })`
 * call, copying title and description text verbatim — no copy is rewritten. Run once; the file is
 * deliberately not wired into package.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PAGES = [
  ["src/app/(site)/page.tsx", "/", true],
  ["src/app/(site)/about/page.tsx", "/about"],
  ["src/app/(site)/become-a-supplier/page.tsx", "/become-a-supplier"],
  ["src/app/(site)/contact/page.tsx", "/contact"],
  ["src/app/(site)/faqs/page.tsx", "/faqs"],
  ["src/app/(site)/how-it-works/page.tsx", "/how-it-works"],
  ["src/app/(site)/industries/page.tsx", "/industries"],
  ["src/app/(site)/privacy/page.tsx", "/privacy"],
  ["src/app/(site)/quality-assurance/page.tsx", "/quality-assurance"],
  ["src/app/(site)/request-a-quote/page.tsx", "/request-a-quote"],
  ["src/app/(site)/scrap-metals/page.tsx", "/scrap-metals"],
  ["src/app/(site)/sell-scrap/page.tsx", "/sell-scrap"],
  ["src/app/(site)/source-scrap/page.tsx", "/source-scrap"],
  ["src/app/(site)/spare-parts/page.tsx", "/spare-parts"],
  ["src/app/(site)/terms/page.tsx", "/terms"],
  ["src/app/(site)/trading-models/page.tsx", "/trading-models"],
];

const BLOCK = /export const metadata: Metadata = \{[\s\S]*?\n\};\n/;

let changed = 0;
for (const [file, path, isHome] of PAGES) {
  const full = join(process.cwd(), file);
  const src = readFileSync(full, "utf8");

  const match = src.match(BLOCK);
  if (!match) {
    console.error(`SKIP ${file} — no metadata block`);
    continue;
  }
  if (src.includes("pageMetadata(")) {
    console.error(`SKIP ${file} — already converted`);
    continue;
  }

  const block = match[0];
  const titleMatch = block.match(/title:\s*("(?:[^"\\]|\\.)*")/);
  const descMatch = block.match(/description:\s*\n?\s*("(?:[^"\\]|\\.)*")/);
  if (!titleMatch || !descMatch) {
    console.error(`SKIP ${file} — title/description not found`);
    continue;
  }

  // Home page title is the site default; keep it explicit so nothing loses meaning.
  const replacement = [
    "export const metadata: Metadata = pageMetadata({",
    `  title: ${titleMatch[1]},`,
    `  description: ${descMatch[1]},`,
    `  path: ${JSON.stringify(path)},`,
    isHome ? '  type: "website",' : null,
    "});",
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");

  let next = src.replace(block, replacement);
  // Add the import directly after the last existing "@/lib/..." import, else after `next` imports.
  if (!next.includes('from "@/lib/seo"')) {
    const importLine = 'import { pageMetadata } from "@/lib/seo";\n';
    const lastLibImport = [...next.matchAll(/^import [\s\S]*?from "@\/lib\/[^"]+";\n/gm)].pop();
    if (lastLibImport) {
      const at = lastLibImport.index + lastLibImport[0].length;
      next = next.slice(0, at) + importLine + next.slice(at);
    } else {
      const lastImport = [...next.matchAll(/^import .*;$/gm)].pop();
      const at = lastImport.index + lastImport[0].length;
      next = `${next.slice(0, at)}\n${importLine}${next.slice(at)}`;
    }
  }

  writeFileSync(full, next);
  changed += 1;
  console.log(`ok   ${file}`);
}
console.log(`\nconverted ${changed} pages`);