import type { Metadata } from "next";
import { Panel, PortalPage, PreviewAction } from "@/components/portal/blocks";
import { Field, Input, Textarea } from "@/components/ui/input";
import { NotConnected } from "@/components/ui/not-connected";
import { EmptyRow, TBody, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Quotation submissions" };

export default function SellerQuotationsPage() {
  return (
    <PortalPage
      eyebrow="Commercial"
      title="Quotation submissions"
      description="Prices you submit against a brief. These are internal: the buyer sees a consolidated PRIMEMET quotation, never your identity or price."
      actions={<PreviewAction>Submit quotation</PreviewAction>}
    >
      <NotConnected>
        Quotation submissions are internal records in PostgreSQL. Nothing can be submitted from this
        page, and no submitted figure is shown.
      </NotConnected>

      <Panel title="Submissions" description="Your offers against briefs, with their state.">
        <Table caption="Quotation submissions">
          <THead>
            <TR>
              <TH>Brief</TH>
              <TH>Grade / part</TH>
              <TH>Your price</TH>
              <TH>Valid until</TH>
              <TH>State</TH>
            </TR>
          </THead>
          <TBody>
            <EmptyRow colSpan={5}>
              No submissions. Briefs are offered to qualified suppliers once the matching workflow is
              connected.
            </EmptyRow>
          </TBody>
        </Table>
      </Panel>

      <Panel title="Quotation template" description="The structure a submission will use.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Brief reference" htmlFor="sq-brief">
            <Input id="sq-brief" name="brief" placeholder="Provided by the desk" />
          </Field>
          <Field label="Price" htmlFor="sq-price" hint="Entered as a decimal value with its currency">
            <Input id="sq-price" name="price" placeholder="0.00" inputMode="decimal" />
          </Field>
          <Field label="Currency" htmlFor="sq-currency">
            <Input id="sq-currency" name="currency" placeholder="e.g. EUR" />
          </Field>
          <Field label="Validity" htmlFor="sq-validity">
            <Input id="sq-validity" name="validity" placeholder="e.g. 14 days from submission" />
          </Field>
          <Field label="Delivery terms" htmlFor="sq-terms" className="sm:col-span-2">
            <Input id="sq-terms" name="terms" placeholder="e.g. ex-works, collection within 10 working days" />
          </Field>
          <Field label="Conditions and notes" htmlFor="sq-notes" className="sm:col-span-2">
            <Textarea
              id="sq-notes"
              name="notes"
              placeholder="Anything that affects the price: preparation limits, inspection available, weight tolerances."
            />
          </Field>
        </div>
        <p className="mt-4 rounded-md border border-dashed border-steel-300 bg-steel-50 px-4 py-3 text-xs leading-5 text-steel-600">
          This is a layout preview. No price entered is stored, sent or visible to the desk.
        </p>
      </Panel>
    </PortalPage>
  );
}
