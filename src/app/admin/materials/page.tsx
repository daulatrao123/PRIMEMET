import type { Metadata } from "next";
import { Panel, PortalPage, PreviewAction } from "@/components/portal/blocks";
import { NotConnected } from "@/components/ui/not-connected";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { MATERIALS } from "@/lib/content/materials";

export const metadata: Metadata = { title: "Material catalogue" };

export default function AdminMaterialsPage() {
  return (
    <PortalPage
      eyebrow="Catalogues"
      title="Material catalogue"
      description="Grades offered to buyers, with their acceptance basis and inspection requirements."
      actions={<PreviewAction>Add material</PreviewAction>}
    >
      <NotConnected>
        Material records will be created, edited and published from here once PostgreSQL is
        connected. The table below shows the field structure only, using the grades currently held
        as static copy in <code className="font-mono text-[0.8em]">src/lib/content/materials.ts</code>.
      </NotConnected>

      <Panel
        title="Grades"
        description="Reference grades present in the Stage 1 static catalogue. No tonnage, price or availability is implied."
      >
        <Table caption="Material catalogue fields">
          <THead>
            <TR>
              <TH>Grade</TH>
              <TH>Group</TH>
              <TH>Slug</TH>
              <TH>Acceptance rows</TH>
              <TH>Published</TH>
            </TR>
          </THead>
          <TBody>
            {MATERIALS.map((material) => (
              <TR key={material.slug}>
                <TD className="font-medium text-navy-950">{material.name}</TD>
                <TD>{material.group}</TD>
                <TD className="font-mono text-xs text-steel-500">{material.slug}</TD>
                <TD>{material.acceptance.length}</TD>
                <TD>
                  <span className="rounded-full border border-steel-300 bg-steel-50 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-steel-500">
                    Static copy
                  </span>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Panel>

      <Panel title="Record structure to be implemented" description="Fields the material table will carry once persisted.">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[
            "name, slug, group",
            "summary and long description",
            "acceptance criteria (label/value pairs)",
            "inspection and quality checks",
            "published flag and display order",
            "createdAt / updatedAt timestamps",
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
    </PortalPage>
  );
}
