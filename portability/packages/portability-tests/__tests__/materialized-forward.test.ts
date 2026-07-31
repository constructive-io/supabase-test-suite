import {
  generateCreateBaseRolesSQL,
  generateGrantRoleSQL,
  PgpmPackage
} from '@pgpmjs/core';
import { getEnvOptions } from '@pgpmjs/env';
import { getConnections, PgTestClient, seed } from 'pgsql-test';

import { FORWARD_MODULE, portabilityRoot } from '../src/materialize-fixtures';

// Forward direction, deployed from the COMMITTED ejected module — not applied
// at runtime. `portability/materialized/packages/vendor-app-materialized` is an
// ordinary pgpm module (no `pgpm.apply.json`): Supabase's auth subsystem is
// already excluded, every reference is already rebound onto the generic
// provider, and `extensions.uuid_generate_v4()` is already de-qualified to a
// bare `uuid_generate_v4()`. Deploying it exercises the "materialize once,
// deploy plain" path — pgpm resolves its `requires` (auth-provider, uuid-ossp)
// and deploys them first, exactly like any hand-written module.
const roles = {
  anonymous: 'anonymous',
  authenticated: 'authenticated',
  administrator: 'administrator',
  default: 'anonymous'
};

let pg: PgTestClient;
let db: PgTestClient;
let teardown: () => Promise<void>;

let aliceId: string;

beforeAll(async () => {
  ({ pg, db, teardown } = await getConnections({ db: { roles } }, [
    seed.fn(async ({ pg, connect }) => {
      await pg.any(generateCreateBaseRolesSQL(connect.roles));
      const appUser = connect.connections.app.user;
      for (const role of [
        connect.roles.anonymous,
        connect.roles.authenticated,
        connect.roles.administrator
      ]) {
        await pg.any(generateGrantRoleSQL(role, appUser));
      }
    }),

    // Deploy the committed, materialized module as a plain pgpm module.
    seed.fn(async ({ config }) => {
      await new PgpmPackage(portabilityRoot).deploy(
        getEnvOptions({ pg: config, deployment: { fast: true, usePlan: true } }),
        FORWARD_MODULE
      );
    }),

    seed.fn(async ({ pg }) => {
      await pg.any(`GRANT USAGE ON SCHEMA app_auth TO authenticated`);
      await pg.any(
        `GRANT EXECUTE ON FUNCTION app_auth.current_user_id() TO authenticated`
      );

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

describe('committed forward (Supabase → pgpm) module on plain PostgreSQL', () => {
  it('the excluded auth subsystem is absent from the committed module', async () => {
    const res = await pg.any(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = 'auth'`
    );
    expect(res.length).toBe(0);
  });

  it('has no extensions schema — extension calls were de-qualified', async () => {
    const res = await pg.any(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = 'extensions'`
    );
    expect(res.length).toBe(0);
  });

  it('pulled its provider dependency (app_auth) via the control requires', async () => {
    const res = await pg.any(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'app_auth' AND table_name = 'users'`
    );
    expect(res.length).toBe(1);
  });

  it('the FK is baked onto the provider users table', async () => {
    const [{ id }] = await pg.any(
      `INSERT INTO app_auth.users DEFAULT VALUES RETURNING id`
    );
    await pg.any(`INSERT INTO app.documents (owner, title) VALUES ($1, 'mine')`, [id]);

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
