import { join } from 'path';

import { PgpmPackage } from '@pgpmjs/core';
import { getEnvOptions } from '@pgpmjs/env';
import { getConnections, PgTestClient, seed } from 'pgsql-test';

const packagesDir = join(__dirname, '..', '..');
const workspaceRoot = join(packagesDir, '..');

let pg: PgTestClient;
let db: PgTestClient;
let teardown: () => Promise<void>;

let aliceId: string;

beforeAll(async () => {
  ({ pg, db, teardown } = await getConnections({}, [
    // Deploy the apply proxy as an ordinary workspace module. pgpm resolves
    // its declared dependencies from the workspace and deploys them in order:
    // the generic auth-provider module first, its uuid-ossp extension, then the
    // transpiled application on top — no hand-rolled statement loop, no raw
    // CREATE EXTENSION, no imperative role bootstrap.
    seed.fn(async ({ config }) => {
      const workspace = new PgpmPackage(workspaceRoot);
      await workspace.deploy(
        getEnvOptions({
          pg: config,
          deployment: { fast: true, usePlan: true }
        }),
        'vendor-app-ported'
      );
    }),
    seed.fn(async ({ pg }) => {
      // Narrow, application-level grants: the consumer role reaches the generic
      // provider's objects it depends on (the provider is role-agnostic).
      await pg.any(`GRANT USAGE ON SCHEMA app_auth TO authenticated`);
      await pg.any(
        `GRANT EXECUTE ON FUNCTION app_auth.current_user_id() TO authenticated`
      );

      // Committed seed rows for the RLS test (the per-test clients are
      // transaction-wrapped, so cross-client visibility needs committed data).
      const [alice] = await pg.any(
        `INSERT INTO app_auth.users DEFAULT VALUES RETURNING id`
      );
      const [bob] = await pg.any(
        `INSERT INTO app_auth.users DEFAULT VALUES RETURNING id`
      );
      aliceId = alice.id;
      await pg.any(
        `INSERT INTO app.documents (owner, title) VALUES ($1, 'alice doc')`,
        [alice.id]
      );
      await pg.any(
        `INSERT INTO app.documents (owner, title) VALUES ($1, 'bob doc')`,
        [bob.id]
      );
    })
  ]));
});

afterAll(async () => {
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
    await pg.any(`INSERT INTO app.documents (owner, title) VALUES ($1, 'mine')`, [
      id
    ]);

    await expect(
      pg.any(
        `INSERT INTO app.documents (owner, title) VALUES (gen_random_uuid(), 'nope')`
      )
    ).rejects.toThrow(/foreign key/i);
  });

  it('enforces RLS through the provider accessor', async () => {
    db.setContext({ role: 'authenticated', 'jwt.claims.user_id': aliceId });
    const visible = await db.any(`SELECT title FROM app.documents`);
    expect(visible.map((r: { title: string }) => r.title)).toEqual(['alice doc']);
  });
});
