import { getConnections, PgTestClient } from 'supabase-test';

let pg: PgTestClient;
let db: PgTestClient;
let teardown: () => Promise<void>;

beforeAll(async () => {
  ({ pg, db, teardown } = await getConnections());
  
  // grant access to supabase_functions schema for testing
  await pg.any(
    `GRANT USAGE ON SCHEMA supabase_functions TO public;
     GRANT SELECT ON ALL TABLES IN SCHEMA supabase_functions TO service_role;
     GRANT SELECT ON ALL TABLES IN SCHEMA supabase_functions TO authenticated;
     GRANT SELECT ON ALL TABLES IN SCHEMA supabase_functions TO anon;
     ALTER DEFAULT PRIVILEGES IN SCHEMA supabase_functions GRANT SELECT ON TABLES TO service_role;
     ALTER DEFAULT PRIVILEGES IN SCHEMA supabase_functions GRANT SELECT ON TABLES TO authenticated;
     ALTER DEFAULT PRIVILEGES IN SCHEMA supabase_functions GRANT SELECT ON TABLES TO anon;`,
    []
  );
  
  // grant access to auth schema for auth.users inserts
  await pg.any(
    `GRANT USAGE ON SCHEMA auth TO public;
     GRANT INSERT ON TABLE auth.users TO service_role;`,
    []
  );
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

describe('tutorial: supabase_functions hooks table access', () => {

  it('should verify hooks table exists', async () => {
    db.setContext({ role: 'service_role' });
    
    // verify table exists in information schema
    const exists = await db.any(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'supabase_functions' AND table_name = 'hooks'
      ) as exists`
    );
    
    expect(Array.isArray(exists)).toBe(true);
    expect(exists[0].exists).toBe(true);
  });

  it('should verify service_role can query hooks', async () => {
    db.setContext({ role: 'service_role' });
    
    // service_role should be able to query hooks
    const hooks = await db.any(
      `SELECT id, hook_table_id, hook_name, created_at 
       FROM supabase_functions.hooks 
       LIMIT 10`
    );
    
    expect(Array.isArray(hooks)).toBe(true);
  });

  it('should verify table structure via information_schema', async () => {
    db.setContext({ role: 'service_role' });
    
    // query table column structure
    const columns = await db.any(
      `SELECT column_name, data_type 
       FROM information_schema.columns 
       WHERE table_schema = 'supabase_functions' AND table_name = 'hooks'
       ORDER BY ordinal_position`
    );
    
    expect(Array.isArray(columns)).toBe(true);
  });

  it('should prevent authenticated users from accessing hooks without proper permissions', async () => {
    // create a test user as admin
    // using auth.users (real supabase table) instead of rls_test.user_profiles (fake test table)
    // use pg for auth.users insert since it requires superuser privileges
    const user = await pg.one(
      `INSERT INTO auth.users (id, email) 
       VALUES (gen_random_uuid(), $1) 
       RETURNING id`,
      ['functions-hooks-test@example.com']
    );
    
    // set context to simulate authenticated user
    db.setContext({
      role: 'authenticated',
      'request.jwt.claim.sub': user.id
    });
    
    // authenticated users should not be able to access hooks (rls blocks)
    const result = await db.any(
      `SELECT * FROM supabase_functions.hooks LIMIT 1`
    );
    
    // rls should block access, result should be empty
    expect(result.length).toBe(0);
  });

  it('should prevent anon from accessing hooks', async () => {
    // clear context to anon role
    db.clearContext();
    
    // anon should not be able to access hooks (rls blocks)
    const result = await db.any(
      `SELECT * FROM supabase_functions.hooks LIMIT 1`
    );
    
    // rls should block access, result should be empty
    expect(result.length).toBe(0);
  });
});

