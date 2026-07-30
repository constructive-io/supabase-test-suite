import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  materializeApplyModule,
  parseApplySpec,
  PgpmPackage,
  readApplySpec
} from '@pgpmjs/core';
import { getEnvOptions } from '@pgpmjs/env';
import { getConnections, PgTestClient, seed } from 'supabase-test';

// This suite exercises the reverse direction against the vendor stack: the
// pgpm-shaped (ported) module is transpiled back into the stack's native
// shape — provider objects rebound onto the stack's own subsystem, extension
// symbols re-qualified — and deployed against the real thing. It only runs
// where that stack is available (VENDOR_STACK=1 in the vendor workflow).
const suite = process.env.VENDOR_STACK ? describe : describe.skip;

const packagesDir = join(__dirname, '..', '..');
const vendorAppDir = join(packagesDir, 'vendor-app');
const portedSpecDir = join(packagesDir, 'vendor-app-ported');
const supabaseDir = join(packagesDir, '..', '..', 'packages', 'supabase');

let pg: PgTestClient;
let teardown: () => Promise<void>;

const outDirs: string[] = [];

suite('pgpm-shaped module transpiled onto the vendor stack', () => {
  beforeAll(async () => {
    ({ pg, teardown } = await getConnections({}, [
      // The real vendored fixture deploys first as an ordinary pgpm module,
      // giving the reverse-transpiled package its native subsystem (and
      // doubling as a regression check that the fixture still deploys).
      seed.pgpm(supabaseDir),

      // Round-trip: source → pgpm shape → back to the vendor shape, then deploy
      // the result as an ordinary module. No provider is deployed — the reverse
      // module's references target the stack's own auth subsystem.
      seed.fn(async ({ config }) => {
        const ported = await materializeApplyModule({
          sourceDir: vendorAppDir,
          spec: readApplySpec(portedSpecDir)
        });
        outDirs.push(ported.outDir);

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
            // the stack owns auth + the extension schema natively, so the
            // reverse module pulls in no dependencies of its own
            requires: []
          }),
          '/spec/pgpm.apply.json'
        );
        // Materialization writes a bare module (pgpm.plan + .control + scripts)
        // with no workspace marker, but native deploy resolves its target from a
        // workspace module map. Wrap the result in a throwaway single-package
        // workspace so the reverse module deploys through the ordinary path.
        const wsRoot = mkdtempSync(join(tmpdir(), 'pgpm-native-ws-'));
        outDirs.push(wsRoot);
        writeFileSync(
          join(wsRoot, 'pgpm.json'),
          JSON.stringify({ packages: ['packages/*'] })
        );

        await materializeApplyModule({
          sourceDir: ported.outDir,
          spec: reverse,
          outDir: join(wsRoot, 'packages', 'vendor-app-native')
        });

        const workspace = new PgpmPackage(wsRoot);
        await workspace.deploy(
          getEnvOptions({
            pg: config,
            deployment: { fast: true, usePlan: true }
          }),
          'vendor-app-native'
        );
      })
    ]));
  });

  afterAll(async () => {
    for (const dir of outDirs) rmSync(dir, { recursive: true, force: true });
    await teardown();
  });

  it('rebinds provider objects onto the native subsystem and deploys', async () => {
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
