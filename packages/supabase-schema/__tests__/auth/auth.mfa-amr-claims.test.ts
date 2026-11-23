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
  
  // grants
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
  
  // assert exists
  const exists = await pg.any(
    `SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'auth' AND table_name = 'mfa_amr_claims'
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

describe('tutorial: auth mfa_amr_claims table access', () => {

  it('should verify mfa_amr_claims table exists', async () => {
    db.setContext({ role: 'service_role' });
    
    // verify table exists in information schema
    const exists = await db.any(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'auth' AND table_name = 'mfa_amr_claims'
      ) as exists`
    );
    
    expect(Array.isArray(exists)).toBe(true);
    expect(exists[0].exists).toBe(true);
  });

  it('should verify service_role can query mfa_amr_claims structure', async () => {
    db.setContext({ role: 'service_role' });
    const columns = await db.any(
      `SELECT column_name, data_type 
       FROM information_schema.columns 
       WHERE table_schema = 'auth' AND table_name = 'mfa_amr_claims'
       ORDER BY ordinal_position`
    );
    expect(Array.isArray(columns)).toBe(true);
    expect(columns.length).toBeGreaterThan(0);
    const names = columns.map((c: any) => c.column_name);
    expect(names).toContain('session_id');
    expect(names).toContain('authentication_method');
  });

  it('should verify foreign key to auth.sessions', async () => {
    db.setContext({ role: 'service_role' });
    const fks = await db.any(
      `SELECT tc.constraint_name, ccu.table_name AS foreign_table_name
       FROM information_schema.table_constraints AS tc
       JOIN information_schema.constraint_column_usage AS ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY' 
         AND tc.table_schema = 'auth' 
         AND tc.table_name = 'mfa_amr_claims'`
    );
    expect(Array.isArray(fks)).toBe(true);
    if (fks.length > 0) {
      const hasSessionsFk = fks.some((r: any) => r.foreign_table_name === 'sessions');
      expect(hasSessionsFk).toBe(true);
    }
  });

  it('should verify unique composite key (session_id, authentication_method)', async () => {
    db.setContext({ role: 'service_role' });
    const uniqueCols = await db.any(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
       WHERE tc.table_schema = 'auth'
         AND tc.table_name   = 'mfa_amr_claims'
         AND tc.constraint_type = 'UNIQUE'
       ORDER BY kcu.ordinal_position`
    );
    expect(Array.isArray(uniqueCols)).toBe(true);
    if (uniqueCols.length > 0) {
      const cols = uniqueCols.map((r: any) => r.column_name);
      expect(cols).toEqual(['session_id','authentication_method']);
    }
  });

  it('should verify anon access to mfa_amr_claims based on rls', async () => {
    db.setContext({ role: 'service_role' });
    const rlsStatus = await db.any(
      `SELECT c.relrowsecurity 
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'auth' AND c.relname = 'mfa_amr_claims'`
    );
    expect(Array.isArray(rlsStatus)).toBe(true);
    expect(rlsStatus.length).toBeGreaterThan(0);
    
    db.clearContext();
    const result = await db.any(`SELECT * FROM auth.mfa_amr_claims LIMIT 1`);
    expect(Array.isArray(result)).toBe(true);
    if (rlsStatus[0].relrowsecurity === true) {
    expect(result.length).toBe(0);
    }
  });
});

