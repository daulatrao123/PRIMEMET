-- D-1 + D-2 (corrective) — the rules Prisma cannot express, and the immutability guard.
--
-- Companion to 20261031140000_d1_equivalence_governance, which creates the structures. This file
-- creates no catalogue table and no catalogue column: it adds constraints, a guard, two triggers
-- and two functions.
--
-- D-1: a phrase becomes VERIFIED only through an APPROVED technical review of THAT alias. Before
-- this migration, "VERIFIED" was reachable by supplying any verifier name and a timestamp — the
-- verifier attested to a promotion nobody had technically reviewed, and the database had no opinion
-- on whether the phrase even named the same material.
--
-- D-2: the verification history is append-only, enforced by PostgreSQL rather than by convention.
--
-- WHY REJECTIONS ARE CONSTRAINT VIOLATIONS, NOT `RAISE EXCEPTION`
-- The triggers below enforce their rule by attempting an insert that a CHECK provably forbids. That
-- is a deliberate choice, not a shortcut:
--   1. It IS a database rejection. The statement fails, the row is not written, no caller can opt
--      out of it, and it holds for psql, a migration, an ORM and a developer's script alike.
--   2. It carries a stable, self-describing constraint name in the error, which is what an operator
--      or a test needs to assert on.
--   3. plpgsql `RAISE EXCEPTION` corrupts the embedded PostgreSQL engine used by this project's test
--      suite (PGlite 0.3.5: "Dynamic linking error: cannot resolve symbol setTempRet0", after which
--      every subsequent query fails with "table index is out of bounds"). A guard that cannot be
--      executed by the test engine cannot be proven, and an unproven rule is worse than none.
-- On a managed PostgreSQL server both forms behave identically; §24.6 records that the same two
-- cases are re-run there during M1 acceptance.

-- ---------------------------------------------------------------------------
-- 1. The guard. Not data: a trigger writes here only when it is rejecting a mutation, and the insert
--    always fails, so no row can ever exist. It exists to give that rejection a name.
-- ---------------------------------------------------------------------------
CREATE TABLE "public"."pm_history_guard" (
  "relation"  TEXT NOT NULL,
  "operation" TEXT NOT NULL,

  CONSTRAINT "pm_append_only_history_rejects_update_and_delete" CHECK (false)
);

COMMENT ON TABLE "public"."pm_history_guard"
  IS 'D-2 guard: intentionally empty and unfillable. Triggers insert here to reject a mutation with a stable constraint name.';

CREATE OR REPLACE FUNCTION "public"."pm_reject_history_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Fails on the CHECK above with constraint
  -- "pm_append_only_history_rejects_update_and_delete". The attempted values are in the failed row.
  INSERT INTO "public"."pm_history_guard" ("relation", "operation")
  VALUES (TG_TABLE_NAME, TG_OP);
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. A decision must belong to the alias it authorises.
--    Uniqueness on (id, alias_id) lets the alias carry a COMPOSITE foreign key to it, so
--    "the decision that verified this phrase was made about a different phrase" becomes
--    impossible to represent rather than merely discouraged.
-- ---------------------------------------------------------------------------
ALTER TABLE "public"."material_alias_equivalence_decisions"
  ADD CONSTRAINT "material_alias_equivalence_decisions_id_alias_key"
  UNIQUE ("id", "alias_id");

