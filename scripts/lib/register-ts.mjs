import { existsSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Register the TypeScript resolution hook used by the verification scripts.
 *
 * Two TypeScript conventions are not Node ESM conventions: the `@/` path alias, and extensionless
 * relative imports. This hook adds exactly those and nothing else. It is synchronous because it only
 * stats files; the older `module.register()` spawns a loader thread and is deprecated on this runtime.
 */
const projectRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const srcRoot = path.join(projectRoot, "src");
const EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".js", ".mjs", ".json"];

function asFile(candidate) {
  for (const suffix of EXTENSIONS) {
    const file = candidate + suffix;
    if (existsSync(file) && statSync(file).isFile()) return file;
  }
  for (const suffix of [".ts", ".tsx", ".js", ".mjs"]) {
    const file = path.join(candidate, `index${suffix}`);
    if (existsSync(file) && statSync(file).isFile()) return file;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, next) {
    // Only TypeScript sources get the rewrite. A CommonJS package (the MongoDB driver, for one) asks
    // for `./internal/x` and would otherwise be handed a path the alias logic guessed at; those
    // specifiers must reach Node's own resolver untouched.
    const fromTypescript = /\.[cm]?tsx?($|\?)/.test(context.parentURL ?? "");
    if (!fromTypescript) return next(specifier, context);

    if (specifier.startsWith("@/")) {
      const file = asFile(path.join(srcRoot, specifier.slice(2)));
      if (file) return next(pathToFileURL(file).href, context);
    }
    if (specifier.startsWith(".") && path.extname(specifier) === "") {
      const parent = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : projectRoot;
      const file = asFile(path.resolve(parent, specifier));
      if (file) return next(pathToFileURL(file).href, context);
    }
    return next(specifier, context);
  },
});
