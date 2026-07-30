import { readFileSync } from 'fs';
import { join } from 'path';

import { excludeSubsystem } from '@pgpmjs/slice';
import { buildSchemaRouter, loadModule } from '@pgpmjs/transform';

// The real vendored fixture this repository tests against.
const fixtureSql = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'packages', 'supabase', 'deploy', 'supabase.sql'),
  'utf8'
);

beforeAll(async () => {
  await loadModule();
});

describe('measured contract of the vendored auth subsystem', () => {
  it('the external surface is a single users FK target — nothing more', () => {
    const { contract } = excludeSubsystem(fixtureSql, { schemas: ['auth'] });

    const required = new Map(contract.required.map(r => [r.object.name, r]));

    // the only *data* dependency: auth.users, referenced via FKs
    expect(required.has('users')).toBe(true);
    expect(required.get('users')!.fk).toBe(true);

    // the claim accessors are NOT part of the measured contract — defined but
    // with no live call sites outside the subsystem in this fixture
    expect(required.has('uid')).toBe(false);
    expect(required.has('email')).toBe(false);

    // everything required is within the tiny substitution surface
    for (const name of required.keys()) {
      expect(['users', 'uid', 'role']).toContain(name);
    }

    // the rest of the subsystem — dozens of objects — is internal
    // implementation detail, droppable wholesale
    expect(contract.internal.length).toBeGreaterThan(40);
    const internalNames = contract.internal.map(o => o.name);
    expect(internalNames).toContain('email');
    expect(internalNames).toContain('uid');
  });

  it('a substitution covering the measured surface satisfies every surviving reference', () => {
    const rebinds = buildSchemaRouter({
      routes: [
        { fromSchema: 'auth', kind: 'table', name: 'users', toSchema: 'app_auth' },
        {
          fromSchema: 'auth',
          kind: 'function',
          name: 'uid',
          toSchema: 'app_auth',
          toName: 'current_user_id'
        },
        {
          fromSchema: 'auth',
          kind: 'function',
          name: 'role',
          toSchema: 'app_auth',
          toName: 'current_role_name'
        }
      ]
    });
    const { unsatisfied } = excludeSubsystem(fixtureSql, { schemas: ['auth'] }, { rebinds });
    expect(unsatisfied).toEqual([]);
  });

  it('without a substitution the exclusion is refused with named diagnostics', () => {
    const { unsatisfied } = excludeSubsystem(fixtureSql, { schemas: ['auth'] });
    const names = new Set(unsatisfied.map(u => u.object.name));
    expect(names.has('users')).toBe(true);
  });
});
