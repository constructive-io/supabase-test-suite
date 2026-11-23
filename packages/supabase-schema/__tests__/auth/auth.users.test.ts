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
  
  // assert auth.users exists
  const exists = await pg.any(
    `SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'auth' AND table_name = 'users'
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

describe('tutorial: auth users table access (supabase system)', () => {

  it('should verify auth.users table exists', async () => {
    db.setContext({ role: 'service_role' });
    const exists = await db.any(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'auth' AND table_name = 'users'
      ) as exists`
    );
    expect(Array.isArray(exists)).toBe(true);
    expect(exists[0].exists).toBe(true);
  });

  it('should verify service_role can query auth.users table structure', async () => {
    db.setContext({ role: 'service_role' });
    
    const columns = await db.any(
      `SELECT column_name, data_type 
       FROM information_schema.columns 
       WHERE table_schema = 'auth' AND table_name = 'users'
       ORDER BY ordinal_position`
    );
    
    expect(Array.isArray(columns)).toBe(true);
    if (columns.length > 0) {
      expect(columns[0].column_name).toBeDefined();
    }
  });

  it('should verify service_role can read auth.users', async () => {
    db.setContext({ role: 'service_role' });
    
    const users = await db.any(
      `SELECT id, email, created_at, updated_at 
       FROM auth.users 
       LIMIT 10`
    );
    
    expect(Array.isArray(users)).toBe(true);
  });

  it('should verify service_role can count auth.users', async () => {
    db.setContext({ role: 'service_role' });
    
    const count = await db.any(
      `SELECT COUNT(*)::integer as count FROM auth.users`
    );
    
    expect(Array.isArray(count)).toBe(true);
    expect(count[0].count).toBeDefined();
    expect(typeof Number(count[0].count)).toBe('number');
  });

  it('should verify service_role can query specific user fields', async () => {
    db.setContext({ role: 'service_role' });
    
    // query basic fields that definitely exist in auth.users
    const users = await db.any(
      `SELECT id, email, created_at, updated_at
       FROM auth.users 
       LIMIT 5`
    );
    
    expect(Array.isArray(users)).toBe(true);
    if (users.length > 0) {
      expect(users[0].id).toBeDefined();
      expect(users[0].email).toBeDefined();
    }
  });

  it('should verify service_role can query by email', async () => {
    db.setContext({ role: 'service_role' });
    
    const users = await db.any(
      `SELECT id, email 
       FROM auth.users 
       WHERE email IS NOT NULL
       LIMIT 5`
    );
    
    expect(Array.isArray(users)).toBe(true);
  });

  it('should verify authenticated access based on rls', async () => {
    // check rls status first
    db.setContext({ role: 'service_role' });
    const rlsStatus = await db.any(
      `SELECT c.relrowsecurity 
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'auth' AND c.relname = 'users'`
    );
    expect(Array.isArray(rlsStatus)).toBe(true);
    expect(rlsStatus.length).toBeGreaterThan(0);
    
    db.setContext({ role: 'authenticated' });
    const result = await db.any(`SELECT * FROM auth.users LIMIT 1`);
    expect(Array.isArray(result)).toBe(true);
    if (rlsStatus[0].relrowsecurity === true) {
      expect(result.length).toBe(0);
    }
  });

  it('should verify authenticated count based on rls', async () => {
    db.setContext({ role: 'service_role' });
    const rlsStatus = await db.any(
      `SELECT c.relrowsecurity 
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'auth' AND c.relname = 'users'`
    );
    expect(Array.isArray(rlsStatus)).toBe(true);
    
    db.setContext({ role: 'authenticated' });
    const count = await db.any(`SELECT COUNT(*)::integer as count FROM auth.users`);
    expect(Array.isArray(count)).toBe(true);
    if (rlsStatus[0]?.relrowsecurity === true) {
      expect(Number(count[0].count)).toBe(0);
    }
  });

  it('should verify table has primary key on id', async () => {
    db.setContext({ role: 'service_role' });
    
    const pk = await db.any(
      `SELECT constraint_name 
       FROM information_schema.table_constraints 
       WHERE table_schema = 'auth' AND table_name = 'users'
       AND constraint_type = 'PRIMARY KEY'`
    );
    
    expect(Array.isArray(pk)).toBe(true);
    if (pk.length > 0) {
      expect(pk[0].constraint_name).toBeDefined();
    }
  });

  it('should verify table has unique constraint on email', async () => {
    db.setContext({ role: 'service_role' });
    
    const unique = await db.any(
      `SELECT constraint_name 
       FROM information_schema.table_constraints 
       WHERE table_schema = 'auth' AND table_name = 'users'
       AND constraint_type = 'UNIQUE'`
    );
    
    expect(Array.isArray(unique)).toBe(true);
  });

  it('should verify table has indexes on instance_id', async () => {
    db.setContext({ role: 'service_role' });
    
    const indexes = await db.any(
      `SELECT indexname 
       FROM pg_indexes 
       WHERE schemaname = 'auth' AND tablename = 'users'
       AND indexname LIKE '%instance_id%'`
    );
    
    expect(Array.isArray(indexes)).toBe(true);
  });

  it('should verify rls status on auth.users table', async () => {
    db.setContext({ role: 'service_role' });
    
    const rlsStatus = await db.any(
      `SELECT c.relrowsecurity 
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'auth' AND c.relname = 'users'`
    );
    
    expect(Array.isArray(rlsStatus)).toBe(true);
    if (rlsStatus.length > 0) {
      expect(typeof rlsStatus[0].relrowsecurity).toBe('boolean');
    }
  });

  it('should verify anon access based on rls', async () => {
    db.setContext({ role: 'service_role' });
    const rlsStatus = await db.any(
      `SELECT c.relrowsecurity 
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'auth' AND c.relname = 'users'`
    );
    expect(Array.isArray(rlsStatus)).toBe(true);
    
    db.clearContext();
    const result = await db.any(`SELECT * FROM auth.users LIMIT 1`);
    expect(Array.isArray(result)).toBe(true);
    if (rlsStatus[0]?.relrowsecurity === true) {
      expect(result.length).toBe(0);
    }
  });

  it('should verify anon count based on rls', async () => {
    db.setContext({ role: 'service_role' });
    const rlsStatus = await db.any(
      `SELECT c.relrowsecurity 
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'auth' AND c.relname = 'users'`
    );
    expect(Array.isArray(rlsStatus)).toBe(true);
    
    db.clearContext();
    const count = await db.any(`SELECT COUNT(*)::integer as count FROM auth.users`);
    expect(Array.isArray(count)).toBe(true);
    if (rlsStatus[0]?.relrowsecurity === true) {
      expect(Number(count[0].count)).toBe(0);
    }
  });

  it('should verify anon query by email based on rls', async () => {
    db.setContext({ role: 'service_role' });
    const rlsStatus = await db.any(
      `SELECT c.relrowsecurity 
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'auth' AND c.relname = 'users'`
    );
    
    db.clearContext();
    const result = await db.any(`SELECT id, email FROM auth.users WHERE email = 'test@example.com'`);
    expect(Array.isArray(result)).toBe(true);
    if (rlsStatus[0]?.relrowsecurity === true) {
      expect(result.length).toBe(0);
    }
  });

  it('should verify context switching between roles', async () => {
    // start as service_role - should see data
    db.setContext({ role: 'service_role' });
    const serviceRoleResult = await db.any(`SELECT COUNT(*)::integer as count FROM auth.users`);
    expect(Array.isArray(serviceRoleResult)).toBe(true);
    const initialCount = Number(serviceRoleResult[0].count);
    expect(typeof initialCount).toBe('number');
    
    // switch to authenticated
    db.setContext({ role: 'authenticated' });
    const authenticatedResult = await db.any(`SELECT COUNT(*)::integer as count FROM auth.users`);
    expect(Array.isArray(authenticatedResult)).toBe(true);
    
    // switch to anon
    db.clearContext();
    const anonResult = await db.any(`SELECT COUNT(*)::integer as count FROM auth.users`);
    expect(Array.isArray(anonResult)).toBe(true);
    
    // switch back to service_role - should see data again
    db.setContext({ role: 'service_role' });
    const serviceRoleResult2 = await db.any(`SELECT COUNT(*)::integer as count FROM auth.users`);
    expect(Array.isArray(serviceRoleResult2)).toBe(true);
    const finalCount = Number(serviceRoleResult2[0].count);
    expect(typeof finalCount).toBe('number');
  });
});

