-- Deploy schemas/app/policies/documents_owner to pg

-- requires: schemas/app/tables/documents/table
-- requires: schemas/auth/procedures/uid

BEGIN;

ALTER TABLE app.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY documents_owner ON app.documents
  USING (owner = auth.uid());

COMMIT;
