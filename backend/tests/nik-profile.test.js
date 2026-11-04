const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const request = require('supertest');

const { openDatabase } = require('../src/database/connection');
const { runMigrations } = require('../src/database/migrate');
const { createStore } = require('../src/shared/store');
const { createApp } = require('../src/app');

const {
  createAuthService,
} = require('../src/modules/nik/auth.service');

const {
  createProfileService,
} = require('../src/modules/nik/profile');

let directory;
let filename;
let db;
let profiles;
let auth;
let user;
let other;

beforeEach(async () => {
  directory = mkdtempSync(
    path.join(tmpdir(), 'queuesmart-profile-')
  );

  filename = path.join(directory, 'test.sqlite');
  db = openDatabase({ filename });
  runMigrations(db);

  auth = createAuthService({
    store: createStore(),
    db,
  });

  user = await auth.register({
    name: 'First User',
    email: 'first@example.com',
    password: 'test-password-123',
  });

  other = await auth.register({
    name: 'Other User',
    email: 'other@example.com',
    password: 'test-password-123',
  });

  profiles = createProfileService(db);
});

afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('Profile service', () => {
  test('returns only safe profile fields', () => {
    expect(profiles.getProfile(user.id)).toEqual({
      ...user,
      phone: null,
      preferences: {},
    });
  });

  test('saves fields without changing another user or the password', () => {
    const saved = profiles.saveProfile(user.id, {
      name: ' Updated Name ',
      phone: ' +1 555 010 0000 ',
      preferences: { emailNotifications: false },
    });

    expect(saved.name).toBe('Updated Name');
    expect(saved.phone).toBe('+1 555 010 0000');
    expect(saved.preferences).toEqual({
      emailNotifications: false,
    });

    expect(profiles.getProfile(other.id)).toEqual({
      ...other,
      phone: null,
      preferences: {},
    });

    expect(
      db.prepare(`
        SELECT password_hash
        FROM user_credentials
        WHERE id = ?
      `).get(user.id).password_hash
    ).toMatch(/^scrypt\$/);
  });

  test('preserves omitted fields and clears phone with null', () => {
    profiles.saveProfile(user.id, {
      phone: '123',
      preferences: { theme: 'light' },
    });

    const saved = profiles.saveProfile(user.id, {
      name: 'Changed',
    });

    expect(saved.phone).toBe('123');
    expect(saved.preferences).toEqual({ theme: 'light' });

    expect(
      profiles.saveProfile(user.id, { phone: null }).phone
    ).toBeNull();
  });

  test('persists changes and returns the updated name at login', async () => {
    profiles.saveProfile(user.id, {
      name: 'Persisted Name',
    });

    db.close();
    db = openDatabase({ filename });

    expect(
      createProfileService(db).getProfile(user.id).name
    ).toBe('Persisted Name');

    const freshAuth = createAuthService({
      store: createStore(),
      db,
    });

    const login = await freshAuth.login({
      email: user.email,
      password: 'test-password-123',
    });

    expect(login.user.name).toBe('Persisted Name');
  });

  test.each([
    {},
    { name: '' },
    { name: '   ' },
    { name: 'x'.repeat(101) },
    { phone: '' },
    { phone: '1'.repeat(31) },
    { preferences: [] },
    { preferences: { text: 'x'.repeat(4096) } },
    { preferences: { text: '\u00e9'.repeat(2100) } },
    { email: 'new@example.com' },
    { role: 'admin' },
    { userId: 'other' },
  ])('rejects invalid or forbidden updates: %j', input => {
    expect(() =>
      profiles.saveProfile(user.id, input)
    ).toThrow(
      expect.objectContaining({ status: 400 })
    );

    expect(profiles.getProfile(user.id).name).toBe(user.name);
  });

  test('returns 404 for a missing profile', () => {
    expect(() =>
      profiles.getProfile('missing')
    ).toThrow(
      expect.objectContaining({ status: 404 })
    );

    expect(() =>
      profiles.saveProfile('missing', { name: 'Name' })
    ).toThrow(
      expect.objectContaining({ status: 404 })
    );
  });

  test('maps the administrator role safely', async () => {
    const admin = await auth.registerAdmin({
      name: 'Admin',
      email: 'admin@example.com',
      password: 'test-password-123',
    });

    expect(profiles.getProfile(admin.id).role).toBe('admin');
  });
});

describe('Profile API', () => {
  let app;
  let token;

  beforeEach(async () => {
    app = createApp({ db });

    const login = await request(app)
      .post('/api/auth/login')
      .send({
        email: user.email,
        password: 'test-password-123',
      });

    token = login.body.data.token;
  });

  afterEach(() => {
    app.locals.stopSubscribers();
  });

  test('requires login for reading and editing', async () => {
    const read = await request(app)
      .get('/api/me/profile');

    expect(read.status).toBe(401);

    const update = await request(app)
      .patch('/api/me/profile')
      .send({ name: 'Name' });

    expect(update.status).toBe(401);
  });

  test('reads and updates only the authenticated profile', async () => {
    const saved = await request(app)
      .patch('/api/me/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated', phone: '123' });

    expect(saved.status).toBe(200);
    expect(saved.body.data.id).toBe(user.id);
    expect(saved.body.data.name).toBe('Updated');

    const read = await request(app)
      .get('/api/me/profile')
      .set('Authorization', `Bearer ${token}`);

    expect(read.body.data).toEqual(saved.body.data);
    expect(profiles.getProfile(other.id).name)
      .toBe('Other User');

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(me.body.data.name).toBe('Updated');

    const forbidden = await request(app)
      .patch('/api/me/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({
        userId: other.id,
        name: 'Changed',
      });

    expect(forbidden.status).toBe(400);
  });

  test('rejects role/email changes and invalid fields', async () => {
    const invalidBodies = [
      { role: 'admin' },
      { email: 'new@example.com' },
      {},
      { name: ' ' },
    ];

    for (const body of invalidBodies) {
      const response = await request(app)
        .patch('/api/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send(body);

      expect(response.status).toBe(400);
    }
  });
});