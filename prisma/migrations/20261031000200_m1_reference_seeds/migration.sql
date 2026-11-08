-- PRIMEMET — M1 reference seeds (architecture §24.2 step 19).
--
-- RULE: this migration seeds REFERENCE LISTS ONLY. No lot, quote, order, price, rate, tax rule, tax
-- treatment, composition limit, inspection result or SEO page is created here. A seeded row that
-- looks like a business record is a defect (§6.4, §24.2 step 19).
--
-- Three categories of seed, each with a different claim behind it:
--
--   A. tax_components_ref — COMPONENT NAMES ONLY. Seeding the word "CGST" states that a component
--      with that name exists in the tax vocabulary. It states nothing about whether CGST applies to
--      PRIMEMET, to any transaction model, to any invoice role, or at what rate. That is tax_rules
--      data, it is created by an authorised admin with an approval, and it stays [O-15.5].
--
--   B. inspection_methods_ref — the labels and notes the SHIPPED FRONTEND already shows to users
--      (§8.3 "[E] matches the shipped InspectionMethod values"). These are UI vocabulary, not a
--      technical claim about any material.
--
--   C. location_states — deliberately NOT seeded here. State names and ISO 3166-2 codes are a data
--      question for the location stage (M8, migration 17), and every row carries is_serviced, which
--      is a commercial statement about PRIMEMET's coverage that must be decided, not assumed.
--
-- Every insert is ON CONFLICT DO NOTHING so the seed is safe to re-run and never overwrites an
-- edited label.

-- ---------------------------------------------------------------------------
-- A. tax_components_ref — §15.5, D7
--    applies_at is the structural side of the component (which document side it can attach to).
--    It is NOT a statement that the component applies: applicability needs a tax_rules row, and no
--    ACTIVE rule is seeded. TDS/TCS are withheld at source and appear only on one side, so they are
--    seeded with that side; GST/IGST/CGST/SGST/UTGST/VAT/SALES_TAX/CESS can appear on either side
--    and are seeded BOTH because the component vocabulary makes no claim either way.
--    is_statutory records only whether the name is defined by law, not whether PRIMEMET levies it.
-- ---------------------------------------------------------------------------
INSERT INTO "public"."tax_components_ref" ("code", "name", "is_statutory", "applies_at", "sort_order") VALUES
  ('GST',             'Goods and Services Tax',                    true,  'BOTH',     10),
  ('IGST',            'Integrated Goods and Services Tax',         true,  'BOTH',     20),
  ('CGST',            'Central Goods and Services Tax',            true,  'BOTH',     30),
  ('SGST',            'State Goods and Services Tax',              true,  'BOTH',     40),
  ('UTGST',           'Union Territory Goods and Services Tax',    true,  'BOTH',     50),
  ('VAT',             'Value Added Tax',                           true,  'BOTH',     60),
  ('SALES_TAX',       'Sales Tax',                                 true,  'BOTH',     70),
  ('CESS',            'Cess',                                      true,  'BOTH',     80),
  ('TDS',             'Tax Deducted at Source',                    true,  'SALE',     90),
  ('TCS',             'Tax Collected at Source',                   true,  'PURCHASE', 100),
  ('OTHER',           'Other component',                           false, 'BOTH',     110)
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- B. inspection_methods_ref — §8.3 "[E]"
--    Keys are exactly the InspectionMethod enum values shipped in the frontend. The use_note text
--    describes what the method is, never what result a material will give.
-- ---------------------------------------------------------------------------
INSERT INTO "public"."inspection_methods_ref" ("id", "key", "label", "use_note", "sort_order") VALUES
  (gen_random_uuid(), 'VISUAL',              'Visual inspection',        'Documented visual check of form, size and general condition.', 10),
  (gen_random_uuid(), 'PHOTO_DOCUMENTATION', 'Photo documentation',      'Photographs of the material and its packaging, retained as evidence.', 20),
  (gen_random_uuid(), 'CHEMICAL_ASSAY',      'Chemical assay',           'Laboratory determination of elemental content from a sample.', 30),
  (gen_random_uuid(), 'XRF',                 'XRF analysis',             'Non-destructive handheld or bench X-ray fluorescence reading.', 40),
  (gen_random_uuid(), 'LABORATORY',          'Laboratory testing',       'Any other test conducted by a laboratory against a stated method.', 50),
  (gen_random_uuid(), 'MOISTURE',            'Moisture content',         'Measured moisture percentage, taken by the stated method.', 60),
  (gen_random_uuid(), 'CONTAMINATION',       'Contamination assessment', 'Assessment of contaminants present and their proportion.', 70),
  (gen_random_uuid(), 'FOREIGN_MATERIAL',    'Foreign material check',   'Check for material outside the declared grade.', 80),
  (gen_random_uuid(), 'WEIGHT_VERIFICATION', 'Weight verification',      'Weighment on a stated instrument at a stated location.', 90),
  (gen_random_uuid(), 'DIMENSIONAL',         'Dimensional check',        'Measurement of size, thickness or other dimensional attributes.', 100)
ON CONFLICT ("key") DO NOTHING;
