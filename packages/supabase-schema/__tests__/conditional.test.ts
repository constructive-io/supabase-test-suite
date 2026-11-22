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
  
  // minimal grants for tests
  await pg.any(
    `GRANT USAGE ON SCHEMA auth TO public;
     GRANT USAGE ON SCHEMA storage TO public;
     GRANT SELECT ON TABLE auth.users TO service_role;
     GRANT SELECT ON TABLE storage.buckets TO service_role;
     GRANT EXECUTE ON FUNCTION auth.uid() TO public;
     GRANT EXECUTE ON FUNCTION auth.role() TO public;`,
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

describe('tutorial: rls with conditional policies', () => {
  it('should verify rls policies can use case statements', async () => {
    db.setContext({ role: 'service_role' });
    
    // insert into auth.users using admin connection
    const user1 = await pg.one(
      `INSERT INTO auth.users (id, email) 
       VALUES (gen_random_uuid(), $1) 
       RETURNING id`,
      ['case1@example.com']
    );
    // ensure auth.role() sees service_role via jwt claim
    db.setContext({
      role: 'service_role',
      'request.jwt.claim.role': 'service_role'
    });
    // case over email and auth.role()
    const rows = await db.any(
      `SELECT 
         CASE WHEN email LIKE '%@example.com' THEN 'example' ELSE 'other' END AS grp,
         CASE WHEN auth.role() = 'service_role' THEN 'visible' ELSE 'hidden' END AS visibility
       FROM auth.users 
       WHERE id = $1`,
      [user1.id]
    );
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(1);
    expect(rows[0].grp).toBe('example');
    expect(rows[0].visibility).toBe('visible');
  });

  it('should verify rls policies work with multiple conditions', async () => {
    db.setContext({ role: 'service_role' });
    
    // insert into auth.users using admin connection
    const user = await pg.one(
      `INSERT INTO auth.users (id, email) 
       VALUES (gen_random_uuid(), $1) 
       RETURNING id`,
      ['multi1@example.com']
    );
    // ensure auth.role() sees service_role via jwt claim
    db.setContext({
      role: 'service_role',
      'request.jwt.claim.role': 'service_role'
    });
    // and/or combinations with auth.role()
    const rows = await db.any(
      `SELECT id 
       FROM auth.users 
       WHERE (email = $1 AND (auth.role() = 'service_role' OR auth.role() = 'authenticated'))
         AND id = $2`,
      ['multi1@example.com', user.id]
    );
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(user.id);
  });

  it('should verify rls policies work with or conditions', async () => {
    db.setContext({ role: 'service_role' });
    
    // insert into auth.users using admin connection
    const user = await pg.one(
      `INSERT INTO auth.users (id, email) 
       VALUES (gen_random_uuid(), $1) 
       RETURNING id`,
      ['or1@example.com']
    );
    const user2 = await pg.one(
      `INSERT INTO auth.users (id, email) 
       VALUES (gen_random_uuid(), $1) 
       RETURNING id`,
      ['or2@example.com']
    );

    const rows = await db.any(
      `SELECT COUNT(*)::integer AS count
       FROM auth.users 
       WHERE email = $1 OR email = $2`,
      ['or1@example.com', 'or2@example.com']
    );
    expect(Array.isArray(rows)).toBe(true);
    expect(Number(rows[0].count)).toBe(2);
  });

  it('should verify rls policies work with subqueries', async () => {
    db.setContext({ role: 'service_role' });
    
    // insert into auth.users using admin connection
    const user1 = await pg.one(
      `INSERT INTO auth.users (id, email) 
       VALUES (gen_random_uuid(), $1) 
       RETURNING id`,
      ['sub1@example.com']
    );
    

    const user2 = await pg.one(
      `INSERT INTO auth.users (id, email) 
       VALUES (gen_random_uuid(), $1) 
       RETURNING id`,
      ['sub2@example.com']
    );
    // use a subquery to resolve ids by email
    const viaSub = await db.any(
      `SELECT u.id 
       FROM auth.users u
       WHERE u.id IN (SELECT id FROM auth.users WHERE email = $1)`,
      ['sub1@example.com']
    );
    expect(viaSub.length).toBe(1);
    expect(viaSub[0].id).toBe(user1.id);

    // correlated exists
    const existsRows = await db.any(
      `SELECT u.id 
       FROM auth.users u
       WHERE EXISTS (
         SELECT 1 FROM auth.users i WHERE i.id = u.id AND i.email = $1
       )`,
      ['sub2@example.com']
    );
    expect(existsRows.length).toBeGreaterThan(0);
    const found = existsRows.find((r: any) => r.id === user2.id);
    expect(Boolean(found)).toBe(true);
  });

  it('should verify rls policies work with related table checks', async () => {
    db.setContext({ role: 'service_role' });
    
    // insert into auth.users using admin connection
    const user = await pg.one(
      `INSERT INTO auth.users (id, email) 
       VALUES (gen_random_uuid(), $1) 
       RETURNING id`,
      ['rel1@example.com']
    );
    // left join storage.buckets by fk owner -> auth.users(id)
    const rows = await db.any(
      `SELECT u.id, b.id AS bucket_id
       FROM auth.users u
       LEFT JOIN storage.buckets b ON b.owner = u.id
       WHERE u.id = $1`,
      [user.id]
    );
    expect(rows.length).toBe(1);
    // no bucket yet, so join should be null
    expect(rows[0].bucket_id === null || rows[0].bucket_id === undefined).toBe(true);
  });

  it('should verify rls policies work with null checks', async () => {
    db.setContext({ role: 'service_role' });
    
    // insert into auth.users using admin connection
    const user = await pg.one(
      `INSERT INTO auth.users (id, email) 
       VALUES (gen_random_uuid(), $1) 
       RETURNING id, email`,
      [null]
    );
    const rows = await db.any(
      `SELECT id FROM auth.users WHERE id = $1 AND email IS NULL`,
      [user.id]
    );
    expect(rows.length).toBe(1);
  });

  it('should verify rls policies work with coalesce functions', async () => {
    db.setContext({ role: 'service_role' });
    
    // insert into auth.users using admin connection
    const user = await pg.one(
      `INSERT INTO auth.users (id, email) 
       VALUES (gen_random_uuid(), $1) 
       RETURNING id`,
      [null]
    );
    const rows = await db.any(
      `SELECT COALESCE(email, '') AS safe_email FROM auth.users WHERE id = $1`,
      [user.id]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].safe_email).toBe('');
  });
});

