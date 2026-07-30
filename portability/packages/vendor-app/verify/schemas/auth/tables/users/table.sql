-- Verify schemas/auth/tables/users/table on pg

BEGIN;

SELECT id FROM auth.users WHERE FALSE;

ROLLBACK;
