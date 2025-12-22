import { getConnections, PgTestClient, seed } from 'supabase-test';
import { pets, users } from './data/seed-data';

let db: PgTestClient;
let teardown: () => Promise<void>;

beforeAll(async () => {
  ({ db, teardown } = await getConnections(
    {},
    [
      // load schema and it's dependencies (supabase full schema)
      seed.pgpm(),

      // load data from json files
      seed.fn(async ({ pg }) => {
        await pg.query(`
-- Insert test users
INSERT INTO auth.users (id, email) VALUES 
  ('550e8400-e29b-41d4-a716-446655440001', 'alice@example.com'),
  ('550e8400-e29b-41d4-a716-446655440002', 'bob@example.com'),
  ('550e8400-e29b-41d4-a716-446655440003', 'charlie@example.com'),
  ('550e8400-e29b-41d4-a716-446655440004', 'diana@example.com');

-- Insert test pets
INSERT INTO rls_test.pets (id, name, breed, user_id) VALUES 
  ('660e8400-e29b-41d4-a716-446655440001', 'Fido', 'Labrador', '550e8400-e29b-41d4-a716-446655440001'),
  ('660e8400-e29b-41d4-a716-446655440002', 'Buddy', 'Golden Retriever', '550e8400-e29b-41d4-a716-446655440002'),
  ('660e8400-e29b-41d4-a716-446655440003', 'Rex', 'German Shepherd', '550e8400-e29b-41d4-a716-446655440003');
        `);
      }),
    ]
  ));
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

describe('tutorial: testing with pg function seeding', () => {
  it('data should be loaded into the database', async () => {

    db.setContext({
      role: 'authenticated',
      'request.jwt.claim.sub': users[0].id
    });

    const verifiedPets = await db.any(
      `SELECT id FROM rls_test.pets WHERE user_id = $1`,
      [users[0].id]
    );
    expect(verifiedPets.length).toBe(1);

    db.clearContext();

    const anonPets = await db.any(
      `SELECT id FROM rls_test.pets WHERE user_id = $1`,
      [users[0].id]
    );
    expect(anonPets.length).toBe(0);

  });
  it('should enforce RLS - users can only see their own pets', async () => {
    // set context to first user
    db.setContext({
      role: 'authenticated',
      'request.jwt.claim.sub': users[0].id
    });

    // user1 should only see their own pet (Fido)
    const user1Pets = await db.many(
      `SELECT id, name, breed, user_id FROM rls_test.pets ORDER BY name`
    );

    expect(user1Pets.length).toBe(1);
    expect(user1Pets[0].user_id).toBe(users[0].id);
    expect(user1Pets[0].name).toBe('Fido');

    // set context to second user
    db.setContext({
      role: 'authenticated',
      'request.jwt.claim.sub': users[1].id
    });

    // user2 should only see their own pet (Buddy)
    const user2Pets = await db.many(
      `SELECT id, name, breed, user_id FROM rls_test.pets ORDER BY name`
    );

    expect(user2Pets.length).toBe(1);
    expect(user2Pets[0].user_id).toBe(users[1].id);
    expect(user2Pets[0].name).toBe('Buddy');
  });
});

