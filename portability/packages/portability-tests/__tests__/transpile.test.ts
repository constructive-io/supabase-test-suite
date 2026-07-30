import { rmSync } from 'fs';
import { join } from 'path';

import { materializeApplyModule, parseApplySpec } from '@pgpmjs/core';

const packagesDir = join(__dirname, '..', '..');
const sourceDir = join(packagesDir, 'vendor-app');

// The full set of transforms, expressed inline so this capability demo is
// independent of the deployable on-disk spec (which uses native standard
// roles). Here we additionally translate the role to exercise role routing.
const portedSpec = () =>
  parseApplySpec(
    JSON.stringify({
      source: 'vendor-app',
      name: 'vendor-app-ported',
      exclude: { schemas: ['auth'] },
      route: [
        { fromSchema: 'auth', kind: 'table', name: 'users', toSchema: 'app_auth' },
        {
          fromSchema: 'auth',
          kind: 'function',
          name: 'uid',
          toSchema: 'app_auth',
          toName: 'current_user_id'
        }
      ],
      extensions: { toSchema: null, from: ['extensions'] },
      roles: { authenticated: 'app_authenticated' },
      requires: ['auth-provider', 'uuid-ossp']
    }),
    '/spec/pgpm.apply.json'
  );

describe('source shape → pgpm shape (subsystem substitution)', () => {
  it('drops the auth subsystem, rebinds survivors, de-qualifies extensions, translates roles', async () => {
    const { bundle, outDir } = await materializeApplyModule({
      sourceDir,
      spec: portedSpec()
    });
    try {
      // the excluded subsystem's changes are dropped from the artifact
      // entirely — not emitted as empty tombstones (those collide on the
      // deploy ledger's script-hash uniqueness)
      expect(
        bundle.changes.find(c => c.name === 'schemas/auth/tables/users/table')
      ).toBeUndefined();
      expect(
        bundle.changes.find(c => c.name === 'schemas/auth/procedures/uid')
      ).toBeUndefined();
      expect(
        bundle.changes.find(c => c.name === 'schemas/auth/schema')
      ).toBeUndefined();
      expect(bundle.plan).not.toMatch(/schemas\/auth\//);

      // FK rebound onto the provider's users table
      const documents = bundle.changes.find(
        c => c.name === 'schemas/app/tables/documents/table'
      )!;
      expect(documents.deploy!.sql).toMatch(/REFERENCES app_auth\.users/i);
      expect(documents.deploy!.sql).not.toMatch(/(?<!app_)auth\.users/);

      // extension symbols de-qualified (rely on search_path — never `extensions.`)
      expect(documents.deploy!.sql).toMatch(/DEFAULT uuid_generate_v4\(\)/i);
      expect(documents.deploy!.sql).not.toMatch(/extensions\./);

      // roles translated
      expect(documents.deploy!.sql).toMatch(/TO app_authenticated/i);
      expect(documents.deploy!.sql).not.toMatch(/\bauthenticated\b/);

      // RLS predicate rebound onto the provider accessor
      const policy = bundle.changes.find(
        c => c.name === 'schemas/app/policies/documents_owner'
      )!;
      expect(policy.deploy!.sql).toMatch(/app_auth\.current_user_id\s*\(\)/i);
      expect(policy.deploy!.sql).not.toMatch(/auth\.uid/);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('refuses the exclusion when a surviving reference has no substitute', async () => {
    const spec = parseApplySpec(
      JSON.stringify({
        source: 'vendor-app',
        name: 'vendor-app-ported',
        exclude: { schemas: ['auth'] },
        route: [{ fromSchema: 'auth', kind: 'table', name: 'users', toSchema: 'app_auth' }]
      }),
      '/spec/pgpm.apply.json'
    );
    await expect(materializeApplyModule({ sourceDir, spec })).rejects.toThrow(
      /auth\.uid.*no route\/rebind target/s
    );
  });
});

describe('pgpm shape → source shape (reverse direction)', () => {
  it('routes provider objects back into the subsystem shape and re-qualifies extensions', async () => {
    // start from the ported (pgpm-shaped) output and transpile it back
    const ported = await materializeApplyModule({ sourceDir, spec: portedSpec() });
    try {
      const reverse = parseApplySpec(
        JSON.stringify({
          source: 'vendor-app-ported',
          name: 'vendor-app-roundtrip',
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
      const roundtrip = await materializeApplyModule({
        sourceDir: ported.outDir,
        spec: reverse
      });
      try {
        const documents = roundtrip.bundle.changes.find(
          c => c.name === 'schemas/app/tables/documents/table'
        )!;
        expect(documents.deploy!.sql).toMatch(/REFERENCES auth\.users/i);
        expect(documents.deploy!.sql).toMatch(/extensions\.uuid_generate_v4\(\)/i);
        expect(documents.deploy!.sql).toMatch(/TO authenticated/i);
        expect(documents.deploy!.sql).not.toMatch(/app_auth\./);
        expect(documents.deploy!.sql).not.toMatch(/\bapp_authenticated\b/);

        const policy = roundtrip.bundle.changes.find(
          c => c.name === 'schemas/app/policies/documents_owner'
        )!;
        expect(policy.deploy!.sql).toMatch(/auth\.uid\s*\(\)/i);
        expect(policy.deploy!.sql).not.toMatch(/current_user_id/);
      } finally {
        rmSync(roundtrip.outDir, { recursive: true, force: true });
      }
    } finally {
      rmSync(ported.outDir, { recursive: true, force: true });
    }
  });
});
