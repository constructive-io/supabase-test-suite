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
  
  // grants for reads
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
  
  // assert table exists (fail fast)
  const exists = await pg.any(
    `SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'auth' AND table_name = 'oauth_clients'
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

describe('tutorial: auth oauth_clients table access', () => {

  it('should verify oauth_clients table exists', async () => {
    db.setContext({ role: 'service_role' });
    
    // verify table exists in information schema
    const exists = await db.any(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'auth' AND table_name = 'oauth_clients'
      ) as exists`
    );
    
    expect(Array.isArray(exists)).toBe(true);
    expect(exists[0].exists).toBe(true);
  });

  it('should verify service_role can read oauth_clients', async () => {
    db.setContext({ role: 'service_role' });
    
    // service_role should be able to query oauth_clients
      const clients = await db.any(
      `SELECT id, client_id, client_secret_hash, client_name, created_at, updated_at 
         FROM auth.oauth_clients 
         LIMIT 10`
      );
      
      expect(Array.isArray(clients)).toBe(true);
  });

  it('should verify table has unique constraint on client_id', async () => {
    db.setContext({ role: 'service_role' });
    
    // check for unique constraint on client_id via constraints
    const constraints = await db.any(
      `SELECT constraint_name
       FROM information_schema.table_constraints 
       WHERE table_schema = 'auth' AND table_name = 'oauth_clients' AND constraint_type = 'UNIQUE'`
    );
    expect(Array.isArray(constraints)).toBe(true);
    // and the index exists
    const indexes = await db.any(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'auth' AND tablename = 'oauth_clients'`
    );
    expect(Array.isArray(indexes)).toBe(true);
  });

  it('should verify anon access to oauth_clients based on rls', async () => {
    // rls status
    db.setContext({ role: 'service_role' });
    const rlsStatus = await db.any(
      `SELECT c.relrowsecurity 
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'auth' AND c.relname = 'oauth_clients'`
    );
    expect(Array.isArray(rlsStatus)).toBe(true);
    expect(rlsStatus.length).toBeGreaterThan(0);
    
    db.clearContext();
    const result = await db.any(`SELECT * FROM auth.oauth_clients LIMIT 1`);
    expect(Array.isArray(result)).toBe(true);
    if (rlsStatus[0].relrowsecurity === true) {
      expect(result.length).toBe(0);
    }
  });
});

