// Real browser interaction test for the enquiry wizard, driven through the Chrome
// DevTools Protocol. Node built-ins only — no test framework, no puppeteer, no new dependency.
//
// Usage: node scripts/wizard-interaction.mjs   (needs `next start` on SMOKE_BASE, default :3100)
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:3100";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PAGE = "/request-a-quote";

let pass = 0;
let fail = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    pass += 1;
    console.log(`ok   ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), "primemet-cdp-"));
const port = 9333;
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "about:blank",
  ],
  { stdio: "ignore" },
);

async function targetInfo() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page");
      if (page) return page;
    } catch {
      /* chrome not listening yet */
    }
    await sleep(250);
  }
  throw new Error("Chrome DevTools endpoint did not start");
}

let ws;
let nextId = 1;
const pending = new Map();
const consoleErrors = [];

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

async function evaluate(expression) {
  const res = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    throw new Error(`evaluate failed: ${res.exceptionDetails.text} :: ${expression.slice(0, 120)}`);
  }
  return res.result?.value;
}

/** Click the element matched by text inside a scope selector. Returns true if it clicked. */
async function clickByText(scope, text) {
  return evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(scope)}) || document;
    const el = [...root.querySelectorAll("button, label, a")].find(
      (n) => n.textContent.trim().toLowerCase() === ${JSON.stringify(text.toLowerCase())}
    );
    if (!el) return false;
    el.click();
    return true;
  })()`);
}

async function clickInSteps(text) {
  return evaluate(`(() => {
    const nav = document.querySelector('ol[aria-label="Enquiry steps"]');
    if (!nav) return false;
    const el = [...nav.querySelectorAll("button")].find((n) => n.textContent.toLowerCase().includes(${JSON.stringify(text.toLowerCase())}));
    if (!el) return false;
    el.click();
    return true;
  })()`);
}

async function setField(name, value) {
  return evaluate(`(() => {
    const el = document.querySelector('[name=' + JSON.stringify(${JSON.stringify(name)}) + ']');
    if (!el) return "missing";
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return el.value;
  })()`);
}

async function fieldValue(name) {
  return evaluate(`(() => {
    const el = document.querySelector('[name=' + JSON.stringify(${JSON.stringify(name)}) + ']');
    return el ? el.value : null;
  })()`);
}

/** Names of form controls currently rendered inside the active step. */
async function visibleFieldNames() {
  return evaluate(`(() => {
    const section = document.querySelector('section[aria-labelledby$="-step-heading"]');
    if (!section) return [];
    // Hidden (kept-mounted) controls are out of the layout and out of the accessibility tree,
    // so they are not "visible" for the browser or the buyer.
    return [...section.querySelectorAll("input, select, textarea")]
      .filter((el) => !el.closest("[hidden]"))
      .map((n) => n.name)
      .filter(Boolean);
  })()`);
}

async function currentStep() {
  return evaluate(`(() => {
    const p = [...document.querySelectorAll("p")].map((n) => n.textContent.trim())
      .find((t) => /^Step \\d+ of \\d+$/.test(t));
    return p ?? null;
  })()`);
}

async function overflow() {
  return evaluate(`({
    docWidth: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    offenders: [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 5)
      .map((el) => (el.tagName + "." + (el.className || "").toString().slice(0, 40)))
  })`);
}

async function submitState() {
  return evaluate(`(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /Submit/i.test(b.textContent));
    return btn ? { found: true, disabled: btn.disabled || btn.hasAttribute("disabled") } : { found: false };
  })()`);
}