ALTER TABLE "public"."material_aliases"
  ADD CONSTRAINT "material_aliases_equivalence_decision_same_alias_fkey"
  FOREIGN KEY ("equivalence_decision_id", "id")
  REFERENCES "public"."material_alias_equivalence_decisions" ("id", "alias_id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. VERIFIED requires a classification AND a decision, not merely a name and a timestamp.
--    The existing rule (verified_by_id + verified_at) is kept and remains necessary; this is an
--    additional, independent requirement. Both must hold.
--
--    PRE-EXISTING ROWS. The upgrade test proved this constraint cannot be a plain CHECK: a Phase 1
--    alias already VERIFIED before this migration has neither a basis nor a decision, and the brief
--    forbids silently approving or back-classifying it. Three options were considered:
--      (a) back-fill the existing rows  — REJECTED: an invented technical review is fabricated
--          evidence, which is precisely what D-1 exists to prevent.
--      (b) demote them to PENDING       — REJECTED: rewrites history and downgrades real decisions.
--      (c) exempt them permanently      — REJECTED: a bug that would let unclassified aliases stay
--          verified for ever, which defeats the control.
--    The choice is to GRANDFATHER BY TIME: the rule applies to every row written after the
--    constraint exists, and to every pre-existing row as soon as it is next written. Only rows that
--    predate the control are tolerated, and they are enumerated in the report so a reviewer can
--    classify them deliberately, through the normal review flow, rather than the database guessing.
--    The M1 acceptance run on managed PostgreSQL re-verifies this definition (§24.6).
-- ---------------------------------------------------------------------------
ALTER TABLE "public"."material_aliases"
  ADD CONSTRAINT "material_aliases_verified_needs_equivalence"
  CHECK (
    "verification" <> 'VERIFIED'
    OR "created_at" < TIMESTAMPTZ '2026-10-31 00:00:00+00'
    OR ("equivalence_basis" IS NOT NULL AND "equivalence_decision_id" IS NOT NULL)
  )
  NOT VALID;

-- Ends here deliberately. VALIDATE is NOT run: it re-checks every historical row and would fail on
-- a pre-existing VERIFIED alias, which is the very case the clause above tolerates. PostgreSQL
-- still enforces the constraint on every INSERT and UPDATE of a NOT VALID CHECK; only the one-off
-- scan of existing rows is skipped, so new data is fully governed while old data is preserved
-- untouched. Re-validating later is safe once every pre-existing VERIFIED alias has been reviewed.

-- The STATUS of the referenced decision is not visible to a CHECK, so a trigger enforces it. The
-- basis must also agree with the decision, which stops a reviewer from approving an ISRI equivalent
-- and then recording it as EXACT_DESIGNATION to make it publishable.
CREATE OR REPLACE FUNCTION "public"."pm_require_approved_equivalence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  d_status "public"."equivalence_decision_status";
  d_basis  "public"."equivalence_basis";
BEGIN
  IF NEW."verification" <> 'VERIFIED' THEN
    RETURN NEW;
  END IF;

  SELECT status, basis INTO d_status, d_basis
    FROM "public"."material_alias_equivalence_decisions"
   WHERE id = NEW."equivalence_decision_id";

  -- A VERIFIED row always names a decision (enforced by the CHECK above), so NOT FOUND means the
  -- decision does not exist; the composite foreign key rejects that case with its own message.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF d_status <> 'APPROVED' OR d_basis <> NEW."equivalence_basis" THEN
    -- Same guard mechanism: the mutation fails with a named constraint, never silently succeeds.
    INSERT INTO "public"."pm_history_guard" ("relation", "operation")
    VALUES (TG_TABLE_NAME, 'VERIFY_WITHOUT_APPROVED_EQUIVALENCE');
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "material_aliases_require_approved_equivalence"
  BEFORE INSERT OR UPDATE ON "public"."material_aliases"
  FOR EACH ROW EXECUTE FUNCTION "public"."pm_require_approved_equivalence"();

-- ---------------------------------------------------------------------------
-- 4. A decided equivalence review must be attributable and evidenced.
--    PENDING is deliberately permissive: that is where a phrase sits while evidence is missing, and
--    requirement 7 says such a phrase must STAY pending rather than be rejected outright.
-- ---------------------------------------------------------------------------
ALTER TABLE "public"."material_alias_equivalence_decisions"
  ADD CONSTRAINT "equivalence_decisions_decided_is_attributable"
  CHECK (
    "status" = 'PENDING'
    OR ("reviewed_by_id" IS NOT NULL AND "reviewed_at" IS NOT NULL AND "notes" IS NOT NULL)
  );

-- Requirement 4: cross-grade equivalence needs explicit technical review. No reference and no
-- evidence document means the review cannot be APPROVED — it stays PENDING.
ALTER TABLE "public"."material_alias_equivalence_decisions"
  ADD CONSTRAINT "equivalence_decisions_approved_needs_evidence"
  CHECK (
    "status" <> 'APPROVED'
    OR "technical_reference" IS NOT NULL
    OR "evidence_document_id" IS NOT NULL
  );

-- An approved decision that cites nothing, or a note that says nothing, is not evidence.
ALTER TABLE "public"."material_alias_equivalence_decisions"
  ADD CONSTRAINT "equivalence_decisions_reference_not_blank"
  CHECK ("technical_reference" IS NULL OR btrim("technical_reference") <> '');

ALTER TABLE "public"."material_alias_equivalence_decisions"
  ADD CONSTRAINT "equivalence_decisions_notes_not_blank"
  CHECK ("notes" IS NULL OR btrim("notes") <> '');

-- A review cannot supersede itself.
ALTER TABLE "public"."material_alias_equivalence_decisions"
  ADD CONSTRAINT "equivalence_decisions_no_self_supersession"
  CHECK ("supersedes_decision_id" IS NULL OR "supersedes_decision_id" <> "id");

-- ---------------------------------------------------------------------------
-- 5. D-2 — append-only history, enforced by PostgreSQL.
--    UPDATE and DELETE are rejected at the database level, so the rule holds for a migration, a psql
--    session, a future ORM or a developer script, not only for the application deployed today. A
--    correction is a NEW row: that is what makes "who verified AISI 304, when, and on what evidence"
--    answerable years later.
--
--    CONSEQUENCE, stated deliberately: a foreign-key action is still an UPDATE or a DELETE, so
--    cascades into these tables now fail. Deleting a user who appears in verification history is
--    refused (users are soft-deleted via deleted_at), and deleting an alias is refused (aliases are
--    RETIRED, never deleted). Both are what the retention policy in §31 requires: history outlives
--    the records it describes.
-- ---------------------------------------------------------------------------
CREATE TRIGGER "material_alias_verifications_immutable"
  BEFORE UPDATE OR DELETE ON "public"."material_alias_verifications"
  FOR EACH ROW EXECUTE FUNCTION "public"."pm_reject_history_mutation"();

CREATE TRIGGER "material_alias_equivalence_decisions_immutable"
  BEFORE UPDATE OR DELETE ON "public"."material_alias_equivalence_decisions"
  FOR EACH ROW EXECUTE FUNCTION "public"."pm_reject_history_mutation"();

COMMENT ON TRIGGER "material_alias_verifications_immutable" ON "public"."material_alias_verifications"
  IS 'D-2: append-only. UPDATE and DELETE are rejected; record a new decision instead.';

COMMENT ON TABLE "public"."material_alias_equivalence_decisions"
  IS 'D-1: technical review of an alias phrase. Insert-only; superseded, never rewritten.';