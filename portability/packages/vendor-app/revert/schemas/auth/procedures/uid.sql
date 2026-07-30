-- Revert schemas/auth/procedures/uid from pg

BEGIN;

DROP FUNCTION auth.uid();

COMMIT;
