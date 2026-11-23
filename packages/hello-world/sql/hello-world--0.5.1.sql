\echo Use "CREATE EXTENSION hello-world" to load this file. \quit
CREATE SCHEMA IF NOT EXISTS rls_test;

CREATE TABLE IF NOT EXISTS rls_test.pets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id)
    ON DELETE CASCADE,
  name text NOT NULL,
  breed text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE rls_test.pets 
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own data"
  ON rls_test.pets
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (
    auth.uid() = user_id
  );

CREATE POLICY "Users can update own data"
  ON rls_test.pets
  AS PERMISSIVE
  FOR UPDATE
  TO PUBLIC
  USING (
    auth.uid() = user_id
  );

CREATE POLICY "Users can insert own data"
  ON rls_test.pets
  AS PERMISSIVE
  FOR INSERT
  TO PUBLIC
  WITH CHECK (
    auth.uid() = user_id
  );

CREATE POLICY "Users can delete own data"
  ON rls_test.pets
  AS PERMISSIVE
  FOR DELETE
  TO PUBLIC
  USING (
    auth.uid() = user_id
  );

GRANT USAGE ON SCHEMA rls_test TO anon;

GRANT ALL ON rls_test.pets TO anon;

GRANT USAGE ON SCHEMA rls_test TO authenticated;

GRANT ALL ON rls_test.pets TO authenticated;

GRANT USAGE ON SCHEMA rls_test TO service_role;

GRANT ALL ON rls_test.pets TO service_role;

CREATE INDEX IF NOT EXISTS idx_users_user_id ON rls_test.pets (user_id);

CREATE OR REPLACE FUNCTION rls_test.update_updated_at_column() RETURNS trigger AS $EOFCODE$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$EOFCODE$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE
  ON rls_test.pets
  FOR EACH ROW
  EXECUTE FUNCTION rls_test.update_updated_at_column();