export type Part = {
  slug: string;
  name: string;
  summary: string;
  overview: string[];
  typicalItems: string[];
  /** What the desk needs before it can quote a sourcing route. */
  requiredInputs: string[];
  sourcingRoutes: { title: string; body: string }[];
  applications: string[];
};

/**
 * Static spare-parts content for Stage 1. Describes categories and the sourcing
 * method only: no part numbers, no stock levels, no lead-time promises, no prices.
 *
 * TODO (Stage 2): replace with product records read from PostgreSQL.
 */
export const PARTS: Part[] = [
  {
    slug: "bearings-and-seals",
    name: "Bearings and seals",
    summary: "Rolling bearings, housings and sealing elements sourced by designation or by dimension.",
    overview: [
      "Bearing procurement fails in two ways: a superseded designation that no longer maps to a stocked item, and a dimensionally identical part that does not carry the load rating the application needs. Both are recoverable if the application is described, not just the number.",
      "We work from the designation, the shaft and housing dimensions, and the duty the bearing sees. Where a manufacturer has rationalised a range, we identify the current equivalent and state the substitution explicitly rather than shipping a lookalike.",
    ],
    typicalItems: [
      "Deep groove and spherical roller bearings",
      "Taper and cylindrical roller bearings",
      "Bearing housings and plummer blocks",
      "Oil seals, O-rings and mechanical seal cartridges",
    ],
    requiredInputs: [
      "Original designation or a legible marking photograph",
      "Shaft and housing dimensions if the marking is lost",
      "Operating duty: speed, load and environment",
      "Quantity and required delivery window",
    ],
    sourcingRoutes: [
      {
        title: "Authorised distribution",
        body: "Standard current-production items are routed through authorised distribution, so traceability and warranty stay intact.",
      },
      {
        title: "Equivalent specification",
        body: "Where the original is rationalised or uneconomic, a documented equivalent is proposed with its rating differences stated up front.",
      },
      {
        title: "Reverse-engineered replacement",
        body: "For legacy equipment, dimensions and material are taken from the failed part and a replacement is produced against a drawing you approve.",
      },
    ],
    applications: ["Conveyors and material handling", "Pumps and fans", "Crushers and mills", "Rolling lines"],
  },
  {
    slug: "pumps-and-valves",
    name: "Pumps and valves",
    summary: "Process pumps, control valves and actuation for maintenance and obsolescence replacement.",
    overview: [
      "Pumps and valves are usually replaced under time pressure, which is exactly when an unchecked substitute causes the next failure: a different trim, a different seal face, a different flange drilling.",
      "We confirm the wetted materials, the operating envelope and the interface dimensions before sourcing. Where a range has been discontinued, the replacement is proposed with the differences in the connection, trim or sealing arrangement called out in writing.",
    ],
    typicalItems: [
      "Centrifugal and positive-displacement process pumps",
      "Mechanical seal and gland assemblies",
      "Gate, globe, check and butterfly valves",
      "Control valves, positioners and actuators",
    ],
    requiredInputs: [
      "Tag number, model and serial where available",
      "Nameplate photograph and connection details",
      "Fluid, temperature and pressure envelope",
      "Whether like-for-like or an upgrade is acceptable",
    ],
    sourcingRoutes: [
      {
        title: "OEM replacement",
        body: "Like-for-like replacement from the original manufacturer where the range is still supported.",
      },
      {
        title: "Cross-referenced alternative",
        body: "A documented equivalent from another manufacturer, with interface and material differences stated before order.",
      },
      {
        title: "Repair and refurbishment",
        body: "Where the body is sound, refurbishment with new internals and seals is assessed against replacement cost.",
      },
    ],
    applications: ["Process water and cooling", "Slurry and tailings", "Chemical dosing", "Steam and condensate"],
  },
  {
    slug: "gearboxes-and-drives",
    name: "Gearboxes and drives",
    summary: "Reducers, geared motors and couplings matched on ratio, torque and mounting interface.",
    overview: [
      "A gearbox swap succeeds or fails on the interface: foot or flange mounting, shaft diameter, keyway, and the ratio that the driven equipment actually needs. Ratios quoted to two decimal places matter when a line runs at a fixed speed.",
      "Briefs carry the mounting arrangement, the torque duty and the environmental conditions, so a replacement is confirmed on all three rather than on the model name alone.",
    ],
    typicalItems: [
      "Helical, bevel and worm reducers",
      "Geared motor units",
      "Shaft couplings and torque limiters",
      "Backstops and holdbacks",
    ],
    requiredInputs: [
      "Nameplate photograph with ratio and rating",
      "Mounting arrangement and shaft dimensions",
      "Duty cycle and driven equipment",
      "Environmental conditions: dust, temperature, washdown",
    ],
    sourcingRoutes: [
      {
        title: "Like-for-like supply",
        body: "Same manufacturer and ratio where the range is available, keeping the mounting and coupling unchanged.",
      },
      {
        title: "Re-rated alternative",
        body: "A higher or lower service factor is selected deliberately, with the change in envelope explained.",
      },
      {
        title: "Assembly rebuild",
        body: "Housing retained and internals renewed where the casing and mounting are still serviceable.",
      },
    ],
    applications: ["Conveyor drives", "Mixers and agitators", "Cranes and hoists", "Mill drives"],
  },
  {
    slug: "obsolete-oem-components",
    name: "Obsolete OEM components",
    summary: "Discontinued parts recovered from drawings, samples or specialist manufacturers.",
    overview: [
      "Obsolescence is the case where a part number lookup returns nothing and the machine still has to run. The work then shifts from ordering to engineering: establishing what the part does, what it must withstand, and who can make it.",
      "We start from whatever survives — a drawing, a failed sample, a maintenance manual or a measurement taken in situ — and agree the acceptance criteria with you before any metal is cut.",
    ],
    typicalItems: [
      "Discontinued castings and machined components",
      "Legacy electrical and instrumentation items",
      "Special fasteners and custom seals",
      "Wear plates, liners and bespoke spares",
    ],
    requiredInputs: [
      "Drawing, sample or in-situ measurements",
      "Material and hardness requirement if known",
      "Interface dimensions and mating parts",
      "Acceptance criteria and any testing required",
    ],
    sourcingRoutes: [
      {
        title: "Manufacture to drawing",
        body: "A workshop is selected for the material and tolerance, and the drawing is approved by you before production.",
      },
      {
        title: "Reverse engineering",
        body: "A failed sample is measured and modelled, with critical dimensions agreed before manufacture.",
      },
      {
        title: "Aftermarket and surplus search",
        body: "Documented aftermarket equivalents and traceable surplus stock are checked before committing to new manufacture.",
      },
    ],
    applications: ["Legacy production lines", "Packaging and filling equipment", "Older mill and kiln equipment", "Utilities and balance of plant"],
  },
];

export function getPart(slug: string): Part | undefined {
  return PARTS.find((part) => part.slug === slug);
}
