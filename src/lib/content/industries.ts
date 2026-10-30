export type Industry = {
  slug: string;
  name: string;
  summary: string;
  body: string;
  pressures: string[];
  howWeHelp: string[];
};

/** Segment descriptions only — no client names, no volumes, no case results. */
export const INDUSTRIES: Industry[] = [
  {
    slug: "steel-and-rolling",
    name: "Steel and rolling mills",
    summary: "Charge material consistency and the maintenance spares that keep a rolling line running.",
    body: "A mill buys scrap against a heat balance and buys spares against an unplanned stop. Both are procurement problems with an engineering answer, and both punish a supplier who quotes from a price sheet without reading the specification.",
    pressures: [
      "Charge chemistry that varies between lots",
      "Contamination discovered after the load is tipped",
      "Spares on rolling lines with long OEM lead times",
      "Documentation that must survive an audit",
    ],
    howWeHelp: [
      "Charge briefs written to the furnace, not to a generic grade",
      "Inspection and photographic records before dispatch",
      "Spare-parts sourcing against drawings and nameplates",
      "One reconciled record per consignment",
    ],
  },
  {
    slug: "foundries",
    name: "Foundries and casting",
    summary: "Sorted charge, alloy additions and pattern-shop spares with documented composition.",
    body: "Foundries work to a chemistry target, so a mixed or misdescribed lot is not an inconvenience — it is a heat that has to be corrected or scrapped. Sorting discipline is the whole value of the supply.",
    pressures: [
      "Mixed lots that shift the heat analysis",
      "Alloy additions without documentation",
      "Small volumes that fall below a trader's interest",
      "Pattern and mould-line spares that are hard to identify",
    ],
    howWeHelp: [
      "Sorted lots with the sorting standard agreed in writing",
      "Testing arranged where the brief requires verification",
      "Consolidated loads across grades to reach sensible volumes",
      "Component sourcing from samples and drawings",
    ],
  },
  {
    slug: "fabrication-and-machining",
    name: "Fabrication and machining",
    summary: "Offcut recovery, tooling spares and consumables procurement for job shops.",
    body: "A fabrication shop generates scrap as a by-product of paid work and consumes spares as a condition of doing it. Both are usually nobody's full-time job, which is where value quietly leaks.",
    pressures: [
      "Offcuts accumulating without a recovery route",
      "Mixed metals stored together and sold as one grade",
      "Tooling and machine spares ordered reactively",
      "No record of what left the yard",
    ],
    howWeHelp: [
      "Recovery routes that separate metals at source",
      "Collection scheduling that matches production rhythm",
      "Weighbridge and photographic records per collection",
      "Spares and tooling sourced against machine details",
    ],
  },
  {
    slug: "cement-and-aggregates",
    name: "Cement and aggregates",
    summary: "Wear-part sourcing and heavy-equipment spares for abrasive, continuous operation.",
    body: "In cement and aggregates, wear is the operating condition rather than an exception. Liners, hammers and conveying components are consumed continuously, so availability and dimensional accuracy matter more than brand.",
    pressures: [
      "Wear parts consumed faster than planned maintenance cycles",
      "Pattern and drawing information that has been lost",
      "Long lead times on imported components",
      "Substitutes that fail early because the material was not specified",
    ],
    howWeHelp: [
      "Wear parts sourced to material and hardness, not just dimension",
      "Reverse engineering from failed samples",
      "Consolidated spares orders to reduce freight",
      "Documented substitution where an equivalent is proposed",
    ],
  },
  {
    slug: "power-and-utilities",
    name: "Power and utilities",
    summary: "Balance-of-plant spares and obsolescence management for ageing assets.",
    body: "Utilities run equipment well past its support life, which means the part number on the drawing has often been discontinued twice. The sourcing question is an engineering one: what does the part do, and what can safely replace it?",
    pressures: [
      "Obsolescence across instrumentation and controls",
      "Safety-critical items needing documented equivalence",
      "Long approval cycles for substitutions",
      "Small quantities that distributors deprioritise",
    ],
    howWeHelp: [
      "Obsolescence review before a failure forces the decision",
      "Documented equivalence for proposed alternatives",
      "Single point of contact across multiple OEMs",
      "Records retained per item for audit and repeat orders",
    ],
  },
  {
    slug: "recycling-and-waste",
    name: "Recycling and waste",
    summary: "Outbound offtake for yards and processors, with grading discipline on both sides.",
    body: "A yard sells what it has sorted. Where grading is loose, value transfers to the buyer at the weighbridge. Consistent grading and honest documentation protect the price on every load.",
    pressures: [
      "Value lost to loose grading",
      "Buyer disputes at the destination weighbridge",
      "Difficulty reaching buyers beyond the local region",
      "Documentation gaps on outbound loads",
    ],
    howWeHelp: [
      "Grading standards agreed and applied consistently",
      "Photographic and weighbridge records on every load",
      "Access to buyers outside the local market",
      "Documentation prepared with the consignment",
    ],
  },
];
