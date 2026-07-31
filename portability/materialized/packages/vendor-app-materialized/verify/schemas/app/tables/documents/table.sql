BEGIN;

SELECT
  id,
  owner,
  title
FROM app.documents
WHERE
  false;

ROLLBACK;