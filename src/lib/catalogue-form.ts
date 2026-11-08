import type { ProductSpecificationRow } from "@/lib/data/catalogue";

/**
 * The catalogue admin forms are plain HTML forms, so the two fields that are naturally a list — the image
 * gallery and the specification table — arrive as one textarea each. Parsing lives here, once, so the
 * create route and the edit route cannot disagree about what a line means.
 *
 * Both parsers throw a `CatalogueError` with a message written for the person typing, not for a log.
 */

export class FormError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormError";
  }
}

/**
 * One https image URL per line, with an optional ` | alt text` suffix.
 *
 * The scheme check is repeated here and again in the data layer: this one tells the admin what to fix,
 * the data-layer one is the rule that holds for any future caller.
 */
export function parseImageLines(text: string): Array<{ url: string; alt: string | null }> {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length > 8) throw new FormError("A product can carry at most 8 images.");

  return lines.map((line) => {
    const [rawUrl, ...rest] = line.split("|");
    const url = rawUrl.trim();
    if (!/^https:\/\/[^\s]+$/i.test(url)) {
      throw new FormError(`"${url}" is not an https:// URL. Images must be served over https.`);
    }
    const alt = rest.join("|").trim();
    return { url, alt: alt === "" ? null : alt.slice(0, 200) };
  });
}

/** Render the gallery back into the textarea it came from. */
export function formatImageLines(images: Array<{ url: string; alt: string | null }>): string {
  return images.map((image) => (image.alt ? `${image.url} | ${image.alt}` : image.url)).join("\n");
}

/**
 * One specification per line: `Attribute: value` with an optional `(unit)` at the end.
 *
 * Example: `Outer diameter: 620 (mm)`. A line without a colon is refused rather than guessed at — a
 * silently mangled specification is worse than an error message, because it reads as if it were true.
 */
export function parseSpecLines(text: string): ProductSpecificationRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length > 40) throw new FormError("A product can carry at most 40 specification rows.");

  return lines.map((line, index) => {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      throw new FormError(`"${line}" is missing a colon. Write specifications as "Attribute: value".`);
    }
    const attribute = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    let unit: string | null = null;
    const unitMatch = value.match(/^(.*?)\s*\(([^()]+)\)$/);
    if (unitMatch) {
      value = unitMatch[1].trim();
      unit = unitMatch[2].trim() || null;
    }
    if (attribute === "" || value === "") {
      throw new FormError(`"${line}" needs both an attribute and a value.`);
    }
    return { attribute, value, unit, sortOrder: index };
  });
}

/** Render the specification table back into the textarea it came from. */
export function formatSpecLines(rows: ProductSpecificationRow[]): string {
  return rows
    .map((row) => `${row.attribute}: ${row.value}${row.unit ? ` (${row.unit})` : ""}`)
    .join("\n");
}
