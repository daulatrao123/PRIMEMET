#!/usr/bin/env node
/**
 * M2a compatibility gate — Argon2 runtime verification.
 *
 * Answers ONE question: does @node-rs/argon2 v2.2.2 actually load, hash and verify on the
 * runtime this command is executed on? It records the exact OS, architecture, libc, Node and
 * package versions so a result can be attributed to an environment rather than assumed.
 *
 * It writes nothing into the repository. Everything happens in an OS temp directory. Cleanup is
 * attempted on exit and succeeds where the OS permits it; on Windows a loaded native addon stays
 * locked for the life of the process, so rmSync raises EPERM and the directory is deliberately
 * left behind with a printed note. That is housekeeping, never a verdict: the exit code reflects
 * assertions only. Pass --keep to retain the directory deliberately on any platform.
 *
 * Usage
 *   node scripts/verify-argon2-runtime.mjs               # groups 1-8
 *   node scripts/verify-argon2-runtime.mjs --with-build  # + group 9: Next.js production build
 *   node scripts/verify-argon2-runtime.mjs --keep        # keep the temp workspace
 *
 * Exit 0 = every assertion passed (or was skipped for a stated prerequisite).
 * Exit 1 = a real failure. This is the command that closes requirement C-M2a-4 when run on the
 * deploy runtime; the environment block printed first is what makes the evidence attributable.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, statSync, readdirSync } from "node:fs";
import { tmpdir, platform, arch, release, version as osVersion } from "node:os";
import { join } from "node:path";

const PKG = "@node-rs/argon2";
const PKG_VERSION = "2.2.2";
const WITH_BUILD = process.argv.includes("--with-build");
const KEEP = process.argv.includes("--keep");

/** Hash policy under test. Mirrors the M2a proposal; the PHC string is asserted against it. */
const POLICY = { algorithm: "argon2id", memoryCost: 19456, timeCost: 2, parallelism: 1 };

const results = [];
let group = "";
let argon2 = null;

function g(name) {
  group = name;
  console.log(`\n== ${name} ${"=".repeat(Math.max(0, 62 - name.length))}`);
}
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ group, name, ok: true, detail });
    console.log(`  PASS  ${name}${detail ? `  (${detail})` : ""}`);
    return true;
  } catch (error) {
    results.push({ group, name, ok: false, detail: error.message });
    console.log(`  FAIL  ${name}\n          ${error.message}`);
    return false;
  }
}
function skip(name, reason) {
  results.push({ group, name, ok: true, skipped: true, detail: reason });
  console.log(`  SKIP  ${name}  (${reason})`);
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------------------------------------------------------------- environment record
function glibcVersion() {
  if (platform() !== "linux") return null;
  try {
    return process.report?.getReport?.()?.header?.glibcVersionRuntime ?? null;
  } catch {
    return null;
  }
}
function osRelease() {
  if (platform() !== "linux") return null;
  try {
    const raw = readFileSync("/etc/os-release", "utf8");
    const get = (k) => raw.match(new RegExp(`^${k}="?([^"\\n]+)"?$`, "m"))?.[1] ?? null;
    return { name: get("PRETTY_NAME") ?? get("NAME"), id: get("ID"), version: get("VERSION_ID") };
  } catch {
    return null;
  }
}
function recordEnvironment() {
  const glibc = glibcVersion();
  const env = {
    platform: platform(),
    arch: arch(),
    libc: glibc ? `glibc ${glibc}` : platform() === "linux" ? "musl or unknown" : "not applicable (MSVC runtime)",
    distro: osRelease(),
    osVersion: osVersion(),
    kernel: release(),
    node: process.version,
    nodeModuleVersion: process.versions.modules,
    napi: process.versions.napi,
    package: `${PKG}@${PKG_VERSION}`,
  };
  console.log("== environment " + "=".repeat(50));
  for (const [k, v] of Object.entries(env)) console.log(`  ${k.padEnd(18)} ${v && typeof v === "object" ? JSON.stringify(v) : v}`);
  const isTarget = platform() === "linux" && arch() === "x64";
  console.log(
    isTarget
      ? "\n  RUNTIME CLASS: linux/x64 - this run is valid evidence for C-M2a-4 if all groups pass."
      : `\n  RUNTIME CLASS: ${platform()}/${arch()} - NOT evidence for C-M2a-4.` +
          "\n  It proves the harness works; the Linux execution must still be performed.",
  );
  return { isTarget };
}

// ---------------------------------------------------------------- process execution
/** npm ships as a .cmd shim on Windows, which Node refuses to spawn without a shell (EINVAL).
 *  Instead of enabling a shell (and its argument-escaping hazard), run npm's CLI entry point
 *  through the node binary that is already executing this script. */
function npmCommand() {
  if (platform() !== "win32") return { cmd: "npm", pre: [] };
  const cli = join(process.execPath, "..", "node_modules", "npm", "bin", "npm-cli.js");
  if (existsSync(cli)) return { cmd: process.execPath, pre: [cli] };
  return { cmd: "npm.cmd", pre: [], shell: true };
}
function run(cmd, args, cwd, label) {
  const useShell = cmd.endsWith(".cmd");
  try {
    return execFileSync(cmd, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 600_000,
      shell: useShell,
    });
  } catch (error) {
    const err = error;
    const detail = (err.stderr?.toString?.() || err.stdout?.toString?.() || err.message || "").slice(0, 700);
    throw new Error(`${label} failed (exit ${err.status ?? "?"}): ${detail}`);
  }
}
const NPM = npmCommand();

