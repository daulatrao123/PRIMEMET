// Content assertions against the running production server.
//
// WHAT CHANGED AND WHY. This file was written in Stage 1, when the portal did not exist: it asserted
// that every portal page rendered a "Preview" label, that no page redirected, and that no form had an
// action. Those assertions described the Stage-1 application truthfully and describe this one falsely —
// 28 portal pages now require a session, the auth pages post to real API routes, and the wizard is
// driven by the catalogue rather than by a fixed preview. Re-baselining means asserting the behaviour
// that is now correct, not deleting the assertions: an anonymous request for an admin page must be
// redirected to the admin sign-in with its destination preserved, and an auth page must serve a working
// form. Nothing here is allowed to assert less than before about what a visitor is told.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

// ── Server precondition ─────────────────────────────────────────────────────────────────────────────
// This suite asserts against a RUNNING production server. It used to assume one and fail with a wall of
// connection errors when nobody had started it, which is a precondition reported as 180 defects. The
// precondition is now part of the check: if SMOKE_BASE is not given and nothing answers on :3100, the
// suite starts `next start` itself, waits for /api/health to answer, runs, and stops the server again —
// on success and on failure. A missing build is reported as a missing build.
const PORT = 3100;
const OWN_BASE = `http://127.0.0.1:${PORT}`;
let owned = null;

