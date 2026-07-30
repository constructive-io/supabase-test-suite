-- Verify schemas/app/tables/documents/table on pg

BEGIN;

SELECT id, owner, title FROM app.documents WHERE FALSE;

ROLLBACK;
