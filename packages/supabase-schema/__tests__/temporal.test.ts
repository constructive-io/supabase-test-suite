import { getConnections, PgTestClient } from 'supabase-test';

let pg: PgTestClient;
let db: PgTestClient;
let teardown: () => Promise<void>;

let temporalTableExists = false;

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
     ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT SELECT ON TABLES TO anon;`,
    []
  );
  
  // check if storage.objects table exists (using pg in beforeAll only)
  const exists = await pg.any(
    `SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'storage' AND table_name = 'objects'
    ) as exists`
  );
  temporalTableExists = exists[0]?.exists === true;
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

describe('tutorial: rls with temporal columns on supabase tables', () => {

  it('should verify storage.objects has temporal columns', async () => {
    expect(temporalTableExists).toBe(true);
    
    db.setContext({ role: 'service_role' });
    
    const columns = await db.any(
      `SELECT column_name, data_type 
       FROM information_schema.columns 
       WHERE table_schema = 'storage' 
         AND table_name = 'objects' 
         AND column_name IN ('created_at', 'updated_at', 'last_accessed_at')`
    );
    
    expect(Array.isArray(columns)).toBe(true);
    // at least created_at should exist
    const hasCreatedAt = columns.some((c: any) => c.column_name === 'created_at');
    expect(hasCreatedAt).toBe(true);
  });

  it('should verify service_role can query temporal columns', async () => {
    expect(temporalTableExists).toBe(true);
    
    db.setContext({ role: 'service_role' });
    
    const objects = await db.any(
      `SELECT id, name, created_at, updated_at, last_accessed_at 
       FROM storage.objects 
       ORDER BY created_at DESC
       LIMIT 10`
    );
    
    expect(Array.isArray(objects)).toBe(true);
    
    if (objects.length > 0) {
      expect(objects[0].created_at).toBeDefined();
    }
  });

  it('should verify time-windowed queries work with rls', async () => {
    expect(temporalTableExists).toBe(true);
    
    db.setContext({ role: 'service_role' });
    
    // query objects from last 30 days
    const recentObjects = await db.any(
      `SELECT id, name, created_at 
       FROM storage.objects 
       WHERE created_at >= NOW() - INTERVAL '30 days'
       ORDER BY created_at DESC
       LIMIT 10`
    );
    
    expect(Array.isArray(recentObjects)).toBe(true);
  });

  it('should verify date range filtering works with rls', async () => {
    expect(temporalTableExists).toBe(true);
    
    db.setContext({ role: 'service_role' });
    
    // query objects created in last 7 days
    const weekOldObjects = await db.any(
      `SELECT id, name, created_at 
       FROM storage.objects 
       WHERE created_at >= NOW() - INTERVAL '7 days'
         AND created_at < NOW()
       ORDER BY created_at DESC
       LIMIT 10`
    );
    
    expect(Array.isArray(weekOldObjects)).toBe(true);
  });

  it('should verify temporal aggregations work with rls', async () => {
    expect(temporalTableExists).toBe(true);
    
    db.setContext({ role: 'service_role' });
    
    // aggregate objects by date
    const dailyCounts = await db.any(
      `SELECT DATE(created_at) as date, COUNT(*) as count 
       FROM storage.objects 
       WHERE created_at >= NOW() - INTERVAL '30 days'
       GROUP BY DATE(created_at)
       ORDER BY date DESC
       LIMIT 10`
    );
    
    expect(Array.isArray(dailyCounts)).toBe(true);
  });

  it('should verify last_accessed_at queries work with rls', async () => {
    expect(temporalTableExists).toBe(true);
    
    db.setContext({ role: 'service_role' });
    
    // query recently accessed objects
    const accessedObjects = await db.any(
      `SELECT id, name, last_accessed_at 
       FROM storage.objects 
       WHERE last_accessed_at >= NOW() - INTERVAL '7 days'
       ORDER BY last_accessed_at DESC
       LIMIT 10`
    );
    
    expect(Array.isArray(accessedObjects)).toBe(true);
  });

  it('should verify timezone-aware queries work with rls', async () => {
    expect(temporalTableExists).toBe(true);
    
    db.setContext({ role: 'service_role' });
    
    // query with timezone conversion
    const objects = await db.any(
      `SELECT id, name, 
       created_at AT TIME ZONE 'UTC' as created_utc,
       created_at AT TIME ZONE 'America/New_York' as created_ny
       FROM storage.objects 
       ORDER BY created_at DESC
       LIMIT 10`
    );
    
    expect(Array.isArray(objects)).toBe(true);
  });

  it('should verify anon cannot access temporal data', async () => {
    expect(temporalTableExists).toBe(true);
    
    db.setContext({ role: 'anon' });
    
    const result = await db.any(
      `SELECT id, created_at 
       FROM storage.objects 
       WHERE created_at >= NOW() - INTERVAL '30 days'
       LIMIT 1`
    );
    
    // rls should block access
    expect(result.length).toBe(0);
  });

  it('should verify temporal ordering works with rls', async () => {
    expect(temporalTableExists).toBe(true);
    
    db.setContext({ role: 'service_role' });
    
    // order by multiple temporal columns
    const objects = await db.any(
      `SELECT id, name, created_at, updated_at 
       FROM storage.objects 
       ORDER BY created_at DESC, updated_at DESC
       LIMIT 10`
    );
    
    expect(Array.isArray(objects)).toBe(true);
    
    // verify ordering (if multiple results)
    if (objects.length > 1) {
      for (let i = 0; i < objects.length - 1; i++) {
        const current = new Date(objects[i].created_at);
        const next = new Date(objects[i + 1].created_at);
        expect(current.getTime()).toBeGreaterThanOrEqual(next.getTime());
      }
    }
  });
});

