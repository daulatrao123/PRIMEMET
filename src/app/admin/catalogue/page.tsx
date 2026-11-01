import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Panel, PortalPage, PreviewAction } from "@/components/portal/blocks";
import { CatalogueNav } from "@/components/portal/catalogue-nav";
import { ExampleData } from "@/components/portal/example-data";
import { NotConnected } from "@/components/ui/not-connected";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import {
  CATALOGUE_CATEGORIES,
  CATALOGUE_GRADES,
  PRICE_MODE_LABELS,
  PUBLICATION_TONE,
  type CategoryKind,
} from "@/lib/content/catalogue";

export const metadata: Metadata = { title: "Catalogue management" };

const KIND_LABELS: Record<CategoryKind, string> = {
  SCRAP: "Scrap",
  SPARE_PARTS: "Spare parts",
};

export default function AdminCataloguePage() {
  return (
    <PortalPage
      eyebrow="Catalogue"
      title="Categories and grades"
      description="The catalogue buyers see is maintained here: categories, grades, publication state and display order. Nothing on this screen is stored yet."
      actions={
        <>
          <PreviewAction>New category</PreviewAction>
          <PreviewAction>New grade</PreviewAction>
        </>
      }
    >
      <NotConnected>
        Categories and grades will be written to PostgreSQL in Stage 3. Until then this screen
        documents the fields and the lifecycle rules that the stored version must enforce, and the
        rows below are illustration only.
      </NotConnected>

      {/* Phase 1: one shared navigation for every catalogue section, so the index and the
          section pages cannot disagree about what exists. */}
      <CatalogueNav />

      <ExampleData>
        The rows below exist to show field structure and lifecycle states. They are not real
        categories or products, and no price, stock level or availability is stated.
      </ExampleData>

      <Panel
        title="Categories"
        description="A category is either scrap or spare parts. Its type is fixed once grades reference it."
        actions={<PreviewAction>Reorder</PreviewAction>}
      >
        <Table caption="Catalogue categories with kind, display order, publication state and deletion rule">
          <THead>
            <TR>
              <TH>Category</TH>
              <TH>Type</TH>
              <TH>Order</TH>
              <TH>State</TH>
              <TH>Images</TH>
              <TH>Delete behaviour</TH>
            </TR>
          </THead>
          <TBody>
            {CATALOGUE_CATEGORIES.map((category) => (
              <TR key={category.slug}>
                <TD>
                  <span className="font-medium text-navy-950">{category.name}</span>
                  <span className="mt-0.5 block font-mono text-xs text-steel-500">
                    /{category.slug}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-steel-500">
                    {category.description}
                  </span>
                </TD>
                <TD>
                  <Badge tone={category.kind === "SCRAP" ? "steel" : "outline"}>
                    {KIND_LABELS[category.kind]}
                  </Badge>
                </TD>
                <TD className="font-mono text-xs">{category.displayOrder}</TD>
                <TD>
                  <Badge tone={PUBLICATION_TONE[category.publication]}>{category.publication}</Badge>
                </TD>
                <TD className="font-mono text-xs">{category.imageCount}</TD>
                <TD className="max-w-xs text-xs leading-5 text-steel-500">{category.deletionGuard}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Panel>

      <Panel
        title="Grades and products"
        description="Each grade belongs to one category. Composition is attached through a configurable profile, not through fixed columns."
      >
        <Table caption="Grade and product records with category, price mode, publication state and composition profile">
          <THead>
            <TR>
              <TH>SKU</TH>
              <TH>Name</TH>
              <TH>Category</TH>
              <TH>Price mode</TH>
              <TH>Composition</TH>
              <TH>State</TH>
            </TR>
          </THead>
          <TBody>
            {CATALOGUE_GRADES.map((grade) => (
              <TR key={grade.sku}>
                <TD className="font-mono text-xs text-steel-500">{grade.sku}</TD>
                <TD>
                  <span className="font-medium text-navy-950">{grade.name}</span>
                  <span className="mt-1 block text-xs leading-5 text-steel-500">
                    MOQ {grade.moq} · {grade.availability}
                  </span>
                  {grade.manufacturer ? (
                    <span className="mt-1 block text-xs text-steel-500">{grade.manufacturer}</span>
                  ) : null}
                </TD>
                <TD className="font-mono text-xs">{grade.categorySlug}</TD>
                <TD>
                  <Badge tone={grade.priceMode === "FIXED" ? "green" : "steel"}>
                    {PRICE_MODE_LABELS[grade.priceMode]}
                  </Badge>
                </TD>
                <TD className="text-xs">
                  {grade.compositionProfile ? (
                    <span className="font-mono text-steel-600">{grade.compositionProfile}</span>
                  ) : (
                    <span className="italic text-steel-500">Not applicable</span>
                  )}
                </TD>
                <TD>
                  <Badge tone={PUBLICATION_TONE[grade.publication]}>{grade.publication}</Badge>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Lifecycle rules" description="Behaviours the stored version must implement.">
          <ul className="space-y-2.5 text-sm leading-6 text-steel-600">
            {[
              "Archive and restore, rather than delete, once a record has been published.",
              "Delete is refused while any grade, lot or historical transaction references the record.",
              "Unpublishing removes a record from public listing and search without touching history.",
              "Display order is explicit data, so card order survives a database round trip.",
              "A grade cannot move to a category of the other type once a lot references it.",
            ].map((rule) => (
              <li key={rule} className="flex gap-2.5">
                <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-green-600" />
                {rule}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Record structure to be implemented" description="Fields the stored tables will carry.">
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              "name, slug, description, image",
              "kind: SCRAP | SPARE_PARTS",
              "displayOrder, publication state",
              "archivedAt, createdAt, updatedAt",
              "grade sku, name, manufacturer, brand",
              "priceMode: FIXED | REQUEST | BULK_TIERED",
              "MOQ, availability, multiple images",
              "compositionProfile reference",
            ].map((field) => (
              <div
                key={field}
                className="rounded-md border border-steel-200 bg-steel-50 px-3 py-2 font-mono text-[0.7rem] text-steel-600"
              >
                {field}
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </PortalPage>
  );
}