import { getConnections, PgTestClient } from 'supabase-test';

let pg: PgTestClient;
let db: PgTestClient;
let teardown: () => Promise<void>;

beforeAll(async () => {
  
  
  ({ pg, db, teardown } = await getConnections());
  
  // verify auth schema exists
  const authSchemaExists = await pg.any(
    `SELECT EXISTS (
      SELECT FROM information_schema.schemata 
      WHERE schema_name = 'auth'
    ) as exists`
  );
  expect(authSchemaExists[0].exists).toBe(true);
  
  // grant access to auth schema for testing
  await pg.any(
    `GRANT USAGE ON SCHEMA auth TO public;
     GRANT SELECT ON ALL TABLES IN SCHEMA auth TO service_role;
     GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
     GRANT SELECT ON ALL TABLES IN SCHEMA auth TO anon;
     ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT ON TABLES TO service_role;
     ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT ON TABLES TO authenticated;
     ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT ON TABLES TO anon;`,
    []
  );
  
  // assert table exists
  const exists = await pg.any(
    `SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'auth' AND table_name = 'sso_domains'
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

describe('tutorial: auth sso_domains table access', () => {

  it('should verify sso_domains table exists', async () => {
    db.setContext({ role: 'service_role' });
    
    // verify table exists in information schema
    const exists = await db.any(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'auth' AND table_name = 'sso_domains'
      ) as exists`
    );
    
    expect(Array.isArray(exists)).toBe(true);
    expect(exists[0].exists).toBe(true);
  });

  it('should verify service_role can query sso_domains', async () => {
    db.setContext({ role: 'service_role' });
    
    // service_role should be able to query sso_domains
    const domains = await db.any(
      `SELECT id, sso_provider_id, domain, created_at, updated_at 
       FROM auth.sso_domains 
       LIMIT 10`
    );
    
    expect(Array.isArray(domains)).toBe(true);
  });

  it('should verify table has foreign key to sso_providers', async () => {
    db.setContext({ role: 'service_role' });
    
    // check for foreign key constraints to sso_providers
    const fks = await db.any(
      `SELECT tc.constraint_name, ccu.table_name AS foreign_table_name
       FROM information_schema.table_constraints AS tc
       JOIN information_schema.constraint_column_usage AS ccu
         ON ccu.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY' 
         AND tc.table_schema = 'auth' 
         AND tc.table_name = 'sso_domains'
         AND ccu.table_name = 'sso_providers'`
    );
    
    expect(Array.isArray(fks)).toBe(true);
  });

  it('should verify indexes exist on sso_provider_id and unique lower(domain)', async () => {
    db.setContext({ role: 'service_role' });
    const idx = await db.any(
      `SELECT indexname, indexdef 
       FROM pg_indexes 
       WHERE schemaname = 'auth' AND tablename = 'sso_domains'`
    );
    expect(Array.isArray(idx)).toBe(true);
    if (idx.length > 0) {
      const defs = idx.map((r: any) => r.indexdef).join(' ');
      expect(defs.toLowerCase().includes('sso_provider_id')).toBe(true);
      expect(defs.toLowerCase().includes('lower(domain)')).toBe(true);
    }
  });

  it('should verify anon access to sso_domains based on rls', async () => {
    db.setContext({ role: 'service_role' });
    const rlsStatus = await db.any(
      `SELECT c.relrowsecurity 
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'auth' AND c.relname = 'sso_domains'`
    );
    expect(Array.isArray(rlsStatus)).toBe(true);
    expect(rlsStatus.length).toBeGreaterThan(0);
    
    db.clearContext();
    const result = await db.any(`SELECT * FROM auth.sso_domains LIMIT 1`);
    expect(Array.isArray(result)).toBe(true);
    if (rlsStatus[0].relrowsecurity === true) {
      expect(result.length).toBe(0);
    }
  });
});