/** Options object using the numeric Algorithm enum the library actually expects. */
function opts(overrides = {}) {
  return {
    algorithm: argon2.Algorithm.Argon2id,
    memoryCost: POLICY.memoryCost,
    timeCost: POLICY.timeCost,
    parallelism: POLICY.parallelism,
    ...overrides,
  };
}

// ---------------------------------------------------------------- PHC parsing (no needsRehash export)
const PHC = /^\$argon2(id|i|d)\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;
function parsePhc(encoded) {
  const m = PHC.exec(encoded);
  if (!m) throw new Error(`not a PHC argon2 string: ${String(encoded).slice(0, 40)}`);
  return {
    algorithm: `argon2${m[1]}`,
    version: Number(m[2]),
    memoryCost: Number(m[3]),
    timeCost: Number(m[4]),
    parallelism: Number(m[5]),
    saltBytes: Buffer.from(m[6], "base64").length,
    hashBytes: Buffer.from(m[7], "base64").length,
  };
}
function needsRehash(encoded, policy = POLICY) {
  const p = parsePhc(encoded);
  return (
    p.algorithm !== policy.algorithm ||
    p.memoryCost < policy.memoryCost ||
    p.timeCost < policy.timeCost ||
    p.parallelism !== policy.parallelism
  );
}

