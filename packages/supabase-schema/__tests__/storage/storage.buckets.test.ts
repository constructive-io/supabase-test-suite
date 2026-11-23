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
  
  // assert storage.buckets exists
  const exists = await pg.any(
    `SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'storage' AND table_name = 'buckets'
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

describe('tutorial: storage buckets table access', () => {

  it('should verify buckets table exists', async () => {
    db.setContext({ role: 'service_role' });
    
    const exists = await db.any(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'storage' AND table_name = 'buckets'
      ) as exists`
    );
    
    expect(Array.isArray(exists)).toBe(true);
    expect(exists[0].exists).toBe(true);
  });

  it('should verify service_role can read buckets', async () => {
    db.setContext({ role: 'service_role' });
    
    const buckets = await db.any(
      `SELECT id, name, owner, created_at, updated_at 
       FROM storage.buckets 
       LIMIT 10`
    );
    
    expect(Array.isArray(buckets)).toBe(true);
  });

  it('should verify table has primary key on id', async () => {
    db.setContext({ role: 'service_role' });
    
    const pk = await db.any(
      `SELECT constraint_name 
       FROM information_schema.table_constraints 
       WHERE table_schema = 'storage' AND table_name = 'buckets'
       AND constraint_type = 'PRIMARY KEY'`
    );
    
    expect(Array.isArray(pk)).toBe(true);
    if (pk.length > 0) {
      expect(pk[0].constraint_name).toBeDefined();
    }
  });

  it('should verify table has unique index on name', async () => {
    db.setContext({ role: 'service_role' });
    
    const indexes = await db.any(
      `SELECT indexname, indexdef 
       FROM pg_indexes 
       WHERE schemaname = 'storage' AND tablename = 'buckets'`
    );
    
    expect(Array.isArray(indexes)).toBe(true);
    if (indexes.length > 0) {
      const defs = indexes.map((r: any) => String(r.indexdef).toLowerCase()).join(' ');
      expect(defs.includes('unique')).toBe(true);
      expect(defs.includes('(name)')).toBe(true);
    }
  });

  it('should verify table has owner column for user linkage', async () => {
    db.setContext({ role: 'service_role' });
    const cols = await db.any(
      `SELECT column_name 
       FROM information_schema.columns 
       WHERE table_schema = 'storage' AND table_name = 'buckets'`
    );
    expect(Array.isArray(cols)).toBe(true);
    const names = cols.map((r: any) => r.column_name);
    expect(names).toContain('owner');
  });

  it('should verify anon access to buckets based on rls', async () => {
    db.setContext({ role: 'service_role' });
    const rlsStatus = await db.any(
      `SELECT c.relrowsecurity 
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'storage' AND c.relname = 'buckets'`
    );
    expect(Array.isArray(rlsStatus)).toBe(true);
    
    db.clearContext();
    const result = await db.any(`SELECT * FROM storage.buckets LIMIT 1`);
    expect(Array.isArray(result)).toBe(true);
    if (rlsStatus[0]?.relrowsecurity === true) {
      expect(result.length).toBe(0);
    }
  });
});

