-- Revert schemas/auth/tables/users/table from pg

BEGIN;

DROP TABLE auth.users;

COMMIT;
