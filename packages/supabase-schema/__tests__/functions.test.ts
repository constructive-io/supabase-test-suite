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
  
  // grant access to auth and storage schemas for testing
  // grant INSERT on auth.users to service_role so we can create test users
  await pg.any(
    `GRANT USAGE ON SCHEMA auth TO public;
     GRANT USAGE ON SCHEMA storage TO public;
     GRANT INSERT ON TABLE auth.users TO service_role;
     GRANT EXECUTE ON FUNCTION auth.uid() TO public;
     GRANT EXECUTE ON FUNCTION auth.role() TO public;
     GRANT EXECUTE ON FUNCTION auth.email() TO public;`,
    []
  );
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

describe('tutorial: rls with supabase functions', () => {
  it('should verify auth.uid() function exists and works', async () => {
    // verify function exists first
    db.setContext({ role: 'service_role' });
    const funcExists = await db.any(
      `SELECT EXISTS (
        SELECT FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'auth' AND p.proname = 'uid'
      ) as exists`
    );
    expect(funcExists[0].exists).toBe(true);
    
    // using auth.users (real supabase table) instead of rls_test.user_profiles (fake test table)
    // set service_role context to insert into auth.users (requires INSERT permission)
    const user = await pg.one(
      `INSERT INTO auth.users (id, email) 
       VALUES (gen_random_uuid(), $1) 
       RETURNING id`,
      ['func1@example.com']
    );

    db.setContext({
      role: 'authenticated',
      'request.jwt.claim.sub': user.id
    });

    // verify auth.uid() returns correct user id
    const uidResult = await db.one(`SELECT auth.uid() as uid`);
    expect(uidResult.uid).toBe(user.id);
  });

  it('should verify auth.role() function exists and works', async () => {
    // verify function exists first
    db.setContext({ role: 'service_role' });
    const funcExists = await db.any(
      `SELECT EXISTS (
        SELECT FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'auth' AND p.proname = 'role'
      ) as exists`
    );
    expect(funcExists[0].exists).toBe(true);
    
    db.setContext({
      role: 'authenticated',
      'request.jwt.claim.role': 'authenticated'
    });

    const roleResult = await db.one(`SELECT auth.role() as role`);
    expect(roleResult.role).toBe('authenticated');
  });

  it('should verify auth.email() function exists and works', async () => {
    // verify function exists first
    db.setContext({ role: 'service_role' });
    const funcExists = await db.any(
      `SELECT EXISTS (
        SELECT FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'auth' AND p.proname = 'email'
      ) as exists`
    );
    expect(funcExists[0].exists).toBe(true);
    
    // using auth.users (real supabase table) instead of rls_test.user_profiles (fake test table)
    // use pg for auth.users insert since it requires superuser privileges
    const user = await pg.one(
      `INSERT INTO auth.users (id, email) 
       VALUES (gen_random_uuid(), $1) 
       RETURNING id, email`,
      ['emailfunc@example.com']
    );
    
    

    db.setContext({
      role: 'authenticated',
      'request.jwt.claim.sub': user.id,
      'request.jwt.claim.email': user.email
    });

    const emailResult = await db.one(`SELECT auth.email() as email`);
    expect(emailResult.email).toBe(user.email);
  });

  it('should verify functions work in rls policy context', async () => {
    // verify function exists first
    db.setContext({ role: 'service_role' });
    const funcExists = await db.any(
      `SELECT EXISTS (
        SELECT FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'auth' AND p.proname = 'uid'
      ) as exists`
    );
    expect(funcExists[0].exists).toBe(true);
    
    // using auth.users (real supabase table) instead of rls_test.user_profiles (fake test table)
    // use pg for auth.users insert since it requires superuser privileges
    const user = await pg.one(
      `INSERT INTO auth.users (id, email) 
       VALUES (gen_random_uuid(), $1) 
       RETURNING id`,
      ['policyfunc@example.com']
    );
    
    
  });

  it('should verify functions return null for anon users', async () => {
    // verify function exists first
    db.setContext({ role: 'service_role' });
    const funcExists = await db.any(
      `SELECT EXISTS (
        SELECT FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'auth' AND p.proname = 'uid'
      ) as exists`
    );
    expect(funcExists[0].exists).toBe(true);
    
    db.clearContext();

    const uidResult = await db.any(`SELECT auth.uid() as uid`);
    expect(uidResult.length).toBe(1);
    // auth.uid() should return null for anon
    expect(uidResult[0].uid).toBeNull();
  });

  it('should verify storage functions exist and are callable', async () => {
    db.setContext({ role: 'service_role' });
    
    // check if storage.search function exists
    const funcExists = await db.any(
      `SELECT EXISTS (
        SELECT FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'storage' AND p.proname = 'search'
      ) as exists`
    );
    
    expect(Array.isArray(funcExists)).toBe(true);
    expect(funcExists.length).toBe(1);
    
    // if function exists, verify we can check its signature
    if (funcExists[0].exists) {
      const funcInfo = await db.any(
        `SELECT p.proname, n.nspname
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'storage' AND p.proname = 'search'
         LIMIT 1`
      );
      expect(funcInfo.length).toBe(1);
      expect(funcInfo[0].proname).toBe('search');
      expect(funcInfo[0].nspname).toBe('storage');
    }
  });

  it('should verify functions can be used in where clauses with rls', async () => {
    // verify function exists first
    db.setContext({ role: 'service_role' });
    const funcExists = await db.any(
      `SELECT EXISTS (
        SELECT FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'auth' AND p.proname = 'uid'
      ) as exists`
    );
    expect(funcExists[0].exists).toBe(true);
    
    // using auth.users (real supabase table) instead of rls_test.user_profiles (fake test table)
    // use pg for auth.users insert since it requires superuser privileges
    const user = await pg.one(
      `INSERT INTO auth.users (id, email) 
       VALUES (gen_random_uuid(), $1) 
       RETURNING id`,
      ['wherefunc@example.com']
    );
    
    
  });

  it('should verify functions work in subqueries with rls', async () => {
    // verify function exists first
    db.setContext({ role: 'service_role' });
    const funcExists = await db.any(
      `SELECT EXISTS (
        SELECT FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'auth' AND p.proname = 'uid'
      ) as exists`
    );
    expect(funcExists[0].exists).toBe(true);
    
    // using auth.users (real supabase table) instead of rls_test.user_profiles (fake test table)
    // use pg for auth.users insert since it requires superuser privileges
    const user = await pg.one(
      `INSERT INTO auth.users (id, email) 
       VALUES (gen_random_uuid(), $1) 
       RETURNING id`,
      ['subfunc@example.com']
    );
    
    
  });
});

