-- Verify schemas/auth/procedures/uid on pg

BEGIN;

SELECT auth.uid();

ROLLBACK;