async function answering(url) {
  try {
    const res = await fetch(url, { redirect: "manual" });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await answering(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function stopOwned() {
  if (!owned) return;
  const child = owned;
  owned = null;
  try {
    child.kill();
  } catch {
    /* already gone */
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

if (!process.env.SMOKE_BASE && !(await answering(`${OWN_BASE}/api/health`))) {
  if (!existsSync(".next/BUILD_ID")) {
    console.error("no production build; run npm run build first");
    process.exit(1);
  }
  owned = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "production" },
  });
  let log = "";
  owned.stdout.on("data", (chunk) => {
    log += chunk;
  });
  owned.stderr.on("data", (chunk) => {
    log += chunk;
  });
  if (!(await waitForServer(`${OWN_BASE}/api/health`, 90_000))) {
    console.error("the application server did not become ready on :3100");
    console.error(log.slice(-2000));
    await stopOwned();
    process.exit(1);
  }
}

const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:3100";

let pass = 0;
let fail = 0;

function ok(name) {
  pass += 1;
  console.log(`ok   ${name}`);
}
function bad(name, detail) {
  fail += 1;
  console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

async function get(path) {
  const res = await fetch(BASE + path);
  return { status: res.status, html: await res.text() };
}

function assert(name, condition, detail) {
  if (condition) ok(name);
  else bad(name, detail);
}

// 1. Health endpoint shape
{
  const res = await fetch(`${BASE}/api/health`);
  const body = await res.json();
  assert("health: 200", res.status === 200, String(res.status));
  assert("health: status ok", body.status === "ok", body.status);
  assert("health: version string", typeof body.version === "string" && body.version.length > 0, body.version);
  assert("health: timestamp ISO", !Number.isNaN(Date.parse(body.timestamp)), body.timestamp);
  assert(
    "health: database state is one of the two defined values",
    ["not_configured", "connected"].includes(body.database),
    body.database,
  );
  assert("health: exactly 4 keys", Object.keys(body).length === 4, Object.keys(body).join(","));
}

// 2. Every portal page is closed to an anonymous visitor, and the destination survives the redirect.
//    A portal page that returned 200 without a session would be the defect now, not the preview label.
const portalAreas = [
  {
    login: "/admin/login",
    pages: [
      "/admin/dashboard", "/admin/enquiries", "/admin/enquiries/example", "/admin/suppliers", "/admin/buyers",
      "/admin/materials", "/admin/products", "/admin/pricing", "/admin/supplier-quotations",
      "/admin/quotation-preparation", "/admin/quotations", "/admin/reports", "/admin/audit-log",
    ],
  },
  {
    login: "/login",
    pages: [
      "/buyer/dashboard", "/buyer/enquiries/new", "/buyer/scrap-sourcing", "/buyer/spare-parts",
      "/buyer/quotations", "/buyer/orders", "/buyer/profile",
    ],
  },
  {
    login: "/login",
    pages: [
      "/seller/dashboard", "/seller/profile", "/seller/tax", "/seller/materials",
      "/seller/products", "/seller/quotations", "/seller/enquiries", "/seller/orders",
    ],
  },
];
{
  let checked = 0;
  for (const area of portalAreas) {
    for (const path of area.pages) {
      checked += 1;
      const res = await fetch(BASE + path, { redirect: "manual" });
      const location = res.headers.get("location") ?? "";
      assert(`${path}: not served to an anonymous visitor`, res.status === 307 || res.status === 302, String(res.status));
      assert(`${path}: redirected to ${area.login}`, location.startsWith(area.login), location || "no location");
      if (location !== area.login) {
        assert(`${path}: redirect keeps the requested destination`, /[?&]next=/.test(location), location);
      }
    }
  }
  ok(`portal pages checked for anonymous redirect (${checked})`);
}

// 3. Auth pages serve a working form that posts to the auth API, and never claim a session it did not
//    create. Stage 1 asserted a disabled preview with no `action`; that is no longer the design.
for (const [path, endpoint] of [
  ["/login", "/api/auth/login"],
  ["/admin/login", "/api/auth/login"],
  ["/register/buyer", "/api/auth/register"],
  ["/register/seller", "/api/auth/register"],
]) {
  const { status, html } = await get(path);
  assert(`${path}: responds 200`, status === 200, String(status));
  assert(`${path}: posts to ${endpoint}`, html.includes(`action="${endpoint}"`), "no auth action attribute");
  assert(`${path}: accepts an email`, /name="email"/.test(html));
  assert(`${path}: accepts a password`, /type="password"/.test(html));
  assert(
    `${path}: makes no success claim on a cold page`,
    !/signed in as|logged in as|welcome back,/i.test(html),
  );
}

// 4. Public form previews never claim to send
const formPages = ["/contact", "/request-a-quote", "/sell-scrap", "/source-scrap", "/become-a-supplier"];
for (const path of formPages) {
  const { html } = await get(path);
  assert(`${path}: has form controls`, /<(form|input|select|textarea)/.test(html));
  assert(`${path}: no action attr`, !/<form[^>]*action=/.test(html));
  assert(`${path}: says it does not send`, /does not send|not yet available|nothing is transmitted|Frontend preview/i.test(html));
  assert(`${path}: no success message`, !/thank you|enquiry sent|we will be in touch|message sent/i.test(html));
}

// 5. Homepage preserved: original sections and copy intact
{
  const { html } = await get("/");
  for (const marker of [
    "Industrial scrap and spare parts",
    "Four desks, one accountable programme",
    "Grades specified the way your mill, furnace or line needs them",
    "A brief moves through four checkpoints",
    "A sourcing desk, not a scrap broker",
    "Send one brief and see how the programme runs.",
    "Sourcing brief",
    "Illustrative",
  ]) {
    assert(`home: contains "${marker.slice(0, 42)}"`, html.includes(marker));
  }
}
ok("home: inspected");

// 6. Placeholder email in homepage enquiry, not a real address
{
  const { html } = await get("/");
  assert("home: enquiry email labelled placeholder", html.includes("placeholder address"));
}

// 7. Contact page invents no phone number or address
{
  const { html } = await get("/contact");
  assert("contact: details marked pending", /Contact details pending publication/.test(html));
  // The only phone-shaped string must be the input placeholder, not a real number.
  const phones = html.match(/\+\d[\d\s()-]{8,}/g) ?? [];
  const invented = phones.filter((value) => value.trim() !== "+00 000 000 000");
  assert("contact: no real phone number", invented.length === 0, invented.join(", "));
}

// 8. No commodity price appears on materials pages
{
  // Only visible text matters: the RSC payload inside <script> uses $ tokens of its own.
  const visible = (html) => html.replace(/<script[\s\S]*?<\/script>/g, " ");
  const currency = /(?:USD|EUR|GBP|INR)\s?\d|€\s?\d|£\s?\d|\$\s?\d/;
  const paths = ["", "/scrap-metals", "/scrap-metals/heavy-melting-scrap", "/scrap-metals/copper-millberry", "/spare-parts", "/spare-parts/bearings-and-seals"];
  for (const path of paths) {
    const { html } = await get(path);
    const match = visible(html).match(currency);
    assert(`${path || "/"}: no currency amount`, !match, match?.[0]);
    assert(`${path || "/"}: no stock claim`, !/in stock|available now|units available/i.test(html));
  }
}

// 9. Navigation links in the header all resolve
{
  const { html } = await get("/");
  const hrefs = [...html.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]);
  const internal = [...new Set(hrefs.filter((h) => !h.startsWith("/#") && !h.startsWith("//")))];
  let broken = [];
  for (const href of internal) {
    const path = href.split("#")[0];
    const res = await fetch(BASE + path, { method: "GET", redirect: "manual" });
    // A 307 is the portal refusing an anonymous visitor, which is correct: only a missing page or a
    // server error counts as a broken link.
    if (res.status >= 400) broken.push(`${href} → ${res.status}`);
  }
  assert(`home: all ${internal.length} internal links resolve`, broken.length === 0, broken.join(", "));
}

// 10. An anonymous request for an admin page sets no session cookie
{
  const res = await fetch(`${BASE}/admin/dashboard`, { redirect: "manual" });
  const cookies = res.headers.getSetCookie?.() ?? [];
  const session = cookies.filter((value) => /session|auth|token/i.test(value));
  assert("admin: sets no session cookie for an anonymous visitor", session.length === 0, session.join("; "));
}

// 11. The area boundary: each portal area redirects to its own sign-in, not to a shared one.
for (const [path, login] of [
  ["/admin/dashboard", "/admin/login"],
  ["/buyer/dashboard", "/login"],
  ["/seller/dashboard", "/login"],
]) {
  const res = await fetch(BASE + path, { redirect: "manual" });
  const location = res.headers.get("location") ?? "";
  assert(`${path}: anonymous request redirected`, res.status === 307 || res.status === 302, String(res.status));
  assert(`${path}: redirect lands on ${login}`, location.startsWith(login), location || "no location");
}

// 12. Enquiry wizard. The wizard's steps need the catalogue connection, so the assertion follows the
//     state the server reports instead of assuming Stage 1's static preview. Both branches assert the
//     same honesty: the page never claims to have sent or stored anything.
const plain = (html) => html.replace(/<!--.*?-->/g, "");
for (const path of ["/request-a-quote", "/source-scrap", "/sell-scrap"]) {
  const { status, html } = await get(path);
  const text = plain(html);
  assert(`${path}: responds 200`, status === 200, String(status));
  assert(`${path}: makes no success claim`, !/thank you|enquiry sent|we will be in touch|message sent/i.test(text));
  if (text.includes("database connection will be configured")) {
    assert(`${path}: unconnected catalogue is stated, not hidden`, /database connection will be configured/.test(text));
    assert(`${path}: no form posts anywhere`, !/<form[^>]*action=/.test(text));
  } else {
    assert(`${path}: multi-step wizard`, /Step 1 of \d+/.test(text));
    assert(`${path}: step rail announced`, /aria-label="Enquiry steps"/.test(text));
    assert(`${path}: labelled frontend preview`, /Frontend preview/.test(text));
    assert(`${path}: says nothing is saved`, /does not\s*(?:<[^>]+>\s*)?send, store or email|nothing is submitted, stored or emailed/i.test(text));
  }
}

// 13. Conditional branches and unknown-answer tolerance exist in the wizard source
{
  const { html } = await get("/request-a-quote");
  const text = plain(html);
  assert("/request-a-quote: scrap vs parts switch", /Scrap metal/.test(text) && /Spare parts/.test(text));
  assert("/request-a-quote: labels optional fields", /Optional/.test(text));
  assert("/request-a-quote: keeps target price private", /never shown to suppliers|Kept private/i.test(text));
  assert("/request-a-quote: defers tax to per-transaction config", /tax invoice/i.test(text));
}

// 14. Admin quotation screens hold the same line as the rest of the admin area: an anonymous visitor is
//     refused at the door. Their content is asserted by the authenticated suites (verify:m2…m5,
//     check:acceptance), which hold a real admin session; asserting it here would require this smoke
//     test to carry credentials it deliberately does not have.
for (const path of ["/admin/enquiries/example", "/admin/quotation-preparation", "/admin/supplier-quotations"]) {
  const res = await fetch(BASE + path, { redirect: "manual" });
  const location = res.headers.get("location") ?? "";
  assert(`${path}: refused to an anonymous visitor`, res.status === 307 || res.status === 302, String(res.status));
  assert(`${path}: sent to the admin sign-in`, location.startsWith("/admin/login"), location || "no location");
}

console.log(`\n${fail === 0 ? "✓" : "✗"} content checks: ${pass} passed, ${fail} failed`);
await stopOwned();
process.exit(fail === 0 ? 0 : 1);