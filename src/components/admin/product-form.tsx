import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import type { AdminProductRow, CategoryWithFamilies } from "@/lib/data/catalogue";

/**
 * The product editor.
 *
 * A plain HTML form posting to `/api/admin/catalogue/products`, which redirects back with a message.
 * One component serves create and edit, so a field cannot exist on one screen and be silently dropped
 * by the other — the classic way an editor loses data it never showed.
 *
 * The gallery and the specification table are textareas because they are lists: one image per line, one
 * specification per line. That keeps the form usable without JavaScript and makes the exact stored value
 * visible to the administrator rather than hidden behind a widget.
 */
export function ProductForm({
  mode,
  product,
  tree,
  imagesText = "",
  specsText = "",
  error,
}: {
  mode: "create" | "edit";
  product?: AdminProductRow;
  tree: CategoryWithFamilies[];
  imagesText?: string;
  specsText?: string;
  error?: string;
}) {
  const id = product?.id ?? "";

  return (
    <form method="post" action="/api/admin/catalogue/products" className="space-y-6">
      <input type="hidden" name="action" value={mode} />
      {mode === "edit" ? <input type="hidden" name="id" value={id} /> : null}

      {error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" htmlFor="product-title" className="sm:col-span-2">
          <Input id="product-title" name="title" required maxLength={240} defaultValue={product?.title ?? ""} />
        </Field>

        <Field
          label="URL slug"
          htmlFor="product-slug"
          hint="Leave blank to derive it from the title."
        >
          <Input id="product-slug" name="slug" maxLength={160} defaultValue={product?.slug ?? ""} />
        </Field>

        <Field label="Subcategory" htmlFor="product-family">
          <Select id="product-family" name="familyId" required defaultValue={product?.familyId ?? ""}>
            <option value="">Choose a subcategory</option>
            {tree.map((category) => (
              <optgroup key={category.id} label={category.name}>
                {category.families.map((family) => (
                  <option key={family.id} value={family.id}>
                    {family.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>

        <Field label="Part number" htmlFor="product-part-number">
          <Input id="product-part-number" name="partNumber" maxLength={120} defaultValue={product?.partNumber ?? ""} />
        </Field>

        <Field label="Brand" htmlFor="product-brand">
          <Input id="product-brand" name="brand" maxLength={120} defaultValue={product?.brand ?? ""} />
        </Field>

        <Field label="Manufacturer" htmlFor="product-manufacturer">
          <Input
            id="product-manufacturer"
            name="manufacturer"
            maxLength={120}
            defaultValue={product?.manufacturer ?? ""}
          />
        </Field>

        <Field label="Condition" htmlFor="product-condition">
          <Select id="product-condition" name="condition" required defaultValue={product?.condition ?? "NEW"}>
            <option value="NEW">New</option>
            <option value="REFURBISHED">Refurbished</option>
            <option value="USED">Used</option>
            <option value="UNKNOWN">Unknown</option>
          </Select>
        </Field>

        <Field label="Price mode" htmlFor="product-price-mode" hint="Phase 1 quotes on request; no price is stored.">
          <Select id="product-price-mode" name="priceMode" required defaultValue={product?.priceMode ?? "REQUEST"}>
            <option value="REQUEST">Quote on request</option>
            <option value="FIXED">Fixed price</option>
            <option value="BULK_TIERED">Bulk tiered</option>
          </Select>
        </Field>

        <Field label="Short description" htmlFor="product-short" className="sm:col-span-2">
          <Textarea
            id="product-short"
            name="shortDescription"
            rows={3}
            maxLength={600}
            defaultValue={product?.shortDescription ?? ""}
          />
        </Field>

        <Field
          label="Technical description"
          htmlFor="product-technical"
          className="sm:col-span-2"
          hint="Free text for the long description. Structured specifications belong in the table below."
        >
          <Textarea
            id="product-technical"
            name="technicalSpecification"
            rows={5}
            maxLength={4000}
            defaultValue={product?.technicalSpecification ?? ""}
          />
        </Field>

        <Field
          label="Images"
          htmlFor="product-images"
          className="sm:col-span-2"
          hint="One https:// URL per line. Add “ | alt text ” after a URL to describe it. The first line is the main image."
        >
          <Textarea id="product-images" name="imageUrls" rows={3} defaultValue={imagesText} />
        </Field>

        <Field
          label="Specifications"
          htmlFor="product-specs"
          className="sm:col-span-2"
          hint="One per line: “Attribute: value (unit)”. Example: Outer diameter: 620 (mm)."
        >
          <Textarea id="product-specs" name="specifications" rows={5} defaultValue={specsText} />
        </Field>

        {mode === "edit" ? (
          <Field label="State" htmlFor="product-state">
            <Select id="product-state" name="publicationState" defaultValue={product?.publicationState ?? "DRAFT"}>
              <option value="DRAFT">Draft — not on the public catalogue</option>
              <option value="PUBLISHED">Published — visible to buyers</option>
              <option value="ARCHIVED">Archived — withdrawn</option>
            </Select>
          </Field>
        ) : (
          <Field label="Publish immediately" htmlFor="product-publish" hint="Leave unticked to save as a draft.">
            <Select id="product-publish" name="publish" defaultValue="no">
              <option value="no">No — save as draft</option>
              <option value="yes">Yes — publish now</option>
            </Select>
          </Field>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="submit">{mode === "create" ? "Create product" : "Save product"}</Button>
        <Link
          href="/admin/products"
          className="inline-flex items-center rounded-lg border border-steel-200 px-4 py-2 text-sm font-medium text-steel-700"
        >
          Back to products
        </Link>
      </div>
    </form>
  );
}
