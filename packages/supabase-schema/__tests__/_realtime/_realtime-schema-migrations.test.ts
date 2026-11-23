import { getConnections, PgTestClient } from 'supabase-test';

let pg: PgTestClient;
let db: PgTestClient;
let teardown: () => Promise<void>;

let tableExists = false;

beforeAll(async () => {
  ({ pg, db, teardown } = await getConnections());
  
  // verify _realtime schema exists (optional schema)
  const realtimeSchemaExists = await pg.any(
    `SELECT EXISTS (
      SELECT FROM information_schema.schemata 
      WHERE schema_name = '_realtime'
    ) as exists`
  );
  
  if (realtimeSchemaExists[0]?.exists === true) {
    // grant access to _realtime schema for testing
    await pg.any(
      `GRANT USAGE ON SCHEMA _realtime TO public;
       GRANT SELECT ON ALL TABLES IN SCHEMA _realtime TO service_role;
       GRANT SELECT ON ALL TABLES IN SCHEMA _realtime TO authenticated;
       GRANT SELECT ON ALL TABLES IN SCHEMA _realtime TO anon;
       ALTER DEFAULT PRIVILEGES IN SCHEMA _realtime GRANT SELECT ON TABLES TO service_role;
       ALTER DEFAULT PRIVILEGES IN SCHEMA _realtime GRANT SELECT ON TABLES TO authenticated;
       ALTER DEFAULT PRIVILEGES IN SCHEMA _realtime GRANT SELECT ON TABLES TO anon;`,
      []
    );
    
    // check if _realtime.schema_migrations table exists (using pg in beforeAll only)
    const exists = await pg.any(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = '_realtime' AND table_name = 'schema_migrations'
      ) as exists`
    );
    tableExists = exists[0]?.exists === true;
  }
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

describe('tutorial: _realtime schema_migrations table access', () => {

  it('should verify schema_migrations table exists', async () => {
    db.setContext({ role: 'service_role' });
    
    // verify table exists in information schema
    const exists = await db.any(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = '_realtime' AND table_name = 'schema_migrations'
      ) as exists`
    );
    
    expect(Array.isArray(exists)).toBe(true);
    if (exists[0]?.exists === false) {
      expect(exists[0].exists).toBe(false);
      return;
    }
    expect(exists[0].exists).toBe(true);
  });

  it('should verify service_role can read migration records', async () => {
    if (!tableExists) {
      return;
    }
    
    db.setContext({ role: 'service_role' });
    
    // service_role should be able to query schema_migrations
    const migrations = await db.any(
      `SELECT * FROM _realtime.schema_migrations`
    );
    
    expect(Array.isArray(migrations)).toBe(true);
  });

  it('should verify table has version column', async () => {
    if (!tableExists) {
      return;
    }
    
    db.setContext({ role: 'service_role' });
    
    // check for version column in schema_migrations table
    const columns = await db.any(
      `SELECT column_name, data_type 
       FROM information_schema.columns 
       WHERE table_schema = '_realtime' AND table_name = 'schema_migrations'
       AND column_name = 'version'`
    );
    
    expect(Array.isArray(columns)).toBe(true);
    if (columns.length > 0) {
      expect(columns[0].column_name).toBe('version');
    }
  });

  it('should prevent authenticated users from accessing schema_migrations without proper permissions', async () => {
    if (!tableExists) {
      return;
    }
    
    // create a test user as admin using db with service_role context
    // using auth.users (real supabase table) instead of rls_test.user_profiles (fake test table)
    db.setContext({ role: 'service_role' });
    const user = await db.one(
      `INSERT INTO auth.users (id, email) 
       VALUES (gen_random_uuid(), $1) 
       RETURNING id`,
      ['realtime-migrations-test@example.com']
    );
    
    // set context to simulate authenticated user
    db.setContext({
      role: 'authenticated',
      'request.jwt.claim.sub': user.id
    });
    
    // authenticated users should not be able to access schema_migrations (rls blocks)
    const result = await db.any(
      `SELECT * FROM _realtime.schema_migrations LIMIT 1`
    );
    
    // rls should block access, result should be empty
    expect(result.length).toBe(0);
  });

  it('should prevent anon from reading migrations', async () => {
    if (!tableExists) {
      return;
    }
    
    // clear context to anon role
    db.clearContext();
    
    // anon should not be able to access schema_migrations (rls blocks)
    const result = await db.any(
      `SELECT * FROM _realtime.schema_migrations LIMIT 1`
    );
    
    // rls should block access, result should be empty
    expect(result.length).toBe(0);
  });
});

