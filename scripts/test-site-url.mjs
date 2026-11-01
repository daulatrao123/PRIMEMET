#!/usr/bin/env node
/**
 * Decision 1 tests: production NEXT_PUBLIC_APP_URL validation.
 *
 * Part A imports the production validator itself (src/lib/site-url.ts — Node strips the types).
 * Part B (`--build`) runs real `next build` with missing, invalid and localhost values and asserts
 * the build exits non-zero with the validator's message — i.e. that next.config.ts really gates the
 * build. It does not run a successful build: that one is the normal `npm run build`.
 */
import { spawnSync } from "node:child_process";
import { resolveSiteUrl, isLoopbackHost, SiteUrlError, DEV_SITE_URL } from "../src/lib/site-url.ts";

let passed = 0;
const failures = [];
const ok = (cond, label) => (cond ? passed++ : failures.push(label));

function throws(fn, pattern) {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof SiteUrlError && pattern.test(e.message);
  }
}

/* ---- Production: rejected ------------------------------------------------------------------ */
const P = "production";
ok(throws(() => resolveSiteUrl(undefined, P), /required/), "prod: missing → throws 'required'");
ok(throws(() => resolveSiteUrl("", P), /required/), "prod: empty → throws");
ok(throws(() => resolveSiteUrl("   ", P), /required/), "prod: whitespace → throws");
ok(throws(() => resolveSiteUrl("not a url", P), /not a valid absolute URL/), "prod: garbage → invalid");
ok(throws(() => resolveSiteUrl("www.primemet.com", P), /not a valid absolute URL/), "prod: no scheme → invalid");
ok(throws(() => resolveSiteUrl("ftp://primemet.com", P), /https/), "prod: ftp → rejected");
ok(throws(() => resolveSiteUrl("http://www.primemet.com", P), /https in production/), "prod: plain http → rejected");
ok(throws(() => resolveSiteUrl("https://localhost", P), /loopback/), "prod: https://localhost → rejected");
ok(throws(() => resolveSiteUrl("http://localhost:3000", P), /https in production|loopback/), "prod: http://localhost:3000 → rejected");
ok(throws(() => resolveSiteUrl("https://127.0.0.1", P), /loopback/), "prod: 127.0.0.1 → rejected");
ok(throws(() => resolveSiteUrl("https://127.8.9.10:8443", P), /loopback/), "prod: 127.x → rejected");
ok(throws(() => resolveSiteUrl("https://[::1]", P), /loopback/), "prod: ::1 → rejected");
ok(throws(() => resolveSiteUrl("https://0.0.0.0", P), /loopback/), "prod: 0.0.0.0 → rejected");
ok(throws(() => resolveSiteUrl("https://app.localhost", P), /loopback/), "prod: *.localhost → rejected");
ok(throws(() => resolveSiteUrl("https://LOCALHOST.", P), /loopback/), "prod: LOCALHOST. → rejected");
ok(throws(() => resolveSiteUrl("https://user:pw@primemet.com", P), /credentials/), "prod: credentials → rejected");
ok(throws(() => resolveSiteUrl("https://primemet.com/site", P), /origin only/), "prod: path → rejected");
ok(throws(() => resolveSiteUrl("https://primemet.com/?a=1", P), /origin only/), "prod: query → rejected");

/* ---- Production: accepted ------------------------------------------------------------------ */
ok(resolveSiteUrl("https://www.primemet.com", P) === "https://www.primemet.com", "prod: valid https accepted");
ok(resolveSiteUrl("https://www.primemet.com/", P) === "https://www.primemet.com", "prod: trailing slash normalised");
ok(resolveSiteUrl("  https://WWW.Primemet.com  ", P) === "https://www.primemet.com", "prod: trimmed + lower-cased host");
ok(resolveSiteUrl("https://primemet.com:8443", P) === "https://primemet.com:8443", "prod: explicit port kept");

/* ---- Development / test: localhost allowed --------------------------------------------------- */
ok(resolveSiteUrl(undefined, "development") === DEV_SITE_URL, "dev: missing → localhost");
ok(resolveSiteUrl(undefined, "test") === DEV_SITE_URL, "test: missing → localhost");
ok(resolveSiteUrl("http://localhost:3000", "development") === "http://localhost:3000", "dev: localhost accepted");
ok(resolveSiteUrl("http://127.0.0.1:4000", "development") === "http://127.0.0.1:4000", "dev: 127.0.0.1 accepted");
ok(throws(() => resolveSiteUrl("nonsense", "development"), /not a valid/), "dev: garbage still rejected");

/* ---- Loopback helper ---------------------------------------------------------------------- */
ok(!isLoopbackHost("primemet.com"), "loopback: public host is not loopback");
ok(!isLoopbackHost("localhost-images.com"), "loopback: localhost-prefixed domain is not loopback");
ok(!isLoopbackHost("128.0.0.1"), "loopback: 128.0.0.1 is not loopback");

/* ---- Part B: real builds ------------------------------------------------------------------- */
if (process.argv.includes("--build")) {
  const cases = [
    ["missing", undefined, /required for production builds/],
    ["invalid", "not-a-url", /not a valid absolute URL/],
    ["localhost", "http://localhost:3000", /https in production|loopback/],
    ["127.0.0.1", "https://127.0.0.1", /loopback/],
  ];
  for (const [name, value, pattern] of cases) {
    const env = { ...process.env };
    delete env.NEXT_PUBLIC_APP_URL;
    if (value !== undefined) env.NEXT_PUBLIC_APP_URL = value;
    const r = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["--no-install", "next", "build"], {
      env, encoding: "utf8", shell: process.platform === "win32", timeout: 180_000,
    });
    const out = `${r.stdout}\n${r.stderr}`;
    ok(r.status !== 0, `build ${name}: exits non-zero (got ${r.status})`);
    ok(pattern.test(out), `build ${name}: reports the validator message`);
    ok(!/Generating static pages/.test(out), `build ${name}: fails before any page is generated`);
  }
}

console.log(`test-site-url: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(failures.length ? 1 : 0);
