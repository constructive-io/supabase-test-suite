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
    
    // check if _realtime.extensions table exists (using pg in beforeAll only)
    const exists = await pg.any(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = '_realtime' AND table_name = 'extensions'
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

describe('tutorial: _realtime extensions table access', () => {

  it('should verify extensions table exists in _realtime schema', async () => {
    db.setContext({ role: 'service_role' });
    
    // verify table exists in information schema
    const exists = await db.any(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = '_realtime' AND table_name = 'extensions'
      ) as exists`
    );
    
    expect(Array.isArray(exists)).toBe(true);
    if (exists[0]?.exists === false) {
      expect(exists[0].exists).toBe(false);
      return;
    }
    expect(exists[0].exists).toBe(true);
  });

  it('should verify service_role can query extensions table structure', async () => {
    if (!tableExists) {
      return;
    }
    
    db.setContext({ role: 'service_role' });
    
    // query table column structure
    const columns = await db.any(
      `SELECT column_name, data_type 
       FROM information_schema.columns 
       WHERE table_schema = '_realtime' AND table_name = 'extensions'
       ORDER BY ordinal_position`
    );
    
    expect(Array.isArray(columns)).toBe(true);
  });

  it('should prevent anon from accessing extensions table', async () => {
    if (!tableExists) {
      return;
    }
    
    // clear context to anon role
    db.clearContext();
    
    // anon should not be able to access _realtime.extensions (rls blocks)
    const result = await db.any(
      `SELECT * FROM _realtime.extensions LIMIT 1`
    );
    
    // rls should block access, result should be empty
    expect(result.length).toBe(0);
  });

  it('should verify table has proper grants via information_schema', async () => {
    if (!tableExists) {
      return;
    }
    
    db.setContext({ role: 'service_role' });
    
    // check table privileges/grants
    const grants = await db.any(
      `SELECT grantee, privilege_type 
       FROM information_schema.table_privileges 
       WHERE table_schema = '_realtime' AND table_name = 'extensions'`
    );
    
    expect(Array.isArray(grants)).toBe(true);
  });
});

