-- Revert schemas/auth/schema from pg

BEGIN;

DROP SCHEMA auth;

COMMIT;
