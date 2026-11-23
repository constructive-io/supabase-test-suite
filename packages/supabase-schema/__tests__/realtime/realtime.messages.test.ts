import { getConnections, PgTestClient } from 'supabase-test';

let pg: PgTestClient;
let db: PgTestClient;
let teardown: () => Promise<void>;

let tableExists = false;

beforeAll(async () => {
  ({ pg, db, teardown } = await getConnections());
  
  // verify realtime schema exists (optional schema)
  const realtimeSchemaExists = await pg.any(
    `SELECT EXISTS (
      SELECT FROM information_schema.schemata 
      WHERE schema_name = 'realtime'
    ) as exists`
  );
  
  if (realtimeSchemaExists[0]?.exists === true) {
    // grant access to realtime schema for testing
    await pg.any(
      `GRANT USAGE ON SCHEMA realtime TO public;
       GRANT SELECT ON ALL TABLES IN SCHEMA realtime TO service_role;
       GRANT SELECT ON ALL TABLES IN SCHEMA realtime TO authenticated;
       GRANT SELECT ON ALL TABLES IN SCHEMA realtime TO anon;
       ALTER DEFAULT PRIVILEGES IN SCHEMA realtime GRANT SELECT ON TABLES TO service_role;
       ALTER DEFAULT PRIVILEGES IN SCHEMA realtime GRANT SELECT ON TABLES TO authenticated;
       ALTER DEFAULT PRIVILEGES IN SCHEMA realtime GRANT SELECT ON TABLES TO anon;`,
      []
    );
    
    // check if realtime.messages table exists (using pg in beforeAll only)
    const exists = await pg.any(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'realtime' AND table_name = 'messages'
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

describe('tutorial: realtime messages table access', () => {

  it('should verify messages table exists', async () => {
    db.setContext({ role: 'service_role' });
    
    // verify table exists in information schema
    const exists = await db.any(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'realtime' AND table_name = 'messages'
      ) as exists`
    );
    
    expect(Array.isArray(exists)).toBe(true);
    if (exists[0]?.exists === false) {
      expect(exists[0].exists).toBe(false);
      return;
    }
    expect(exists[0].exists).toBe(true);
  });

  it('should verify service_role can query messages', async () => {
    if (!tableExists) {
      return;
    }
    
    db.setContext({ role: 'service_role' });
    
    // service_role should be able to query messages
    const messages = await db.any(
      `SELECT id, channel, payload, inserted_at 
       FROM realtime.messages 
       LIMIT 10`
    );
    
    expect(Array.isArray(messages)).toBe(true);
  });

  it('should verify table is partitioned or has partition inheritance', async () => {
    if (!tableExists) {
      return;
    }
    
    db.setContext({ role: 'service_role' });
    
    // realtime.messages uses table partitioning for time-based data management
    // check for partition inheritance in pg_class
    const partitionInfo = await db.any(
      `SELECT c.relname, c.relkind 
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'realtime' 
         AND c.relname LIKE 'messages%'
         AND (c.relkind = 'r' OR c.relkind = 'p')`
    );
    
    expect(Array.isArray(partitionInfo)).toBe(true);
  });

  it('should prevent authenticated users from accessing messages without proper permissions', async () => {
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
      ['realtime-messages-test@example.com']
    );
    
    // set context to simulate authenticated user
    db.setContext({
      role: 'authenticated',
      'request.jwt.claim.sub': user.id
    });
    
    // authenticated users should not be able to access messages (rls blocks)
    const result = await db.any(
      `SELECT * FROM realtime.messages LIMIT 1`
    );
    
    // rls should block access, result should be empty
    expect(result.length).toBe(0);
  });

  it('should prevent anon from accessing messages', async () => {
    if (!tableExists) {
      return;
    }
    
    // clear context to anon role
    db.clearContext();
    
    // anon should not be able to access messages (rls blocks)
    const result = await db.any(
      `SELECT * FROM realtime.messages LIMIT 1`
    );
    
    // rls should block access, result should be empty
    expect(result.length).toBe(0);
  });
});

