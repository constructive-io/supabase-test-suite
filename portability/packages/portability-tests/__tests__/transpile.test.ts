import { rmSync } from 'fs';
import { join } from 'path';

import { materializeApplyModule, parseApplySpec, readApplySpec } from '@pgpmjs/core';

const packagesDir = join(__dirname, '..', '..');
const sourceDir = join(packagesDir, 'vendor-app');

describe('source shape → pgpm shape (subsystem substitution)', () => {
  it('excludes the auth subsystem, rebinds survivors, de-qualifies extensions, translates roles', async () => {
    const spec = readApplySpec(join(packagesDir, 'vendor-app-ported'));
    const { bundle, outDir } = await materializeApplyModule({ sourceDir, spec });
    try {
      // the excluded subsystem's changes become emptied tombstones
      const users = bundle.changes.find(c => c.name === 'schemas/auth/tables/users/table')!;
      expect(users.deploy!.sql).not.toMatch(/CREATE TABLE/i);
      expect(users.revert!.sql).not.toMatch(/DROP TABLE/i);
      expect(users.verify!.sql).not.toMatch(/auth\.users/);

      const uid = bundle.changes.find(c => c.name === 'schemas/auth/procedures/uid')!;
      expect(uid.deploy!.sql).not.toMatch(/CREATE FUNCTION/i);

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
    const spec = readApplySpec(join(packagesDir, 'vendor-app-ported'));
    const ported = await materializeApplyModule({ sourceDir, spec });
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
