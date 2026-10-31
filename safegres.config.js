/** @type {import('safegres').SafegresConfig} */
module.exports = {
  extends: 'safegres:supabase',

  source: { pgpm: '.' },

  // The demo schemas are served next to `public`, the way a Supabase project
  // adds them under API settings → Exposed schemas.
  exposure: { schemas: ['public', 'rls_test'] },

  // Signed-in users writing their own rows is the product; only an
  // unauthenticated (anon) write grant or write policy is a finding.
  rules: {
    R1: ['critical', { rolesFrom: 'anon' }],
    R2: ['critical', { rolesFrom: 'anon' }]
  },

  excludeSchemas: ['pgpm_migrate'],

  outputs: { dir: 'safegres-reports' },

  failOn: { grade: 'B' }
};
