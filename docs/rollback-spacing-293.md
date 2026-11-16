# Rolling back the Spacing removal (card #293, 0.596.0)

The rollback is **code-only**: deploy 0.595.2. That engine accepts the six factor rows and places
Spacing below Requests and Over hours by itself (card #285), so no data has to come back.

This replaces the rollback note in the comment of
`prisma/migrations/20261127000000_retire_spacing_factor/migration.sql`. That note is left as it is,
because changing an applied migration changes its checksum. It re-inserts the row but keeps the
migration recorded as applied, so a later redeploy of 0.596.0 would not remove the row again (card #294).

## Bringing the Spacing row back as well (optional)

This is a write to the live database, so only do it with David's yes. In one transaction, it:

- re-inserts Spacing directly below Over hours;
- forgets the migration's ledger row, so a redeploy of 0.596.0 removes Spacing again.

It changes nothing when a Spacing row already exists.

```sql
BEGIN;
UPDATE "autogen_factors" SET "sortOrder" = "sortOrder" + 1
 WHERE "sortOrder" > (SELECT "sortOrder" FROM "autogen_factors" WHERE "key" = 'overHours')
   AND NOT EXISTS (SELECT 1 FROM "autogen_factors" WHERE "key" = 'spacing');
INSERT INTO "autogen_factors" ("id", "key", "label", "sortOrder", "enabled", "hardness", "hoursPolicy")
  SELECT 'agf_spacing', 'spacing', 'Spacing between the same shift', "sortOrder" + 1, true, 'soft', NULL
    FROM "autogen_factors" WHERE "key" = 'overHours'
     AND NOT EXISTS (SELECT 1 FROM "autogen_factors" WHERE "key" = 'spacing');
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261127000000_retire_spacing_factor';
COMMIT;
```

Test: `_scratch/mig294.sh` runs this block on a throwaway PostgreSQL cluster, with Prisma's ledger
modelled. It checks the rollback, the redeploy after it, and a second rollback.
