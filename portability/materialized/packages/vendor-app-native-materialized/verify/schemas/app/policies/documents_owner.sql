BEGIN;

SELECT owner
FROM app.documents
WHERE
  false;

ROLLBACK;