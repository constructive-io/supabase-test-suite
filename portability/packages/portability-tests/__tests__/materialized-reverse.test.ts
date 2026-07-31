import { join } from 'path';

import { PgpmPackage } from '@pgpmjs/core';
import { getEnvOptions } from '@pgpmjs/env';
import { getConnections, PgTestClient, seed } from 'supabase-test';

import { portabilityRoot, REVERSE_MODULE } from '../src/materialize-fixtures';

// Reverse direction, deployed from the COMMITTED ejected module against the
// vendor stack. The pgpm-shaped app was materialized back onto Supabase's
// native subsystem: the committed SQL in `vendor-app-native-materialized`
// references `auth.users` / `auth.uid()` and re-qualifies extension calls into
// `extensions.uuid_generate_v4()`. Those objects only exist on the real stack
// (the `supabase` fixture needs `pg_graphql`/`supabase_vault`, unavailable on
// plain postgres-plus), so this suite runs only where the stack is available
// (VENDOR_STACK=1 in the vendor workflow). Determinism and the ejected SQL for
// this direction are covered on plain PG by `materialized-drift.test.ts`.
const suite = process.env.VENDOR_STACK ? describe : describe.skip;

const supabaseDir = join(portabilityRoot, '..', 'packages', 'supabase');

let pg: PgTestClient;
let teardown: () => Promise<void>;

suite('committed reverse (pgpm → Supabase) module on the vendor stack', () => {
  beforeAll(async () => {
    ({ pg, teardown } = await getConnections({}, [
      // The real vendored fixture deploys first as an ordinary pgpm module,
      // giving the reverse-transpiled package its native subsystem (auth +
      // the extensions schema) and doubling as a fixture regression check.
      seed.pgpm(supabaseDir),

      // Deploy the committed reverse module as a plain pgpm module on top. Its
      // control `requires` is just plpgsql — the stack owns auth and the
      // extension schema natively.
      seed.fn(async ({ config }) => {
        await new PgpmPackage(portabilityRoot).deploy(
          getEnvOptions({ pg: config, deployment: { fast: true, usePlan: true } }),
          REVERSE_MODULE
        );
      })
    ]));
  });

  afterAll(async () => {
    await teardown();
  });

  beforeEach(async () => {
    await pg.beforeEach();
  });

  afterEach(async () => {
    await pg.afterEach();
  });

  it('the native auth subsystem is present', async () => {
    const res = await pg.any(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users'`
    );
    expect(res.length).toBe(1);
  });

  it('the FK is baked onto the native users table', async () => {
    const fk = await pg.any(`
      SELECT n.nspname || '.' || c.relname AS target
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.confrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE con.conname = 'documents_owner_fkey'
    `);
    expect(fk[0].target).toBe('auth.users');
  });

  it('the RLS predicate is baked onto the native accessor', async () => {
    const policy = await pg.any(`
      SELECT pg_get_expr(polqual, polrelid) AS predicate
      FROM pg_policy
      WHERE polname = 'documents_owner'
    `);
    expect(policy[0].predicate).toMatch(/\buid\(\)/);
    expect(policy[0].predicate).not.toMatch(/current_user_id/);
  });
});
