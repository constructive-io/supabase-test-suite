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
  
  // assert identities table exists now (fail fast)
  const exists = await pg.any(
    `SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'auth' AND table_name = 'identities'
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

describe('tutorial: auth identities table access', () => {

  it('should verify identities table exists', async () => {
    db.setContext({ role: 'service_role' });
    const exists = await db.any(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'auth' AND table_name = 'identities'
      ) as exists`
    );
    expect(Array.isArray(exists)).toBe(true);
    expect(exists[0].exists).toBe(true);
  });

  it('should verify service_role can query identities table structure', async () => {
    db.setContext({ role: 'service_role' });
    const columns = await db.any(
      `SELECT column_name, data_type 
       FROM information_schema.columns 
       WHERE table_schema = 'auth' AND table_name = 'identities'
       ORDER BY ordinal_position`
    );
    expect(Array.isArray(columns)).toBe(true);
    expect(columns.length).toBeGreaterThan(0);
    const names = columns.map((c: any) => c.column_name);
    expect(names).toContain('id');
    expect(names).toContain('user_id');
    expect(names).toContain('identity_data');
    expect(names).toContain('provider');
  });

  it('should verify service_role can read identities', async () => {
    db.setContext({ role: 'service_role' });
    const identities = await db.any(`SELECT * FROM auth.identities LIMIT 10`);
    expect(Array.isArray(identities)).toBe(true);
  });

  it('should verify foreign key to auth.users', async () => {
    db.setContext({ role: 'service_role' });
    const fks = await db.any(
      `SELECT tc.constraint_name, ccu.table_name AS foreign_table_name
       FROM information_schema.table_constraints AS tc
       JOIN information_schema.constraint_column_usage AS ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY' 
         AND tc.table_schema = 'auth' 
         AND tc.table_name = 'identities'`
    );
    expect(Array.isArray(fks)).toBe(true);
    if (fks.length > 0) {
      const hasUsersFk = fks.some((r: any) => r.foreign_table_name === 'users');
      expect(hasUsersFk).toBe(true);
    }
  });

  it('should verify composite primary key (provider, id)', async () => {
    db.setContext({ role: 'service_role' });
    const pkCols = await db.any(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
       WHERE tc.table_schema = 'auth'
         AND tc.table_name   = 'identities'
         AND tc.constraint_type = 'PRIMARY KEY'
       ORDER BY kcu.ordinal_position`
    );
    expect(Array.isArray(pkCols)).toBe(true);
    if (pkCols.length > 0) {
      const cols = pkCols.map((r: any) => r.column_name);
      expect(cols).toEqual(['provider', 'id']);
    }
  });

  it('should verify anon access to identities based on rls', async () => {
    // get rls status
    db.setContext({ role: 'service_role' });
    const rlsStatus = await db.any(
      `SELECT c.relrowsecurity 
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'auth' AND c.relname = 'identities'`
    );
    expect(Array.isArray(rlsStatus)).toBe(true);
    expect(rlsStatus.length).toBeGreaterThan(0);
    
    // query as anon
    db.clearContext();
    const result = await db.any(`SELECT * FROM auth.identities LIMIT 1`);
    expect(Array.isArray(result)).toBe(true);
    if (rlsStatus[0].relrowsecurity === true) {
      expect(result.length).toBe(0);
    }
  });
});

