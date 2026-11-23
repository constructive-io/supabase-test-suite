import { getConnections, PgTestClient } from 'supabase-test';

let pg: PgTestClient;
let db: PgTestClient;
let teardown: () => Promise<void>;

let testBucketId: string;

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
     GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA storage TO service_role;
     GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA storage TO authenticated;
     GRANT SELECT ON ALL TABLES IN SCHEMA storage TO anon;
     ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT SELECT, INSERT, UPDATE ON TABLES TO service_role;
     ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT SELECT ON TABLES TO anon;`,
    []
  );
  
  // grant insert on buckets table for bucket creation (using pg for setup)
  await pg.any(
    `GRANT INSERT ON TABLE storage.buckets TO service_role;`,
    []
  );
  
  // verify storage.objects table exists (required for jsonb tests)
  const objectsExists = await pg.any(
    `SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'storage' AND table_name = 'objects'
    ) as exists`
  );
  expect(objectsExists[0].exists).toBe(true);
  
  // verify buckets table exists (required for storage.objects)
  const bucketsExists = await pg.any(
    `SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'storage' AND table_name = 'buckets'
    ) as exists`
  );
  expect(bucketsExists[0].exists).toBe(true);
  
  // ensure we have a bucket for testing (create if none exists)
  // storage.objects requires a valid bucket_id, so we need a bucket
  const buckets = await pg.any(
    `SELECT id FROM storage.buckets LIMIT 1`
  );
  
  if (buckets.length > 0) {
    testBucketId = buckets[0].id;
  } else {
    // create a test bucket if none exists (using pg for setup in beforeAll)
    const newBucket = await pg.any(
      `INSERT INTO storage.buckets (id, name) 
       VALUES ($1, $2) 
       RETURNING id`,
      ['jsonb-test-bucket', 'jsonb-test-bucket']
    );
    expect(newBucket.length).toBeGreaterThan(0);
    testBucketId = newBucket[0].id;
  }
  
  // verify we have a bucket id (required for testing)
  expect(testBucketId).toBeDefined();
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

describe('tutorial: rls with jsonb columns on supabase tables', () => {

  it('should verify storage.objects has metadata jsonb column', async () => {
    db.setContext({ role: 'service_role' });
    
    const columns = await db.any(
      `SELECT column_name, data_type 
       FROM information_schema.columns 
       WHERE table_schema = 'storage' 
         AND table_name = 'objects' 
         AND column_name = 'metadata'`
    );
    
    expect(columns.length).toBe(1);
    expect(columns[0].data_type).toBe('jsonb');
  });

  it('should verify service_role can query jsonb metadata fields', async () => {
    db.setContext({ role: 'service_role' });
    
    // query metadata jsonb field
    const objects = await db.any(
      `SELECT id, name, metadata 
       FROM storage.objects 
       WHERE metadata IS NOT NULL
       LIMIT 10`
    );
    
    expect(Array.isArray(objects)).toBe(true);
    
    // if objects exist with metadata, verify jsonb structure
    if (objects.length > 0 && objects[0].metadata) {
      expect(typeof objects[0].metadata).toBe('object');
    }
  });

  it('should verify jsonb path queries work with rls', async () => {
    db.setContext({ role: 'service_role' });
    
    // test jsonb path queries (e.g., metadata->>'key')
    const objects = await db.any(
      `SELECT id, name, 
       metadata->>'contentType' as content_type,
       metadata->>'size' as size
       FROM storage.objects 
       WHERE metadata IS NOT NULL
       LIMIT 10`
    );
    
    expect(Array.isArray(objects)).toBe(true);
  });

  it('should verify jsonb filtering works with rls', async () => {
    db.setContext({ role: 'service_role' });
    
    // test filtering by jsonb field values
    const objects = await db.any(
      `SELECT id, name, metadata 
       FROM storage.objects 
       WHERE metadata->>'contentType' = 'image/jpeg'
          OR metadata ? 'customField'
       LIMIT 10`
    );
    
    expect(Array.isArray(objects)).toBe(true);
  });

  it('should verify jsonb array operations with rls', async () => {
    db.setContext({ role: 'service_role' });
    
    // test jsonb array operations (if metadata has arrays)
    const objects = await db.any(
      `SELECT id, name, 
       jsonb_array_length(metadata->'tags') as tag_count
       FROM storage.objects 
       WHERE metadata ? 'tags'
         AND jsonb_typeof(metadata->'tags') = 'array'
       LIMIT 10`
    );
    
    expect(Array.isArray(objects)).toBe(true);
  });

  it('should verify anon cannot access jsonb metadata', async () => {
    db.setContext({ role: 'anon' });
    
    const result = await db.any(
      `SELECT id, metadata 
       FROM storage.objects 
       WHERE metadata IS NOT NULL
       LIMIT 1`
    );
    
    // rls should block access, result should be empty
    expect(result.length).toBe(0);
  });

  it('should verify jsonb updates respect rls', async () => {
    db.setContext({ role: 'service_role' });
    
    // insert an object with jsonb metadata
    const testObject = await db.any(
      `INSERT INTO storage.objects (bucket_id, name, metadata) 
       VALUES ($1, $2, $3::jsonb) 
       RETURNING id, name, metadata`,
      [
        testBucketId,
        'test-jsonb-object.json',
        JSON.stringify({ contentType: 'application/json', size: 100, customField: 'test' })
      ]
    );
    
    expect(testObject.length).toBeGreaterThan(0);
    expect(testObject[0].metadata).toBeDefined();
    expect(typeof testObject[0].metadata).toBe('object');
    
    // verify jsonb path query works on inserted data
    const retrieved = await db.any(
      `SELECT id, metadata->>'contentType' as content_type
       FROM storage.objects 
       WHERE id = $1`,
      [testObject[0].id]
    );
    
    expect(retrieved.length).toBeGreaterThan(0);
    expect(retrieved[0].content_type).toBe('application/json');
  });

  it('should verify jsonb nested field queries with rls', async () => {
    db.setContext({ role: 'service_role' });
    
    // test nested jsonb field queries (e.g., metadata->'nested'->>'field')
    const objects = await db.any(
      `SELECT id, name,
       metadata->'nested'->>'field' as nested_field
       FROM storage.objects 
       WHERE metadata->'nested' IS NOT NULL
       LIMIT 10`
    );
    
    expect(Array.isArray(objects)).toBe(true);
  });
});

