import { rmSync } from 'fs';
import { join } from 'path';

import { bundleFromModule, MigrationBundle } from '@pgpmjs/bundle';
import { materializeApplyModule, parseApplySpec, readApplySpec } from '@pgpmjs/core';
import { getConnections, PgTestClient } from 'supabase-test';

// This suite exercises the reverse direction against the vendor stack: the
// pgpm-shaped (ported) module is transpiled back into the stack's native
// shape — provider objects rebound onto the stack's own subsystem, extension
// symbols re-qualified — and deployed against the real thing. It only runs
// where that stack is available (VENDOR_STACK=1 in the vendor workflow).
const suite = process.env.VENDOR_STACK ? describe : describe.skip;

const packagesDir = join(__dirname, '..', '..');

let pg: PgTestClient;
let db: PgTestClient;
let teardown: () => Promise<void>;

const runBundle = async (client: PgTestClient, bundle: MigrationBundle) => {
  for (const change of bundle.changes) {
    if (change.deploy?.sql) await client.any(change.deploy.sql);
  }
};

suite('pgpm-shaped module transpiled onto the vendor stack', () => {
  const outDirs: string[] = [];

  beforeAll(async () => {
    ({ pg, db, teardown } = await getConnections());

    // the test database starts empty — deploy the real vendored fixture
    // first, giving the reverse-transpiled package its native subsystem
    // (and doubling as a regression check that the fixture still deploys)
    await runBundle(pg, bundleFromModule(join(packagesDir, '..', '..', 'packages', 'supabase')));
  });

  afterAll(async () => {
    for (const dir of outDirs) rmSync(dir, { recursive: true, force: true });
    await teardown();
  });

  // no per-test transaction hooks here: deploy scripts carry their own
  // BEGIN/COMMIT, which would break the savepoint-based isolation wrapper

  it('rebinds provider objects onto the native subsystem and deploys', async () => {
    // 1. the pgpm shape: subsystem substituted with the generic provider
    const ported = await materializeApplyModule({
      sourceDir: join(packagesDir, 'vendor-app'),
      spec: readApplySpec(join(packagesDir, 'vendor-app-ported'))
    });
    outDirs.push(ported.outDir);

    // 2. back to the vendor shape: provider objects rebound onto the stack's
    //    own subsystem, bare extension symbols re-qualified, roles translated
    const reverse = parseApplySpec(
      JSON.stringify({
        source: 'vendor-app-ported',
        name: 'vendor-app-native',
        schemas: { app: 'ported_app' },
        route: [
          { fromSchema: 'app_auth', kind: 'table', name: 'users', toSchema: 'auth' },
          {
            fromSchema: 'app_auth',
            kind: 'function',
            name: 'current_user_id',
            toSchema: 'auth',
            toName: 'uid'
          }
        ],
        extensions: { toSchema: 'extensions', from: [null] },
        roles: { app_authenticated: 'authenticated' }
      }),
      '/spec/pgpm.apply.json'
    );
    const native = await materializeApplyModule({
      sourceDir: ported.outDir,
      spec: reverse
    });
    outDirs.push(native.outDir);

    // 3. deploy against the real stack — the subsystem it targets exists
    //    natively, so no provider is deployed at all
    await runBundle(pg, native.bundle);

    const schema = await pg.any(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = 'ported_app'`
    );
    expect(schema.length).toBe(1);

    // the FK points at the stack's real users table
    const fk = await pg.any(`
      SELECT n.nspname || '.' || c.relname AS target
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.confrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE con.conname = 'documents_owner_fkey'
    `);
    expect(fk[0].target).toBe('auth.users');

    // the RLS policy calls the stack's own accessor
    const policy = await pg.any(`
      SELECT pg_get_expr(polqual, polrelid) AS predicate
      FROM pg_policy
      WHERE polname = 'documents_owner'
    `);
    // pg_get_expr prints search_path-visible names unqualified
    expect(policy[0].predicate).toMatch(/\buid\(\)/);
    expect(policy[0].predicate).not.toMatch(/current_user_id/);
  });
});
