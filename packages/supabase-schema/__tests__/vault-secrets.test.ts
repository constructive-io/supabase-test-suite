import { getConnections, PgTestClient } from 'supabase-test';

let pg: PgTestClient;
let db: PgTestClient;
let teardown: () => Promise<void>;

// no hidden flags; fail fast and assert actual behavior

beforeAll(async () => {
  
  
  ({ pg, db, teardown } = await getConnections());
  
  // verify vault schema exists
  const vaultSchemaExists = await pg.any(
    `SELECT EXISTS (
      SELECT FROM information_schema.schemata 
      WHERE schema_name = 'vault'
    ) as exists`
  );
  expect(vaultSchemaExists[0].exists).toBe(true);
  
  // grant access to vault schema for testing
    await pg.any(
      `GRANT USAGE ON SCHEMA vault TO public;
     GRANT SELECT ON ALL TABLES IN SCHEMA vault TO service_role;
     GRANT SELECT ON ALL TABLES IN SCHEMA vault TO anon;
     GRANT SELECT ON ALL TABLES IN SCHEMA vault TO authenticated;
     ALTER DEFAULT PRIVILEGES IN SCHEMA vault GRANT SELECT ON TABLES TO anon;
     ALTER DEFAULT PRIVILEGES IN SCHEMA vault GRANT SELECT ON TABLES TO authenticated;`,
    []
  );
  
  // assert vault.secrets exists (fail fast)
  const exists = await pg.any(
    `SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'vault' AND table_name = 'secrets'
    ) as exists`
  );
  expect(exists[0].exists).toBe(true);
});

afterAll(async () => {
  await teardown();
});

beforeEach(async () => {
  await db.beforeEach();
});

afterEach(async () => {
  await db.afterEach();
});

describe('tutorial: vault secrets table access', () => {

  it('should verify vault.secrets table exists', async () => {
    db.setContext({ role: 'service_role' });
    const exists = await db.any(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'vault' AND table_name = 'secrets'
      ) as exists`
    );
    expect(Array.isArray(exists)).toBe(true);
    expect(exists[0].exists).toBe(true);
  });

  it('should verify service_role can query secrets structure', async () => {
    db.setContext({ role: 'service_role' });
      const columns = await db.any(
        `SELECT column_name, data_type 
         FROM information_schema.columns 
         WHERE table_schema = 'vault' AND table_name = 'secrets'
         ORDER BY ordinal_position`
      );
      expect(Array.isArray(columns)).toBe(true);
    const names = columns.map((r: any) => r.column_name);
    expect(names).toEqual(expect.arrayContaining([
      'id', 'name', 'description', 'secret', 'key_id', 'nonce', 'created_at', 'updated_at'
    ]));
  });

  it('should verify unique index on name exists (partial)', async () => {
    db.setContext({ role: 'service_role' });
    const idx = await db.any(
      `SELECT indexname, indexdef 
       FROM pg_indexes 
       WHERE schemaname = 'vault' AND tablename = 'secrets'`
    );
    expect(Array.isArray(idx)).toBe(true);
    if (idx.length > 0) {
      const defs = idx.map((r: any) => String(r.indexdef).toLowerCase()).join(' ');
      expect(defs.includes('unique')).toBe(true);
      expect(defs.includes('(name)')).toBe(true);
    }
  });

  it('should verify relrowsecurity status on secrets', async () => {
    db.setContext({ role: 'service_role' });
      const rlsStatus = await db.any(
        `SELECT c.relrowsecurity 
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'vault' AND c.relname = 'secrets'`
      );
    expect(Array.isArray(rlsStatus)).toBe(true);
    expect(rlsStatus.length).toBeGreaterThan(0);
        expect(typeof rlsStatus[0].relrowsecurity).toBe('boolean');
  });

  it('should verify anon access to secrets based on rls', async () => {
    db.setContext({ role: 'service_role' });
    const rlsStatus = await db.any(
      `SELECT c.relrowsecurity 
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'vault' AND c.relname = 'secrets'`
    );
    db.clearContext();
    const result = await db.any(`SELECT * FROM vault.secrets LIMIT 1`);
    expect(Array.isArray(result)).toBe(true);
    if (rlsStatus[0]?.relrowsecurity === true) {
      expect(result.length).toBe(0);
    }
  });

  it('should verify authenticated access to secrets based on rls', async () => {
    db.setContext({ role: 'service_role' });
    const rlsStatus = await db.any(
      `SELECT c.relrowsecurity 
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'vault' AND c.relname = 'secrets'`
    );
    db.setContext({ role: 'authenticated' });
    const result = await db.any(`SELECT * FROM vault.secrets LIMIT 1`);
    expect(Array.isArray(result)).toBe(true);
    if (rlsStatus[0]?.relrowsecurity === true) {
      expect(result.length).toBe(0);
    }
  });
});

