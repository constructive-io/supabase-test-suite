-- Revert schemas/app/policies/documents_owner from pg

BEGIN;

DROP POLICY documents_owner ON app.documents;

COMMIT;
