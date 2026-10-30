// Content assertions against the running production server.
const BASE = "http://127.0.0.1:3100";

const LABEL = "Preview";
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
  assert("health: database not_configured", body.database === "not_configured", body.database);
  assert("health: exactly 4 keys", Object.keys(body).length === 4, Object.keys(body).join(","));
}

// 2. Every portal page carries the preview label and no fake session
const portalPages = [
  "/admin/dashboard", "/admin/enquiries", "/admin/suppliers", "/admin/buyers",
  "/admin/materials", "/admin/products", "/admin/pricing", "/admin/supplier-quotations",
  "/admin/quotations", "/admin/reports", "/admin/audit-log",
  "/buyer/dashboard", "/buyer/enquiries/new", "/buyer/scrap-sourcing", "/buyer/spare-parts",
  "/buyer/quotations", "/buyer/orders", "/buyer/profile",
  "/seller/dashboard", "/seller/profile", "/seller/tax", "/seller/materials",
  "/seller/products", "/seller/quotations", "/seller/enquiries", "/seller/orders",
];

for (const path of portalPages) {
  const { html } = await get(path);
  const hasLabel = html.includes(LABEL) && html.includes("database connection will be configured");
  if (!hasLabel) bad(`${path}: preview label`, "missing database preview label");
  if (/signed in as|logged in as|welcome back,/i.test(html)) bad(`${path}: fake session wording`);
  if (/\bLogged in\b/.test(html)) bad(`${path}: fake session wording`);
}
ok(`portal pages checked for preview label + no session wording (${portalPages.length})`);

// 3. Auth previews: no fake success, submit disabled
for (const path of ["/login", "/admin/login", "/register/buyer", "/register/seller"]) {
  const { html } = await get(path);
  assert(`${path}: states preview only`, /Preview only/.test(html));
  assert(`${path}: disabled submit`, /disabled/.test(html));
  assert(`${path}: no action attr on form`, !/<form[^>]*action=/.test(html));
}

// 4. Public form previews never claim to send
const formPages = ["/contact", "/request-a-quote", "/sell-scrap", "/source-scrap", "/become-a-supplier"];
for (const path of formPages) {
  const { html } = await get(path);
  assert(`${path}: has form controls`, /<form/.test(html));
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
    const res = await fetch(BASE + path, { method: "GET" });
    if (res.status >= 400) broken.push(`${href} → ${res.status}`);
  }
  assert(`home: all ${internal.length} internal links resolve`, broken.length === 0, broken.join(", "));
}

// 10. No database or auth libraries wired into the app
{
  const res = await fetch(`${BASE}/admin/dashboard`);
  const cookies = res.headers.getSetCookie?.() ?? [];
  assert("admin: sets no cookies", cookies.length === 0, cookies.join("; "));
}

// 11. Middleware does not block portal routes
for (const path of ["/admin/dashboard", "/buyer/dashboard", "/seller/dashboard"]) {
  const res = await fetch(BASE + path, { redirect: "manual" });
  assert(`${path}: not redirected by middleware`, res.status === 200, String(res.status));
}

console.log(`\n${fail === 0 ? "✓" : "✗"} content checks: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
