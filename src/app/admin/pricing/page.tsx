import type { Metadata } from "next";
import { Panel, PortalPage, PreviewAction } from "@/components/portal/blocks";
import { NotConnected } from "@/components/ui/not-connected";
import { EmptyRow, TBody, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Pricing & formulas" };

const FORMULA_PARTS = [
  { label: "Base reference", body: "The index or reference price the formula starts from." },
  { label: "Grade adjustment", body: "Per-grade delta applied to the reference before anything else." },
  { label: "Freight and handling", body: "Landed cost components added per route." },
  { label: "Margin or commission", body: "Internal component. Never shown on a buyer-facing document." },
];

export default function AdminPricingPage() {
  return (
    <PortalPage
      eyebrow="Catalogues"
      title="Price and formula management"
      description="How a supplier cost becomes a buyer-facing price, with the margin component held internally."
      actions={<PreviewAction>New formula</PreviewAction>}
    >
      <NotConnected>
        Price records need a database: a formula, its components and the resulting per-brief price.
        No reference price is published or stored in this build, and no commodity figure is invented
        here.
      </NotConnected>

      <Panel title="Formula structure" description="The components a pricing formula is expected to carry.">
        <div className="grid gap-4 sm:grid-cols-2">
          {FORMULA_PARTS.map((part, index) => (
            <div key={part.label} className="rounded-card border border-steel-200 bg-white p-4">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[0.7rem] text-steel-500">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="text-sm font-semibold text-navy-950">{part.label}</h3>
              </div>
              <p className="mt-2 text-xs leading-5 text-steel-600">{part.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 rounded-md border border-dashed border-steel-300 bg-steel-50 px-4 py-3 text-xs leading-5 text-steel-600">
          Monetary values must be stored as <span className="font-mono">Decimal</span> with explicit
          precision when the schema is written — never as a floating-point number.
        </p>
      </Panel>

      <Panel title="Active formulas" description="Formulas available to the quotation desk.">
        <Table caption="Active pricing formulas">
          <THead>
            <TR>
              <TH>Formula</TH>
              <TH>Applies to</TH>
              <TH>Effective from</TH>
              <TH>Last updated</TH>
              <TH>State</TH>
            </TR>
          </THead>
          <TBody>
            <EmptyRow colSpan={5}>
              No formulas defined. Formulas will be created here once price records can be stored.
            </EmptyRow>
          </TBody>
        </Table>
      </Panel>

      <Panel title="Internal pricing records" description="Supplier cost, margin and commission — internal only.">
        <Table caption="Internal pricing records">
          <THead>
            <TR>
              <TH>Grade / part</TH>
              <TH>Supplier cost</TH>
              <TH>Freight</TH>
              <TH>Margin</TH>
              <TH>Buyer price</TH>
            </TR>
          </THead>
          <TBody>
            <EmptyRow colSpan={5}>
              No price records. Supplier cost and margin are never exposed on buyer-facing screens.
            </EmptyRow>
          </TBody>
        </Table>
      </Panel>
    </PortalPage>
  );
}
