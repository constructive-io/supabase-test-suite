BEGIN;

SELECT pg_catalog.has_schema_privilege('app', 'usage');

ROLLBACK;