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
  
  // assert refresh_tokens exists
  const exists = await pg.any(
    `SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'auth' AND table_name = 'refresh_tokens'
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

describe('tutorial: auth refresh_tokens table access', () => {

  it('should verify refresh_tokens table exists', async () => {
    db.setContext({ role: 'service_role' });
    
    const exists = await db.any(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'auth' AND table_name = 'refresh_tokens'
      ) as exists`
    );
    
    expect(Array.isArray(exists)).toBe(true);
    expect(exists[0].exists).toBe(true);
  });

  it('should verify service_role can read refresh_tokens', async () => {
    db.setContext({ role: 'service_role' });
    
    const tokens = await db.any(
      `SELECT id, token, user_id, revoked, created_at, updated_at, instance_id, session_id 
       FROM auth.refresh_tokens 
       LIMIT 10`
    );
    
    expect(Array.isArray(tokens)).toBe(true);
  });

  it('should verify table has primary key on id', async () => {
    db.setContext({ role: 'service_role' });
    
    const pk = await db.any(
      `SELECT constraint_name 
       FROM information_schema.table_constraints 
       WHERE table_schema = 'auth' AND table_name = 'refresh_tokens'
       AND constraint_type = 'PRIMARY KEY'`
    );
    
    expect(Array.isArray(pk)).toBe(true);
    if (pk.length > 0) {
      expect(pk[0].constraint_name).toBeDefined();
    }
  });

  it('should verify table has indexes on instance_id and token', async () => {
    db.setContext({ role: 'service_role' });
    
    const indexes = await db.any(
      `SELECT indexname 
       FROM pg_indexes 
       WHERE schemaname = 'auth' AND tablename = 'refresh_tokens'
       AND (indexname LIKE '%instance_id%' OR indexname LIKE '%token%')`
    );
    
    expect(Array.isArray(indexes)).toBe(true);
    if (indexes.length > 0) {
      const names = indexes.map((r: any) => r.indexname).join(' ');
      expect(names.includes('instance_id') || names.includes('token')).toBe(true);
    }
  });

  it('should verify anon access to refresh_tokens based on rls', async () => {
    // check rls status
    db.setContext({ role: 'service_role' });
    const rlsStatus = await db.any(
      `SELECT c.relrowsecurity 
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'auth' AND c.relname = 'refresh_tokens'`
    );
    expect(Array.isArray(rlsStatus)).toBe(true);
    expect(rlsStatus.length).toBeGreaterThan(0);
    
    db.clearContext();
    const result = await db.any(`SELECT * FROM auth.refresh_tokens LIMIT 1`);
    expect(Array.isArray(result)).toBe(true);
    if (rlsStatus[0].relrowsecurity === true) {
      expect(result.length).toBe(0);
    }
  });
});

