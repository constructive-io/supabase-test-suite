import { getConnections, PgTestClient } from 'supabase-test';

let pg: PgTestClient;
let db: PgTestClient;
let teardown: () => Promise<void>;
let testUserId: string | null = null;

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
  
  // create a test user for authenticated context
  const u = await pg.one(
    `INSERT INTO auth.users (id, email) 
     VALUES (gen_random_uuid(), $1) 
     RETURNING id`,
    ['storage-upload-test@example.com']
  );
  testUserId = u.id;
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

describe('tutorial: storage objects table access (renamed scenario)', () => {

  it('should verify objects table exists', async () => {
    db.setContext({ role: 'service_role' });
    
    // verify table exists in information schema
    const exists = await db.any(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'storage' AND table_name = 'objects'
      ) as exists`
    );
    
    expect(Array.isArray(exists)).toBe(true);
    expect(exists[0].exists).toBe(true);
  });

  it('should verify service_role can query objects', async () => {
    db.setContext({ role: 'service_role' });
    
    // service_role should be able to query objects
    const rows = await db.any(
      `SELECT id, bucket_id, name, owner, created_at, updated_at, last_accessed_at, metadata, level 
       FROM storage.objects 
       LIMIT 10`
    );
    expect(Array.isArray(rows)).toBe(true);
  });

  it('should verify objects table structure via information_schema', async () => {
    db.setContext({ role: 'service_role' });
    // query table column structure
    const columns = await db.any(
      `SELECT column_name, data_type 
       FROM information_schema.columns 
       WHERE table_schema = 'storage' AND table_name = 'objects'
       ORDER BY ordinal_position`
    );
    expect(Array.isArray(columns)).toBe(true);
  });

  it('should verify authenticated access to objects based on rls', async () => {
    db.setContext({ role: 'service_role' });
    const rlsStatus = await db.any(
      `SELECT c.relrowsecurity 
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'storage' AND c.relname = 'objects'`
    );
    expect(Array.isArray(rlsStatus)).toBe(true);
    db.setContext({ role: 'authenticated', 'request.jwt.claim.sub': testUserId });
    const result = await db.any(`SELECT * FROM storage.objects LIMIT 1`);
    expect(Array.isArray(result)).toBe(true);
    if (rlsStatus[0]?.relrowsecurity === true) {
      expect(result.length).toBe(0);
    }
  });

  it('should verify anon access to objects based on rls', async () => {
    db.setContext({ role: 'service_role' });
    const rlsStatus = await db.any(
      `SELECT c.relrowsecurity 
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'storage' AND c.relname = 'objects'`
    );
    db.clearContext();
    const result = await db.any(`SELECT * FROM storage.objects LIMIT 1`);
    expect(Array.isArray(result)).toBe(true);
    if (rlsStatus[0]?.relrowsecurity === true) {
      expect(result.length).toBe(0);
    }
  });
});

