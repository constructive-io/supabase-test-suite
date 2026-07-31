BEGIN;

ALTER TABLE app.documents 
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY documents_owner
  ON app.documents
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    owner = app_auth.current_user_id()
  );

COMMIT;