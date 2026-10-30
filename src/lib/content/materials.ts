export type MaterialGroup = "Ferrous" | "Non-ferrous" | "Alloys";

export type Material = {
  slug: string;
  name: string;
  group: MaterialGroup;
  summary: string;
  overview: string[];
  /** Typical acceptance basis. Agreed per brief — not a published or guaranteed spec. */
  acceptance: { label: string; value: string }[];
  qualityChecks: string[];
  applications: string[];
};

/**
 * Static catalogue content for Stage 1.
 *
 * Deliberately contains no tonnage, pricing, availability or certification claims:
 * those are commercial facts that belong to the database and to PRIMEMET's own
 * paperwork, not to a marketing site. Every spec below is framing for a
 * conversation, and every page says so.
 *
 * TODO (Stage 2): replace with material records read from PostgreSQL.
 */
export const MATERIALS: Material[] = [
  {
    slug: "heavy-melting-scrap",
    name: "Heavy melting scrap",
    group: "Ferrous",
    summary: "HMS 1&2 for mill and foundry charge, sized and graded to the receiving furnace.",
    overview: [
      "Heavy melting scrap is the base charge for most steelmaking and foundry operations. The difficulty is rarely finding metal — it is receiving a lot that matches the grade you ordered, at a size the furnace can take, without contamination that shows up in the heat analysis.",
      "We source HMS 1&2 against a written brief: proportion of HMS 1 to HMS 2, maximum dimensions, coating and attachment limits, and the loading method. The brief is agreed before the supplier is confirmed, and the lot is checked against it before dispatch.",
    ],
    acceptance: [
      { label: "Grade reference", value: "HMS 1&2, ratio agreed per brief" },
      { label: "Maximum dimension", value: "Agreed to suit the receiving furnace or charger" },
      { label: "Coating limits", value: "Stated and measured per lot" },
      { label: "Free-flowing", value: "No bundles, no entangled wire" },
      { label: "Prohibited items", value: "Sealed containers, closed hollow sections, radioactive sources" },
    ],
    qualityChecks: [
      "Radiation screening before loading",
      "Visual grading against the agreed ratio",
      "Photographic load record attached to the consignment",
      "Weighbridge reconciliation at origin and destination",
    ],
    applications: ["Electric arc furnace charge", "Foundry melting", "Blast furnace burden", "Casting shops"],
  },
  {
    slug: "shredded-scrap",
    name: "Shredded scrap",
    group: "Ferrous",
    summary: "Fragmentised ferrous scrap with a defined bulk density for continuous charging.",
    overview: [
      "Shredded scrap feeds furnaces that charge continuously, so consistency of density matters more than the headline grade. Loose, low-density shred slows the melt and consumes more energy per tonne.",
      "Briefs we run specify the density expectation, the fines and fluff allowance, and the moisture position. Where a mill needs it, we hold the supplier to a sizing screen rather than accepting whatever the shredder produced that week.",
    ],
    acceptance: [
      { label: "Grade reference", value: "Shredded ferrous, ISRI-equivalent framing" },
      { label: "Bulk density", value: "Specified in the brief; verified on samples" },
      { label: "Fines and fluff", value: "Capped at an agreed percentage" },
      { label: "Moisture", value: "Declared and checked at loading" },
      { label: "Non-ferrous carry-over", value: "Limited by agreement" },
    ],
    qualityChecks: [
      "Density sampling during production",
      "Screening for non-ferrous and plastics carry-over",
      "Moisture assessment at loading",
      "Photographic and weighbridge record per consignment",
    ],
    applications: ["Continuous furnace charging", "Induction furnace feed", "Steel mill melt shops"],
  },
  {
    slug: "plate-and-structural",
    name: "Plate and structural",
    group: "Ferrous",
    summary: "Demolition plate, beams and heavy sections cut to a charger-friendly size.",
    overview: [
      "Plate and structural scrap arrives with the most variation of any ferrous grade: paint, concrete, attachments and hollow sections all need removing before it goes near a furnace. It also carries the highest risk of sealed voids.",
      "We brief the preparation standard explicitly — cutting size, removal of concrete and refractory, opening of hollow sections — and inspect at the yard rather than discovering the problem at the weighbridge.",
    ],
    acceptance: [
      { label: "Grade reference", value: "Plate and structural, prepared to size" },
      { label: "Cut size", value: "Specified to suit charger dimensions" },
      { label: "Attachments", value: "Concrete, refractory and fixings removed" },
      { label: "Hollow sections", value: "Opened before loading" },
      { label: "Thickness", value: "Minimum set per brief" },
    ],
    qualityChecks: [
      "Yard inspection of preparation standard",
      "Confirmation that hollow sections are open",
      "Radiation screening at loading",
      "Photographic record of prepared piles",
    ],
    applications: ["Furnace charge", "Foundry remelting", "Demolition recovery programmes"],
  },
  {
    slug: "copper-millberry",
    name: "Copper millberry",
    group: "Non-ferrous",
    summary: "Bare bright copper wire, free of coating and attachments, baled or loose.",
    overview: [
      "Millberry is the highest-value copper grade a yard handles, which also makes it the one most often mixed with lower-grade material. Cleanliness and the absence of tinned or lacquered wire decide the price more than tonnage does.",
      "Briefs specify whether the material is bare bright only or permits a stated proportion of No. 2, how it is presented (baled, briquetted or loose), and how contamination is handled at inspection.",
    ],
    acceptance: [
      { label: "Grade reference", value: "Millberry / bare bright, with an agreed No. 2 allowance if any" },
      { label: "Presentation", value: "Baled, briquetted or loose, as briefed" },
      { label: "Coatings", value: "No tinned, lacquered or enamelled wire" },
      { label: "Attachments", value: "No terminals, connectors or fittings" },
      { label: "Moisture", value: "Dry material only" },
    ],
    qualityChecks: [
      "Hand-sort verification at the yard",
      "Photographic record of bales or loose piles",
      "Moisture and contamination assessment",
      "Sealed and weighed per consignment",
    ],
    applications: ["Copper rod and wire production", "Alloy manufacture", "Refining feed"],
  },
  {
    slug: "aluminium-taint-tabor",
    name: "Aluminium taint/tabor",
    group: "Non-ferrous",
    summary: "Mixed aluminium sheet and cast with a declared allowance for attachments.",
    overview: [
      "Taint/tabor sits in the middle of the aluminium range: recoverable value is good, but only if the iron and non-metallic content is bounded rather than assumed. Smelters price it on the recoverable metal, not on the scale weight.",
      "We brief the permissible attachments, whether cast and sheet are mixed, and how the material is presented. Where a buyer needs a tighter fraction, we source a narrower grade rather than promising a broad one.",
    ],
    acceptance: [
      { label: "Grade reference", value: "Taint/tabor, attachments bounded by agreement" },
      { label: "Iron content", value: "Capped and verified on samples" },
      { label: "Presentation", value: "Baled or loose, as briefed" },
      { label: "Non-metallics", value: "Plastic, rubber and glass limited by agreement" },
      { label: "Moisture", value: "Dry material only" },
    ],
    qualityChecks: [
      "Sample inspection for iron and non-metallic content",
      "Visual grading of sheet-to-cast proportion",
      "Photographic record per bale or pile",
      "Weighbridge record at origin",
    ],
    applications: ["Secondary aluminium smelting", "Alloying", "Deoxidation and general foundry use"],
  },
  {
    slug: "brass-solids",
    name: "Brass solids",
    group: "Non-ferrous",
    summary: "Yellow brass solids with fittings, plated parts and mixed alloy separated out.",
    overview: [
      "Brass is a family rather than a single grade, and the difference between clean solids and mixed material with plated fittings is significant to a foundry or ingot maker. Briefs therefore separate presentation from chemistry.",
      "We source against a stated description of what is included and excluded, and inspect for the exclusions that cause rejections: aluminium fittings, stainless attachments, and leaded or plated components where they are not wanted.",
    ],
    acceptance: [
      { label: "Grade reference", value: "Yellow brass solids, inclusions listed in the brief" },
      { label: "Exclusions", value: "Aluminium, stainless and iron attachments removed" },
      { label: "Presentation", value: "Loose, baled or boxed, as briefed" },
      { label: "Plating", value: "Nickel and chrome plated items declared" },
      { label: "Moisture", value: "Dry material only" },
    ],
    qualityChecks: [
      "Sort verification against the inclusion list",
      "Photographic record of the prepared lot",
      "Sealed and weighed per consignment",
      "Documentation issued with the load",
    ],
    applications: ["Brass ingot production", "Foundry remelting", "Plumbing and fittings manufacture"],
  },
  {
    slug: "stainless-304-316",
    name: "Stainless steel 304/316",
    group: "Alloys",
    summary: "Austenitic stainless solids and turnings, sorted by series and free of attachments.",
    overview: [
      "Stainless is bought on analysis, so the brief is primarily about separation: 304 kept apart from 316, and both kept apart from duplex, ferritic and 400-series material. A mixed load is priced as the lowest grade in the pile.",
      "We brief the sorting standard, the treatment of turnings and swarf, and whether plated or coated items are acceptable. Where the buyer needs verification, testing is arranged before dispatch rather than after arrival.",
    ],
    acceptance: [
      { label: "Grade reference", value: "304 and 316 kept as separate lots" },
      { label: "Sorting", value: "No mixing with 400-series, duplex or ferritic" },
      { label: "Attachments", value: "Rubber, plastic and carbon-steel fixings removed" },
      { label: "Turnings", value: "Declared separately; free of coolant where required" },
      { label: "Verification", value: "Testing arranged on request" },
    ],
    qualityChecks: [
      "Magnetic and hand-sort verification",
      "Testing arranged when the brief requires it",
      "Photographic record per prepared lot",
      "Weighbridge record and documentation per consignment",
    ],
    applications: ["Stainless steelmaking", "Alloy addition", "Process equipment manufacture"],
  },
];

export const MATERIAL_GROUPS: MaterialGroup[] = ["Ferrous", "Non-ferrous", "Alloys"];

export function getMaterial(slug: string): Material | undefined {
  return MATERIALS.find((material) => material.slug === slug);
}