try {
  const target = await targetInfo();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    if (msg.method === "Runtime.exceptionThrown") {
      consoleErrors.push(msg.params.exceptionDetails?.exception?.description ?? "exception");
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
    }
  });

  await send("Page.enable");
  await send("Runtime.enable");

  for (const viewport of [
    { label: "desktop", width: 1440, height: 900 },
    { label: "tablet", width: 768, height: 1024 },
    { label: "mobile", width: 390, height: 844 },
  ]) {
    console.log(`\n── ${viewport.label} ${viewport.width}×${viewport.height} ──`);
    await send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.width < 500,
    });

    await send("Page.navigate", { url: BASE + PAGE });
    await sleep(1200);

    check(`${viewport.label}: page loaded`, (await currentStep()) !== null);

    // Step 1 is the business group (A).
    let names = await visibleFieldNames();
    check(`${viewport.label}: step 1 shows business fields`, names.includes("businessEmail") && names.includes("deliveryCity"), names.join(","));
    check(`${viewport.label}: business step lists no scrap/parts fields`, !names.includes("grade") && !names.includes("partNumber"));
    // Requirement step (2) holds the conditional scrap vs parts branch.
    check(`${viewport.label}: rail jump to requirement`, await clickInSteps("requirement"));
    await sleep(300);
    names = await visibleFieldNames();
    check(`${viewport.label}: scrap fields shown for scrap kind`, names.includes("grade") && names.includes("purity"), names.join(","));
    check(`${viewport.label}: parts fields hidden for scrap kind`, !names.includes("partNumber") && !names.includes("productName"));

    // 8. Quantity + unit captured.
    check(`${viewport.label}: quantity accepted`, (await setField("quantity", "250")) === "250");
    await setField("unit", "KG");
    await setField("metalType", "Copper");

    // 3. Switch to spare parts → incompatible fields must disappear.
    check(`${viewport.label}: switch to parts`, await clickByText("fieldset", "Spare parts"));
    await sleep(250);
    names = await visibleFieldNames();
    check(`${viewport.label}: parts fields shown after switch`, names.includes("partNumber") && names.includes("technicalSpec"), names.join(","));
    check(`${viewport.label}: scrap fields removed after switch`, !names.includes("grade") && !names.includes("purity") && !names.includes("scrapForm"));

    // Unknown answer is accepted, never rejected.
    await setField("partNumber", "unknown");
    check(`${viewport.label}: part number accepts unknown`, (await fieldValue("partNumber")) === "unknown");

    // Switch back to scrap → scrap fields return. Quantity/unit were entered while scrap was
    // selected, so they must still be there (item 8: "Quantity and unit values persist").
    await clickByText("fieldset", "Scrap metal");
    await sleep(250);
    names = await visibleFieldNames();
    check(`${viewport.label}: scrap fields restored on switch back`, names.includes("grade"));
    check(`${viewport.label}: quantity survives kind switch`, (await fieldValue("quantity")) === "250", String(await fieldValue("quantity")));
    check(`${viewport.label}: unit survives kind switch`, (await fieldValue("unit")) === "KG", String(await fieldValue("unit")));

    // 9. Values survive navigation between steps (last field entered: part number before switch).
    await setField("metalType", "Copper");
    check(`${viewport.label}: next step works`, await clickByText("form", "Next step"));
    await sleep(350);
    check(`${viewport.label}: advanced to delivery step`, /Step 3 of/.test((await currentStep()) ?? ""), await currentStep());

    // 4. Back works and re-entered values are still present.
    check(`${viewport.label}: back works`, await clickByText("form", "Back"));
    await sleep(350);
    check(`${viewport.label}: returned to requirement step`, /Step 2 of/.test((await currentStep()) ?? ""), await currentStep());
    check(`${viewport.label}: metal type survives step navigation`, (await fieldValue("metalType")) === "Copper", String(await fieldValue("metalType")));
    check(`${viewport.label}: quantity survives step navigation`, (await fieldValue("quantity")) === "250", String(await fieldValue("quantity")));

    // Jump directly to a later step and back via the rail.
    check(`${viewport.label}: rail jump to commercial`, await clickInSteps("commercial"));
    await sleep(300);
    check(`${viewport.label}: commercial step active`, /Step 4 of/.test((await currentStep()) ?? ""), await currentStep());
    check(`${viewport.label}: rail jump back to business`, await clickInSteps("business"));
    await sleep(300);

    // 5. Required-field validation: required controls must carry a required attribute or aria-required.
    const requiredNames = await evaluate(`(() => {
      const section = document.querySelector('section[aria-labelledby$="-step-heading"]');
      if (!section) return [];
      return [...section.querySelectorAll("input, select, textarea")]
        .filter((n) => n.required || n.getAttribute("aria-required") === "true")
        .map((n) => n.name);
    })()`);
    check(`${viewport.label}: required controls marked`, requiredNames.length > 0, requiredNames.join(","));

    // 5b. The catalogue status must be visible on the field itself, not only in the legend.
    const statusMarks = await evaluate(`(() => {
      const section = document.querySelector('section[aria-labelledby$="-step-heading"]');
      return section ? /Required|Optional|Collected later/.test(section.innerText) : false;
    })()`);
    check(`${viewport.label}: field status visible beside labels`, statusMarks === true);

    // 10. Submit stays disabled and makes no claim.
    const submit = await submitState();
    check(`${viewport.label}: submit present`, submit.found);
    check(`${viewport.label}: submit disabled`, submit.disabled === true, JSON.stringify(submit));

    // 12. No horizontal overflow.
    const box = await overflow();
    check(`${viewport.label}: no horizontal overflow`, box.docWidth <= box.viewport + 1, JSON.stringify(box));

    // 2. No parts fields VISIBLE anywhere while scrap is selected. They stay mounted but hidden so
    // that switching type does not discard values; hidden controls are out of the a11y tree.
    const strayParts = await evaluate(`[...document.querySelectorAll('[name]')]
      .filter((n) => ["partNumber","productCategory","equivalentAcceptable"].includes(n.name))
      .filter((n) => !n.closest("[hidden]") && n.offsetParent !== null)
      .map((n) => n.name)`);
    check(`${viewport.label}: no visible parts inputs while scrap selected`, strayParts.length === 0, strayParts.join(","));
  }

  // 11. Admin enquiry detail renders the captured field catalogue.
  console.log("\n── admin enquiry detail ──");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${BASE}/admin/enquiries/example` });
  await sleep(1200);
  const adminText = await evaluate("document.body.innerText");
  for (const marker of [
    "Buyer & business details",
    "Material / product specifications",
    "Quantity & units",
    "Delivery & logistics",
    "Commercial requirements",
    "Attachments",
    "Missing information & clarification checklist",
    "Supplier matching",
    "Supplier quotation comparison",
    "Buyer quotation preparation",
    "Clarification checklist",
    "quotation-ready",
  ]) {
    check(`admin: shows "${marker.slice(0, 38)}"`, adminText.toLowerCase().includes(marker.toLowerCase()));
  }

  check("no console errors during interaction", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
} finally {
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  chrome.kill();
  await sleep(300);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* Chrome may still hold the profile briefly */
  }
}

console.log(`\n${fail === 0 ? "✓" : "✗"} wizard interaction checks: ${pass} passed, ${fail} failed`);
if (failures.length) console.log(`failed: ${failures.join("; ")}`);
process.exit(fail === 0 ? 0 : 1);
