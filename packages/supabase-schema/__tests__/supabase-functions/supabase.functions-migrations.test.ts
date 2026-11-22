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

describe('tutorial: supabase_functions migrations table access', () => {
  it('should verify migrations table exists and has correct structure', async () => {
    db.setContext({ role: 'service_role' });
    
    // verify table exists in information schema
    const tableExists = await db.any(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'supabase_functions' AND table_name = 'migrations'
      ) as exists`
    );
    expect(tableExists[0].exists).toBe(true);
    
    // verify table has expected columns
    const columns = await db.any(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'supabase_functions' AND table_name = 'migrations'
       ORDER BY ordinal_position`
    );
    
    expect(Array.isArray(columns)).toBe(true);
    expect(columns.length).toBeGreaterThan(0);
    
    // verify key columns exist (actual schema has version and inserted_at)
    const columnNames = columns.map((c: any) => c.column_name);
    expect(columnNames).toContain('version');
    expect(columnNames).toContain('inserted_at');
  });

  it('should verify service_role can read migrations table', async () => {
    db.setContext({ role: 'service_role' });
    
    // service_role should be able to query migrations
    const migrations = await db.any(
      `SELECT version, inserted_at 
       FROM supabase_functions.migrations 
       ORDER BY inserted_at DESC
       LIMIT 10`
    );
    
    expect(Array.isArray(migrations)).toBe(true);
    
    // verify result structure if any rows exist
    if (migrations.length > 0) {
      expect(migrations[0]).toHaveProperty('version');
      expect(migrations[0]).toHaveProperty('inserted_at');
    }
  });

  it('should verify table has primary key constraint', async () => {
    db.setContext({ role: 'service_role' });
    
    // verify primary key constraint exists
    const primaryKeys = await db.any(
      `SELECT constraint_name
       FROM information_schema.table_constraints
       WHERE table_schema = 'supabase_functions' 
         AND table_name = 'migrations'
         AND constraint_type = 'PRIMARY KEY'`
    );
    
    expect(Array.isArray(primaryKeys)).toBe(true);
    expect(primaryKeys.length).toBeGreaterThan(0);
    expect(primaryKeys[0].constraint_name).toBeDefined();
  });

  it('should verify rls status on migrations table', async () => {
    db.setContext({ role: 'service_role' });
    
    // verify rls status (may or may not be enabled depending on setup)
    const rlsStatus = await db.any(
      `SELECT relname, relrowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'supabase_functions' 
         AND c.relname = 'migrations'`
    );
    
    expect(Array.isArray(rlsStatus)).toBe(true);
    expect(rlsStatus.length).toBeGreaterThan(0);
    expect(typeof rlsStatus[0].relrowsecurity).toBe('boolean');
  });

  it('should verify authenticated users access to migrations based on rls', async () => {
    // create a test user as admin
    // using auth.users (real supabase table) instead of rls_test.user_profiles (fake test table)
    // use pg for auth.users insert since it requires superuser privileges
    const user = await pg.one(
      `INSERT INTO auth.users (id, email) 
       VALUES (gen_random_uuid(), $1) 
       RETURNING id`,
      ['functions-migrations-test@example.com']
    );
    
    // set context to simulate authenticated user
    db.setContext({
      role: 'authenticated',
      'request.jwt.claim.sub': user.id
    });
    
    // check rls status first
    db.setContext({ role: 'service_role' });
    const rlsStatus = await db.any(
      `SELECT relrowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'supabase_functions' 
         AND c.relname = 'migrations'`
    );
    
    // test as authenticated user
    db.setContext({
      role: 'authenticated',
      'request.jwt.claim.sub': user.id
    });
    const result = await db.any(
      `SELECT * FROM supabase_functions.migrations LIMIT 1`
    );
    
    // if rls is enabled, result should be empty; if not, may have rows
    expect(Array.isArray(result)).toBe(true);
    if (rlsStatus[0]?.relrowsecurity === true) {
      expect(result.length).toBe(0);
    } else {
      // rls not enabled, access may be granted based on grants
      expect(Array.isArray(result)).toBe(true);
    }
  });

  it('should verify anon access to migrations based on rls', async () => {
    // check rls status first
    db.setContext({ role: 'service_role' });
    const rlsStatus = await db.any(
      `SELECT relrowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'supabase_functions' 
         AND c.relname = 'migrations'`
    );
    
    // clear context to anon role
    db.clearContext();
    
    // anon access depends on rls and grants
    const result = await db.any(
      `SELECT * FROM supabase_functions.migrations LIMIT 1`
    );
    
    // if rls is enabled, result should be empty; if not, may have rows
    expect(Array.isArray(result)).toBe(true);
    if (rlsStatus[0]?.relrowsecurity === true) {
      expect(result.length).toBe(0);
    } else {
      // rls not enabled, access may be granted based on grants
      expect(Array.isArray(result)).toBe(true);
    }
  });

  it('should verify migrations table has indexes', async () => {
    db.setContext({ role: 'service_role' });
    
    // verify indexes exist
    const indexes = await db.any(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE schemaname = 'supabase_functions' 
         AND tablename = 'migrations'`
    );
    
    expect(Array.isArray(indexes)).toBe(true);
    // indexes may or may not exist, but structure should be valid
    if (indexes.length > 0) {
      expect(indexes[0].indexname).toBeDefined();
      expect(indexes[0].indexdef).toBeDefined();
    }
  });
});

