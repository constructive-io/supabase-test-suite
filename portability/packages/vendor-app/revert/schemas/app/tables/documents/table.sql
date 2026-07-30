-- Revert schemas/app/tables/documents/table from pg

BEGIN;

DROP TABLE app.documents;

COMMIT;
