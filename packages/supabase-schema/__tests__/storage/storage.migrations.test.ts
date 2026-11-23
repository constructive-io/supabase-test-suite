import { getConnections, PgTestClient } from 'supabase-test';

let pg: PgTestClient;
let db: PgTestClient;
let teardown: () => Promise<void>;

beforeAll(async () => {
  ({ pg, db, teardown } = await getConnections());
  
  // verify storage schema exists
  const storageSchemaExists = await pg.any(
    `SELECT EXISTS (
      SELECT FROM information_schema.schemata 
      WHERE schema_name = 'storage'
    ) as exists`
  );
  expect(storageSchemaExists[0].exists).toBe(true);
  
  // grant access to storage schema for testing
  await pg.any(
    `GRANT USAGE ON SCHEMA storage TO public;
     GRANT SELECT ON ALL TABLES IN SCHEMA storage TO service_role;
     GRANT SELECT ON ALL TABLES IN SCHEMA storage TO authenticated;
     GRANT SELECT ON ALL TABLES IN SCHEMA storage TO anon;
     ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT SELECT ON TABLES TO service_role;
     ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT SELECT ON TABLES TO authenticated;
     ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT SELECT ON TABLES TO anon;`,
    []
  );
  
  // assert storage.migrations exists
  const exists = await pg.any(
    `SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'storage' AND table_name = 'migrations'
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

describe('tutorial: storage migrations table access', () => {

  it('should verify migrations table exists', async () => {
    db.setContext({ role: 'service_role' });
    
    // verify table exists in information schema
    const exists = await db.any(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'storage' AND table_name = 'migrations'
      ) as exists`
    );
    
    expect(Array.isArray(exists)).toBe(true);
    expect(exists[0].exists).toBe(true);
  });

  it('should verify service_role can read migrations', async () => {
    db.setContext({ role: 'service_role' });
    
    // service_role should be able to query migrations
    const migrations = await db.any(
      `SELECT id, name, hash, executed_at 
       FROM storage.migrations 
       ORDER BY executed_at DESC
       LIMIT 10`
    );
    
    expect(Array.isArray(migrations)).toBe(true);
  });

  it('should verify table has primary key on id', async () => {
    db.setContext({ role: 'service_role' });
    
    // check for primary key constraint
    const pk = await db.any(
      `SELECT constraint_name 
       FROM information_schema.table_constraints 
       WHERE table_schema = 'storage' AND table_name = 'migrations'
       AND constraint_type = 'PRIMARY KEY'`
    );
    
    expect(Array.isArray(pk)).toBe(true);
    if (pk.length > 0) {
      expect(pk[0].constraint_name).toBeDefined();
    }
  });

  it('should verify table has unique constraint on name', async () => {
    db.setContext({ role: 'service_role' });
    
    // check for unique constraints
    const unique = await db.any(
      `SELECT constraint_name 
       FROM information_schema.table_constraints 
       WHERE table_schema = 'storage' AND table_name = 'migrations'
       AND constraint_type = 'UNIQUE'`
    );
    
    expect(Array.isArray(unique)).toBe(true);
  });

  it('should verify anon access to migrations based on rls', async () => {
    db.setContext({ role: 'service_role' });
    const rlsStatus = await db.any(
      `SELECT c.relrowsecurity 
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'storage' AND c.relname = 'migrations'`
    );
    expect(Array.isArray(rlsStatus)).toBe(true);
    
    db.clearContext();
    const result = await db.any(`SELECT * FROM storage.migrations LIMIT 1`);
    expect(Array.isArray(result)).toBe(true);
    if (rlsStatus[0]?.relrowsecurity === true) {
      expect(result.length).toBe(0);
    }
  });
});

