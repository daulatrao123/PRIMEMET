export type FaqItem = { question: string; answer: string };
export type FaqGroup = { title: string; items: FaqItem[] };

/** Process and policy answers only. No claims about volumes, clients or results. */
export const FAQ_GROUPS: FaqGroup[] = [
  {
    title: "Working with PRIMEMET",
    items: [
      {
        question: "What does \"managed sourcing\" actually mean?",
        answer:
          "It means PRIMEMET owns the whole chain rather than passing a contact across to a supplier. You send one brief; we specify it, shortlist qualified suppliers, inspect before dispatch, coordinate freight and hand you a reconciled record of what was delivered. One point of contact, one version of the facts.",
      },
      {
        question: "Are you a trader or an agent?",
        answer:
          "Neither model describes it well. We run the programme on your behalf and remain accountable for the outcome, and we disclose which supplier or workshop a lot came from. We do not hide the source behind an unexplained margin.",
      },
      {
        question: "What is the smallest brief you will look at?",
        answer:
          "There is no published minimum, because the answer depends on the material and the route. A single obsolete part can be worth the work; a small tonnage of a commodity grade may not be. Send the brief and the desk will say plainly whether it is viable.",
      },
      {
        question: "How long does a first response take?",
        answer:
          "Timelines are agreed per programme when a brief is confirmed, and complex spare-parts recoveries that need drawing review are quoted with their own lead time. We do not publish a headline response promise that desk capacity cannot always meet.",
      },
    ],
  },
  {
    title: "Scrap metal supply",
    items: [
      {
        question: "Can you supply to a written specification rather than a grade name?",
        answer:
          "That is the normal way we work. Grade names carry regional variation, so a brief sets out sizing, contamination limits, presentation and the inspection standard. The specification is confirmed back to you in writing before sourcing begins.",
      },
      {
        question: "What happens if a delivered lot does not match the brief?",
        answer:
          "It is recorded as a non-conformance against the consignment, with photographs and the weighbridge position, and it is resolved with the supplier at PRIMEMET's cost rather than being passed to you as a discussion. The record exists so the same supplier is not used the same way again.",
      },
      {
        question: "Do you publish prices on the site?",
        answer:
          "No. Scrap pricing moves with grade, volume, destination and freight, and a published figure would be wrong more often than it is useful. Pricing is agreed per brief once the specification and delivery route are fixed.",
      },
      {
        question: "How is contamination handled?",
        answer:
          "Contamination limits are part of the brief, and lots are screened and visually graded before dispatch. Radiation screening is a standard step on ferrous loads, and closed or sealed items are excluded by specification rather than checked for at the furnace.",
      },
    ],
  },
  {
    title: "Spare parts",
    items: [
      {
        question: "What do you need to source a part I cannot identify?",
        answer:
          "As much as survives: a nameplate photograph, a drawing, a maintenance manual page, or measurements taken on the machine. Where a part has been discontinued, we establish what it does and what it must withstand before proposing a route.",
      },
      {
        question: "Will you propose a substitute for an obsolete part?",
        answer:
          "Only with the differences stated in writing — connection dimensions, materials, rating or sealing arrangement. The decision to accept a substitution stays with you, and nothing is ordered against an unapproved alternative.",
      },
      {
        question: "Can you manufacture a replacement?",
        answer:
          "Where a drawing or a measurable sample exists, yes. A workshop is matched to the material and tolerance, the drawing is approved by you before production, and the acceptance criteria are agreed up front.",
      },
    ],
  },
  {
    title: "Suppliers and partners",
    items: [
      {
        question: "How do I become a supplier?",
        answer:
          "Register your business through the supplier route with the materials or parts you handle and where you operate. The desk reviews the information against live briefs and comes back to you when there is a fit — there is no automatic approval.",
      },
      {
        question: "What information will you ask for?",
        answer:
          "Business identity, the categories you actually handle, your operating location, and the licences or permits that apply to your activity. We ask for what a buyer's audit would ask for, and no more.",
      },
      {
        question: "Will my details be shown to buyers?",
        answer:
          "No. Supplier identity, purchase costs, margins and internal notes stay on the internal side of the platform. Buyers see the material or part, the specification and the price offered to them — not your identity or your commercial position.",
      },
    ],
  },
  {
    title: "This website",
    items: [
      {
        question: "Can I submit an enquiry through this site yet?",
        answer:
          "Not yet. The site is a frontend preview and the forms are layout only — they do not send, store or email anything. Enquiry submission is switched on when the platform is connected in a later stage.",
      },
      {
        question: "Is the catalogue live?",
        answer:
          "The material and spare-parts pages describe the categories and the sourcing method. They are not a live catalogue: no tonnage, stock position or availability is published, because those figures belong in the database rather than on a marketing page.",
      },
      {
        question: "Do the portal screens work?",
        answer:
          "They are interface previews. Sign-in, role permissions and record keeping arrive in a later stage, so nothing in the admin, buyer or seller areas creates, changes or stores data today.",
      },
    ],
  },
];
