-- Deploy schemas/auth/procedures/uid to pg

-- requires: schemas/auth/schema

BEGIN;

CREATE FUNCTION auth.uid() RETURNS uuid AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$ LANGUAGE sql STABLE;

COMMIT;
