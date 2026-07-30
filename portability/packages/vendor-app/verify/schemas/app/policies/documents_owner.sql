-- Verify schemas/app/policies/documents_owner on pg

BEGIN;

SELECT owner FROM app.documents WHERE FALSE;

ROLLBACK;