// ---------------------------------------------------------------- main
async function main() {
  const { isTarget } = recordEnvironment();
  const work = join(tmpdir(), `pm-argon2-gate-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  let ready = false; // set when the package is installed and loadable

  try {
    g("1. clean npm installation");
    writeFileSync(join(work, "package.json"), JSON.stringify({ name: "argon2-gate", private: true, version: "0.0.0" }, null, 2));
    const t0 = Date.now();
    ready = await check("npm install into an empty project", () => {
      run(NPM.cmd, [...NPM.pre, "install", "--no-audit", "--no-fund", `${PKG}@${PKG_VERSION}`], work, "npm install");
      const installed = JSON.parse(readFileSync(join(work, "node_modules", PKG, "package.json"), "utf8"));
      assert(installed.version === PKG_VERSION, `installed ${installed.version}, expected ${PKG_VERSION}`);
      return `v${installed.version} in ${Date.now() - t0} ms`;
    });
    if (ready) {
      await check("no local native compilation was required", () => {
        assert(existsSync(join(work, "node_modules", "@node-rs")), "node_modules/@node-rs is missing");
        if (existsSync(join(work, "node_modules", PKG, "build", "Release"))) {
          throw new Error("a build/Release directory exists - native code was compiled locally");
        }
        return "prebuilt binary only";
      });
    }

    g("2. native module loading");
    const requireFromWork = createRequire(join(work, "index.cjs"));
    if (!ready) {
      skip("module resolves and loads", "prerequisite: install failed");
      skip("a native .node binary is present", "prerequisite: install failed");
    } else {
      ready = await check("module resolves and loads", () => {
        argon2 = requireFromWork(PKG);
        assert(typeof argon2.hash === "function", "hash is not a function");
        assert(typeof argon2.verify === "function", "verify is not a function");
        assert(argon2.Algorithm !== undefined, "Algorithm enum is missing");
        return "hash + verify + Algorithm present";
      });
      if (ready) {
        await check("a native .node binary is present for this platform", () => {
          const found = [];
          const walk = (dir) => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
              const full = join(dir, entry.name);
              if (entry.isDirectory()) walk(full);
              else if (entry.name.endsWith(".node")) found.push(full);
            }
          };
          walk(join(work, "node_modules", "@node-rs"));
          assert(found.length > 0, "no .node file found under node_modules/@node-rs");
          const size = statSync(found[0]).size;
          return `${found[0].split(/[\\/]/).slice(-2).join("/")} ${(size / 1024).toFixed(0)} KB`;
        });
      }
    }

    const password = "Correct-Horse-Battery-Staple-2026";
    let encoded = "";
    let hashMs = 0;

    g("3. Argon2id hashing");
    if (!ready) {
      skip("hash produces a PHC argon2id string", "prerequisite: module not loaded");
      skip("hash is salted", "prerequisite: module not loaded");
    } else {
      await check("hash produces a PHC argon2id string", () => {
        const started = Date.now();
        encoded = argon2.hashSync(password, opts());
        hashMs = Date.now() - started;
        assert(typeof encoded === "string" && encoded.startsWith("$argon2id$"), `unexpected output: ${String(encoded).slice(0, 24)}`);
        return `${encoded.slice(0, 46)}...`;
      });
      await check("hash is salted (two hashes of one password differ)", () => {
        assert(argon2.hashSync(password, opts()) !== encoded, "identical output - salt is not random");
      });
      if (hashMs) console.log(`          hash wall time: ${hashMs} ms`);
    }

    g("4. correct password verification");
    if (!ready) skip("verify accepts the correct password", "prerequisite: no hash");
    else await check("verify accepts the correct password", () => {
      assert(argon2.verifySync(encoded, password) === true, "verify returned false for the correct password");
      return "true";
    });

    g("5. incorrect password rejection");
    if (!ready) {
      skip("verify rejects a wrong password", "prerequisite: no hash");
      skip("verify rejects an empty password", "prerequisite: no hash");
    } else {
      await check("verify rejects a wrong password", () => {
        let ok = true;
        try { ok = argon2.verifySync(encoded, password + "x"); } catch { ok = false; }
        assert(ok === false, "verify accepted a wrong password");
        return "false";
      });
      await check("verify rejects an empty password", () => {
        let ok = true;
        try { ok = argon2.verifySync(encoded, ""); } catch { ok = false; }
        assert(ok === false, "verify accepted an empty password");
        return "false";
      });
    }

    g("6. PHC parameter parsing");
    if (!ready) {
      skip("parameters round-trip to the policy", "prerequisite: no hash");
      skip("no needsRehash export", "prerequisite: module not loaded");
    } else {
      await check("parameters round-trip to the policy", () => {
        const p = parsePhc(encoded);
        assert(p.algorithm === POLICY.algorithm, `algorithm ${p.algorithm}`);
        assert(p.version === 19, `version ${p.version}`);
        assert(p.memoryCost === POLICY.memoryCost, `memoryCost ${p.memoryCost}`);
        assert(p.timeCost === POLICY.timeCost, `timeCost ${p.timeCost}`);
        assert(p.parallelism === POLICY.parallelism, `parallelism ${p.parallelism}`);
        assert(p.saltBytes === 16, `salt ${p.saltBytes} bytes`);
        assert(p.hashBytes === 32, `hash ${p.hashBytes} bytes`);
        return `m=${p.memoryCost},t=${p.timeCost},p=${p.parallelism},salt=${p.saltBytes}B,hash=${p.hashBytes}B`;
      });
      await check("the library exposes no needsRehash (policy is derived)", () => {
        assert(argon2.needsRehash === undefined, "library now exports needsRehash - the derived policy can be replaced");
        return "absent, as documented";
      });
    }

    g("7. rehash policy");
    if (!ready) {
      for (const n of ["no rehash at policy strength", "raising memoryCost flags rehash", "raising timeCost flags rehash", "lowering the policy does not force rehash", "argon2i is flagged"])
        skip(n, "prerequisite: no hash");
    } else {
      await check("a hash at policy strength needs no rehash", () => assert(needsRehash(encoded) === false, "unexpected rehash"));
      await check("raising memoryCost marks the hash for rehash", () => assert(needsRehash(encoded, { ...POLICY, memoryCost: POLICY.memoryCost * 2 }) === true, "not flagged"));
      await check("raising timeCost marks the hash for rehash", () => assert(needsRehash(encoded, { ...POLICY, timeCost: POLICY.timeCost + 1 }) === true, "not flagged"));
      await check("lowering the policy does not force a rehash", () => assert(needsRehash(encoded, { ...POLICY, memoryCost: 8192 }) === false, "lowered policy forced a rehash"));
      await check("an argon2i hash is flagged even at equal cost", () => {
        const argon2i = argon2.hashSync(password, opts({ algorithm: argon2.Algorithm.Argon2i }));
        assert(argon2i.startsWith("$argon2i$"), "did not produce an argon2i hash");
        assert(needsRehash(argon2i) === true, "argon2i not flagged for upgrade");
        return "detected and marked for upgrade";
      });
    }

    g("8. sequential and concurrent hashing and verification");
    const CONCURRENCY = 20;
    if (!ready) {
      skip(`${CONCURRENCY} sequential verifications (baseline, serialised)`, "prerequisite: no hash");
      skip(`${CONCURRENCY} concurrent verifications (overlapped, Promise.all)`, "prerequisite: no hash");
      skip("parallel async hashes", "prerequisite: no hash");
    } else {
      // Baseline: verifySync is blocking, so this loop is serialised by definition. It is named
      // that way on purpose - the previous version called this "concurrent" and it never was.
      let sequentialMs = 0;
      await check(`${CONCURRENCY} sequential verifications (baseline, serialised)`, () => {
        const started = Date.now();
        for (let i = 0; i < CONCURRENCY; i += 1) {
          assert(argon2.verifySync(encoded, password) === true, "a sequential verification failed");
        }
        sequentialMs = Date.now() - started;
        return `${sequentialMs} ms (${(sequentialMs / CONCURRENCY).toFixed(1)} ms/op, one at a time)`;
      });
      // Genuine concurrency: the async verify() hands work to the thread pool, so these calls
      // overlap instead of queueing behind each other.
      await check(`${CONCURRENCY} concurrent verifications (overlapped, Promise.all)`, async () => {
        const started = Date.now();
        const outcomes = await Promise.all(
          Array.from({ length: CONCURRENCY }, () => argon2.verify(encoded, password)),
        );
        const elapsed = Date.now() - started;
        assert(outcomes.every((o) => o === true), "a concurrent verification returned false");
        const ratio = sequentialMs
          ? `${(sequentialMs / elapsed).toFixed(2)}x the sequential baseline`
          : "baseline unavailable";
        return `${elapsed} ms (${(elapsed / CONCURRENCY).toFixed(1)} ms/op overlapped; ${ratio})`;
      });
      await check(`${CONCURRENCY / 2} parallel async hashes are distinct and valid`, async () => {
        const started = Date.now();
        const hashes = await Promise.all(Array.from({ length: CONCURRENCY / 2 }, () => argon2.hash(password, opts())));
        const elapsed = Date.now() - started;
        assert(new Set(hashes).size === hashes.length, "duplicate hashes - salt collision");
        for (const h of hashes) assert(argon2.verifySync(h, password) === true, "a parallel hash failed to verify");
        return `${elapsed} ms, all distinct, all verify`;
      });
    }

    g("9. Next.js production build with the native binding");
    if (!WITH_BUILD) {
      skip("production build bundles a route importing the native module", "pass --with-build to run it");
    } else if (!ready) {
      skip("production build bundles a route importing the native module", "prerequisite: module not loaded");
    } else {
      await check("production build bundles a route importing the native module", () => {
        mkdirSync(join(work, "app", "api", "probe"), { recursive: true });
        writeFileSync(join(work, "app", "layout.tsx"), `export default function RootLayout({ children }: { children: React.ReactNode }) { return (<html lang="en"><body>{children}</body></html>); }\n`);
        writeFileSync(join(work, "app", "page.tsx"), `export default function Page() { return <p>probe</p>; }\n`);
        writeFileSync(join(work, "app", "api", "probe", "route.ts"),
          `import { hash, verify } from "@node-rs/argon2";\nexport const dynamic = "force-dynamic";\n` +
          `export async function GET() {\n  const h = await hash("probe-password", { memoryCost: 19456, timeCost: 2 } as never);\n` +
          `  return Response.json({ ok: await verify(h, "probe-password") });\n}\n`);
        writeFileSync(join(work, "next.config.mjs"), `export default { reactStrictMode: true, poweredByHeader: false };\n`);
        run(NPM.cmd, [...NPM.pre, "install", "--no-audit", "--no-fund", "next@15.5.28", "react@19.1.0", "react-dom@19.1.0", "typescript@5.8.2", "@types/node@22", "@types/react@19"], work, "npm install (next)");
        const started = Date.now();
        run(NPM.cmd, [...NPM.pre, "exec", "--", "next", "build"], work, "next build");
        return `next build succeeded in ${Date.now() - started} ms`;
      });
    }
  } finally {
    if (KEEP) {
      console.log(`\n  workspace kept at ${work}`);
    } else {
      try {
        rmSync(work, { recursive: true, force: true });
      } catch (error) {
        // Windows keeps a loaded native addon locked until the process exits, so removal of the
        // temp directory can fail with EPERM. That is a housekeeping detail and must never be
        // reported as a failed assertion.
        console.log(`\n  note: temp workspace left behind (${error.code}): ${work}`);
      }
    }
  }

  const passed = results.filter((r) => r.ok && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.ok);
  console.log("\n" + "=".repeat(66));
  console.log(`  ${passed} passed, ${failed.length} failed, ${skipped} skipped  -  ${results.length} assertions`);
  if (failed.length) {
    console.log("\n  FAILURES:");
    for (const f of failed) console.log(`   - [${f.group}] ${f.name}: ${f.detail}`);
  }
  console.log(
    isTarget
      ? "  RUNTIME: linux/x64 - valid evidence for C-M2a-4."
      : "  RUNTIME: not linux/x64 - NOT evidence for C-M2a-4; re-run on the deploy runtime.",
  );
  console.log("=".repeat(66));
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nHARNESS ERROR:", error.message);
  process.exit(1);
});
