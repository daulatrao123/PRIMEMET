/**
 * Renders one JSON-LD block.
 *
 * `<script type="application/ld+json">` is a data island, not executable script: Next.js escapes the
 * payload, so `</script>` inside a string cannot break out of the element. Passing a plain object
 * (rather than a pre-serialised string) keeps the call sites readable and type-checked.
 */
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}