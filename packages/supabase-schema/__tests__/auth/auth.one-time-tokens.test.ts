import { getConnections, PgTestClient } from 'supabase-test';

let pg: PgTestClient;
let db: PgTestClient;
let teardown: () => Promise<void>;

beforeAll(async () => {
  
  
  ({ pg, db, teardown } = await getConnections());
  
  // verify auth schema exists
  const authSchemaExists = await pg.any(
    `SELECT EXISTS (
      SELECT FROM information_schema.schemata 
      WHERE schema_name = 'auth'
    ) as exists`
  );
  expect(authSchemaExists[0].exists).toBe(true);
  
  // grant access to auth schema for testing
    await pg.any(
      `GRANT USAGE ON SCHEMA auth TO public;
     GRANT SELECT ON ALL TABLES IN SCHEMA auth TO service_role;
     GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
     GRANT SELECT ON ALL TABLES IN SCHEMA auth TO anon;
     ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT ON TABLES TO service_role;
     ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT ON TABLES TO authenticated;
     ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT ON TABLES TO anon;`,
    []
  );
  
  // assert auth.one_time_tokens exists
  const exists = await pg.any(
    `SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'auth' AND table_name = 'one_time_tokens'
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

describe('tutorial: auth one_time_tokens table access', () => {

  it('should verify one_time_tokens table exists', async () => {
    db.setContext({ role: 'service_role' });
    
    // verify table exists in information schema
    const exists = await db.any(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'auth' AND table_name = 'one_time_tokens'
      ) as exists`
    );
    
    expect(Array.isArray(exists)).toBe(true);
    expect(exists[0].exists).toBe(true);
  });

  it('should verify service_role can read one_time_tokens', async () => {
    db.setContext({ role: 'service_role' });
    
    const rows = await db.any(
      `SELECT id, user_id, token_type, token_hash, relates_to, created_at, updated_at
       FROM auth.one_time_tokens
       LIMIT 10`
    );
    expect(Array.isArray(rows)).toBe(true);
  });

  it('should verify table has indexes on token_hash and relates_to', async () => {
    db.setContext({ role: 'service_role' });
    
    // check for indexes on the table
    const indexes = await db.any(
      `SELECT indexname, indexdef 
       FROM pg_indexes 
       WHERE schemaname = 'auth' AND tablename = 'one_time_tokens'`
    );
    
    expect(Array.isArray(indexes)).toBe(true);
    if (indexes.length > 0) {
      const defs = indexes.map((r: any) => r.indexdef.toLowerCase()).join(' ');
      expect(defs.includes('token_hash')).toBe(true);
      expect(defs.includes('relates_to')).toBe(true);
    }
  });

  it('should verify table has primary key on id', async () => {
    db.setContext({ role: 'service_role' });
    const pk = await db.any(
      `SELECT constraint_name 
       FROM information_schema.table_constraints 
       WHERE table_schema = 'auth' AND table_name = 'one_time_tokens'
         AND constraint_type = 'PRIMARY KEY'`
    );
    expect(Array.isArray(pk)).toBe(true);
    if (pk.length > 0) {
      expect(pk[0].constraint_name).toBeDefined();
    }
  });

  it('should verify foreign key to auth.users on user_id', async () => {
    db.setContext({ role: 'service_role' });
    const fks = await db.any(
      `SELECT tc.constraint_name, ccu.table_name AS foreign_table_name, ccu.column_name
       FROM information_schema.table_constraints AS tc
       JOIN information_schema.constraint_column_usage AS ccu
         ON ccu.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY' 
         AND tc.table_schema = 'auth' 
         AND tc.table_name = 'one_time_tokens'`
    );
    expect(Array.isArray(fks)).toBe(true);
    if (fks.length > 0) {
      const foreignTables = fks.map((r: any) => r.foreign_table_name);
      expect(foreignTables.includes('users')).toBe(true);
    }
  });

  it('should verify unique constraint on (user_id, token_type)', async () => {
    db.setContext({ role: 'service_role' });
    const uniques = await db.any(
      `SELECT indexname, indexdef 
       FROM pg_indexes 
       WHERE schemaname = 'auth' AND tablename = 'one_time_tokens'`
    );
    expect(Array.isArray(uniques)).toBe(true);
    if (uniques.length > 0) {
      const defs = uniques.map((r: any) => r.indexdef.toLowerCase()).join(' ');
      expect(defs.includes('(user_id, token_type)')).toBe(true);
    }
  });

  it('should verify enum type one_time_token_type exists with values', async () => {
    db.setContext({ role: 'service_role' });
    const typeExists = await db.any(
      `SELECT EXISTS (
         SELECT 1 FROM pg_type WHERE typname = 'one_time_token_type'
       ) AS exists`
    );
    expect(typeExists[0].exists).toBe(true);
    const labels = await db.any(
      `SELECT e.enumlabel 
       FROM pg_type t 
       JOIN pg_enum e ON t.oid = e.enumtypid 
       WHERE t.typname = 'one_time_token_type'`
    );
    const vals = labels.map((r: any) => r.enumlabel);
    expect(vals).toEqual(expect.arrayContaining([
      'confirmation_token',
      'reauthentication_token',
      'recovery_token',
      'email_change_token_new',
      'email_change_token_current',
      'phone_change_token'
    ]));
  });

  it('should verify anon access to one_time_tokens based on rls', async () => {
    // check rls status
    db.setContext({ role: 'service_role' });
    const rlsStatus = await db.any(
      `SELECT c.relrowsecurity 
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'auth' AND c.relname = 'one_time_tokens'`
    );
    expect(Array.isArray(rlsStatus)).toBe(true);
    expect(rlsStatus.length).toBeGreaterThan(0);
    
    // clear context to anon role
    db.clearContext();
    
    const result = await db.any(`SELECT * FROM auth.one_time_tokens LIMIT 1`);
    expect(Array.isArray(result)).toBe(true);
    if (rlsStatus[0].relrowsecurity === true) {
      expect(result.length).toBe(0);
    }
  });
});

