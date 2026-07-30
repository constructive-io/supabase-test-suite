import { rmSync } from 'fs';
import { join } from 'path';

import { bundleFromModule, MigrationBundle } from '@pgpmjs/bundle';
import { materializeApplyModule, readApplySpec } from '@pgpmjs/core';
import { getConnections, PgTestClient } from 'pgsql-test';

const packagesDir = join(__dirname, '..', '..');

let pg: PgTestClient;
let db: PgTestClient;
let teardown: () => Promise<void>;

const runBundle = async (client: PgTestClient, bundle: MigrationBundle) => {
  for (const change of bundle.changes) {
    if (change.deploy?.sql) await client.any(change.deploy.sql);
  }
};

let outDir: string | undefined;
let aliceId: string;

beforeAll(async () => {
  ({ pg, db, teardown } = await getConnections());

  await pg.any('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await pg.any('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await pg.any(`
    DO $do$
    DECLARE r text;
    BEGIN
      FOREACH r IN ARRAY ARRAY['anonymous', 'app_authenticated'] LOOP
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
          EXECUTE format('CREATE ROLE %I', r);
        END IF;
      END LOOP;
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
        EXECUTE 'GRANT anonymous, app_authenticated TO app_user';
      END IF;
      EXECUTE format('GRANT anonymous, app_authenticated TO %I', current_user);
    END $do$;
  `);

  // the replacement provider deploys first, as an ordinary module
  await runBundle(pg, bundleFromModule(join(packagesDir, 'auth-provider')));

  // then the ported instance: source shape with its auth subsystem substituted
  const spec = readApplySpec(join(packagesDir, 'vendor-app-ported'));
  const ported = await materializeApplyModule({
    sourceDir: join(packagesDir, 'vendor-app'),
    spec
  });
  outDir = ported.outDir;
  await runBundle(pg, ported.bundle);

  await pg.any(`GRANT USAGE ON SCHEMA app, app_auth TO app_authenticated`);
  await pg.any(`GRANT EXECUTE ON FUNCTION app_auth.current_user_id() TO app_authenticated`);

  // committed seed rows for the RLS test (the per-test clients are
  // transaction-wrapped, so cross-client visibility needs committed data)
  const [alice] = await pg.any(`INSERT INTO app_auth.users DEFAULT VALUES RETURNING id`);
  const [bob] = await pg.any(`INSERT INTO app_auth.users DEFAULT VALUES RETURNING id`);
  aliceId = alice.id;
  await pg.any(`INSERT INTO app.documents (owner, title) VALUES ($1, 'alice doc')`, [alice.id]);
  await pg.any(`INSERT INTO app.documents (owner, title) VALUES ($1, 'bob doc')`, [bob.id]);
});

afterAll(async () => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
  await teardown();
});

beforeEach(async () => {
  await pg.beforeEach();
  await db.beforeEach();
});

afterEach(async () => {
  await db.afterEach();
  await pg.afterEach();
});

describe('ported package on plain PostgreSQL', () => {
  it('never deploys the excluded subsystem', async () => {
    const res = await pg.any(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = 'auth'`
    );
    expect(res.length).toBe(0);
  });

  it('rebinds the FK onto the provider users table', async () => {
    const [{ id }] = await pg.any(
      `INSERT INTO app_auth.users DEFAULT VALUES RETURNING id`
    );
    await pg.any(`INSERT INTO app.documents (owner, title) VALUES ($1, 'mine')`, [id]);

    await expect(
      pg.any(`INSERT INTO app.documents (owner, title) VALUES (gen_random_uuid(), 'nope')`)
    ).rejects.toThrow(/foreign key/i);
  });

  it('enforces RLS through the provider accessor and translated role', async () => {
    db.setContext({ role: 'app_authenticated', 'jwt.claims.user_id': aliceId });
    const visible = await db.any(`SELECT title FROM app.documents`);
    expect(visible.map((r: { title: string }) => r.title)).toEqual(['alice doc']);
  });
});
