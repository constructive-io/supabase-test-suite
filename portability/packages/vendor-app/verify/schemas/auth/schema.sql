-- Verify schemas/auth/schema on pg

BEGIN;

SELECT pg_catalog.has_schema_privilege('auth', 'usage');

ROLLBACK;
