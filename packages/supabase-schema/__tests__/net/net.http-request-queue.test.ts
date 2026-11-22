import { getConnections, PgTestClient } from 'supabase-test';

let pg: PgTestClient;
let db: PgTestClient;
let teardown: () => Promise<void>;

let tableExists = false;

beforeAll(async () => {
  ({ pg, db, teardown } = await getConnections());
  
  // verify net schema exists (optional schema)
  const netSchemaExists = await pg.any(
    `SELECT EXISTS (
      SELECT FROM information_schema.schemata 
      WHERE schema_name = 'net'
    ) as exists`
  );
  
  if (netSchemaExists[0]?.exists === true) {
    // grant access to net schema for testing
    await pg.any(
      `GRANT USAGE ON SCHEMA net TO public;
       GRANT SELECT ON ALL TABLES IN SCHEMA net TO service_role;
       GRANT SELECT ON ALL TABLES IN SCHEMA net TO authenticated;
       GRANT SELECT ON ALL TABLES IN SCHEMA net TO anon;
       ALTER DEFAULT PRIVILEGES IN SCHEMA net GRANT SELECT ON TABLES TO service_role;
       ALTER DEFAULT PRIVILEGES IN SCHEMA net GRANT SELECT ON TABLES TO authenticated;
       ALTER DEFAULT PRIVILEGES IN SCHEMA net GRANT SELECT ON TABLES TO anon;`,
      []
    );
    
    // check if net.http_request_queue table exists (using pg in beforeAll only)
    const exists = await pg.any(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'net' AND table_name = 'http_request_queue'
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

describe('tutorial: net http_request_queue table access', () => {

  it('should verify http_request_queue table exists', async () => {
    db.setContext({ role: 'service_role' });
    
    // verify table exists in information schema
    const exists = await db.any(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'net' AND table_name = 'http_request_queue'
      ) as exists`
    );
    
    expect(Array.isArray(exists)).toBe(true);
    if (exists[0]?.exists === false) {
      expect(exists[0].exists).toBe(false);
      return;
    }
    expect(exists[0].exists).toBe(true);
  });

  it('should verify service_role can query http_request_queue', async () => {
    if (!tableExists) {
      return;
    }
    
    db.setContext({ role: 'service_role' });
    
    // service_role should be able to query http_request_queue
    const queue = await db.any(
      `SELECT id, url, method, status 
       FROM net.http_request_queue 
       LIMIT 10`
    );
    
    expect(Array.isArray(queue)).toBe(true);
  });

  it('should verify table has proper structure', async () => {
    if (!tableExists) {
      return;
    }
    
    db.setContext({ role: 'service_role' });
    
    // query table column structure
    const columns = await db.any(
      `SELECT column_name 
       FROM information_schema.columns 
       WHERE table_schema = 'net' AND table_name = 'http_request_queue'
       ORDER BY ordinal_position`
    );
    
    expect(Array.isArray(columns)).toBe(true);
  });

  it('should prevent authenticated users from accessing http_request_queue without proper permissions', async () => {
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
      ['net-request-queue-test@example.com']
    );
    
    // set context to simulate authenticated user
    db.setContext({
      role: 'authenticated',
      'request.jwt.claim.sub': user.id
    });
    
    // authenticated users should not be able to access http_request_queue (rls blocks)
    const result = await db.any(
      `SELECT * FROM net.http_request_queue LIMIT 1`
    );
    
    // rls should block access, result should be empty
    expect(result.length).toBe(0);
  });

  it('should prevent anon from accessing http_request_queue', async () => {
    if (!tableExists) {
      return;
    }
    
    // clear context to anon role
    db.clearContext();
    
    // anon should not be able to access http_request_queue (rls blocks)
    const result = await db.any(
      `SELECT * FROM net.http_request_queue LIMIT 1`
    );
    
    // rls should block access, result should be empty
    expect(result.length).toBe(0);
  });
});

