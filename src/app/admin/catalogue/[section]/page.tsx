import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Panel, PortalPage } from "@/components/portal/blocks";
import { CatalogueNav } from "@/components/portal/catalogue-nav";
import { NotConnected } from "@/components/ui/not-connected";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { CATALOGUE_SECTIONS, findSection } from "@/lib/content/catalogue-sections";

/**
 * Phase 1 — read-only catalogue section pages.
 *
 * Every section is generated from one registry, so the navigation, the page title and the route
 * check share a single source of truth.
 *
 * WHY READ-ONLY: authentication and role-based authorisation are M2. A write surface here would be
 * an unauthenticated route that mutates catalogue data. The pages therefore describe the stored
 * record shape and the rules it must enforce, and state that nothing is persisted.
 *
 * WHY "UNPUBLISHED": "pending deployment of database layer" was tried and rejected — it describes a
 * deployment event rather than the reason. The catalogue is unpublished because Phase 1 defines the
 * identity model only; persistence arrives with the database milestone.
 */

export function generateStaticParams() {
  return CATALOGUE_SECTIONS.map((section) => ({ section: section.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ section: string }>;
}): Promise<Metadata> {
  const { section } = await params;
  const found = findSection(section);
  // Portal pages are noindex via the admin layout, so no per-page robots override is needed.
  return { title: found ? `${found.title} — catalogue` : "Catalogue" };
}

export default async function CatalogueSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section: slug } = await params;
  const section = findSection(slug);
  if (!section) notFound();

  return (
    <PortalPage
      eyebrow="Catalogue"
      title={section.title}
      description={section.summary}
    >
      <CatalogueNav current={section.slug} />

      <NotConnected>
        This section is read-only and unpublished. Phase 1 defines the identity model and the
        database constraints; the stored version arrives with the database layer. No row on this
        page is real, and no catalogue write endpoint exists yet — authorisation is a later
        milestone, so a write surface would be unauthenticated.
      </NotConnected>

      <Panel
        title="Stored record"
        description={
          section.tables.length > 0
            ? `Backed by ${section.tables.join(", ")} when persistence lands.`
            : "No table exists for this section yet."
        }
        actions={<Badge tone="steel">Phase 1</Badge>}
      >
        <Table caption={`Planned fields for ${section.title}`}>
          <THead>
            <TR>
              <TH>Field</TH>
              <TH>Type</TH>
              <TH>Note</TH>
            </TR>
          </THead>
          <TBody>
            {section.fields.map((field) => (
              <TR key={field.name}>
                <TD className="font-mono text-xs text-navy-900">{field.name}</TD>
                <TD className="text-xs text-steel-600">{field.type}</TD>
                <TD className="text-xs text-steel-600">{field.note ?? "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Panel>

      <Panel
        title="Rules the stored version must enforce"
        description="Each rule is enforced by a database constraint or a documented process, not by convention."
      >
        <ul className="space-y-2">
          {section.rules.map((rule) => (
            <li key={rule} className="flex gap-3 text-sm text-steel-700">
              <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-green-600" />
              <span>{rule}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </PortalPage>
  );
}