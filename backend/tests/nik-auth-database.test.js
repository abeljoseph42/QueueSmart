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
  createUserRepository,
} = require('../src/modules/nik/user.repository');

const {
  createDemoAdmin,
} = require('../src/modules/nik/bootstrap');

let directory;
let filename;
let db;
let store;
let auth;

const input = {
  name: 'Persistent User',
  email: 'persistent@example.com',
  password: 'test-password-123',
};

const req = token => ({
  get: () => `Bearer ${token}`,
});

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'queuesmart-auth-'));
  filename = path.join(directory, 'test.sqlite');

  db = openDatabase({ filename });
  runMigrations(db);

  store = createStore();
  auth = createAuthService({ store, db });
});

afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('SQLite auth service', () => {
  test('persists credentials/profile without plain text or the users Map', async () => {
    const user = await auth.register(input);

    expect(user).toEqual({
      id: expect.any(String),
      name: input.name,
      email: input.email,
      role: 'user',
    });

    const row = db.prepare(
      'SELECT * FROM user_credentials'
    ).get();

    expect(row.role).toBe('User');
    expect(row.password_hash).toMatch(
      /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/
    );
    expect(row.password_hash).not.toContain(input.password);

    expect(
      db.prepare('SELECT full_name FROM user_profile')
        .get().full_name
    ).toBe(input.name);

    expect(store.users.size).toBe(0);
  });

  test('logs in after reopening; old sessions are gone', async () => {
    const user = await auth.register(input);
    const old = await auth.login(input);

    db.close();
    db = openDatabase({ filename });

    store = createStore();
    auth = createAuthService({ store, db });

    expect(await auth.resolveUser(req(old.token))).toBeNull();

    const result = await auth.login(input);

    expect(result.user).toEqual(user);
    expect(await auth.resolveUser(req(result.token))).toEqual(user);
  });

  test('normalizes email and rejects a duplicate', async () => {
    await auth.register({
      ...input,
      email: ' PERSISTENT@example.com ',
    });

    await expect(auth.register(input)).rejects.toMatchObject({
      status: 409,
      code: 'EMAIL_IN_USE',
    });

    const result = await auth.login({
      ...input,
      email: 'PERSISTENT@example.com',
    });

    expect(result.user.email).toBe(input.email);
  });

  test('rejects duplicate registration through two connections', async () => {
    const other = openDatabase({ filename });

    try {
      const second = createAuthService({
        store: createStore(),
        db: other,
      });

      const results = await Promise.allSettled([
        auth.register(input),
        second.register(input),
      ]);

      expect(
        results.filter(result => result.status === 'fulfilled')
      ).toHaveLength(1);

      expect(
        results.find(result => result.status === 'rejected').reason
      ).toMatchObject({ status: 409 });
    } finally {
      other.close();
    }
  });

  test('maps database uniqueness errors to the existing API error', async () => {
    const user = await auth.register(input);
    const repository = createUserRepository(db);
    const saved = repository.findById(user.id);

    expect(() =>
      repository.insert({
        ...saved,
        id: require('node:crypto').randomUUID(),
      })
    ).toThrow(
      expect.objectContaining({
        status: 409,
        code: 'EMAIL_IN_USE',
      })
    );
  });

  test('rolls back credentials when the profile is invalid', async () => {
    await expect(
      auth.register({ ...input, name: '' })
    ).rejects.toThrow();

    expect(
      db.prepare(
        'SELECT COUNT(*) AS count FROM user_credentials'
      ).get().count
    ).toBe(0);
  });

  test('ignores an admin role in a registration object', async () => {
    const user = await auth.register({
      ...input,
      role: 'admin',
    });

    expect(user.role).toBe('user');

    expect(
      db.prepare('SELECT role FROM user_credentials').get().role
    ).toBe('User');
  });

  test('rejects wrong passwords and unknown accounts without sessions', async () => {
    await auth.register(input);

    await expect(
      auth.login({ ...input, password: 'wrong-password' })
    ).rejects.toMatchObject({ status: 401 });

    await expect(
      auth.login({ ...input, email: 'unknown@example.com' })
    ).rejects.toMatchObject({ status: 401 });

    expect(store.sessions.size).toBe(0);
  });

  test('expires database-backed user sessions after one hour', async () => {
    let now = 1000;

    auth = createAuthService({
      store,
      db,
      now: () => now,
    });

    await auth.register(input);
    const { token } = await auth.login(input);

    now += 60 * 60 * 1000;

    expect(await auth.resolveUser(req(token))).toBeNull();
  });

  test('rejects an unsupported stored hash', async () => {
    await auth.register(input);

    db.prepare(
      'UPDATE user_credentials SET password_hash = ?'
    ).run('invalid');

    await expect(auth.login(input)).rejects.toThrow(
      'Unsupported stored password hash'
    );
  });

  test('does not fall back to memory on a database error', async () => {
    db.exec('DROP TABLE user_profile');

    await expect(auth.register(input)).rejects.toThrow();

    expect(store.users.size).toBe(0);
  });

  test('reuses a persisted admin without resetting its password', async () => {
    const config = {
      store,
      db,
      email: 'admin@example.com',
      password: 'original-password-123',
    };

    const first = await createDemoAdmin(config);

    const again = await createDemoAdmin({
      ...config,
      password: 'changed-config-password-123',
    });

    expect(again).toEqual(first);
    expect(first.role).toBe('admin');
    expect((await auth.login(config)).user.role).toBe('admin');

    await expect(
      auth.login({
        ...config,
        password: 'changed-config-password-123',
      })
    ).rejects.toMatchObject({ status: 401 });

    expect(
      db.prepare(
        'SELECT COUNT(*) AS count FROM user_credentials'
      ).get().count
    ).toBe(1);

    expect(
      db.prepare('SELECT role FROM user_credentials').get().role
    ).toBe('Administrator');
  });

  test('refuses to promote an existing regular account', async () => {
    await auth.register(input);

    await expect(
      createDemoAdmin({
        store,
        db,
        email: input.email,
        password: input.password,
      })
    ).rejects.toMatchObject({ status: 409 });

    expect((await auth.login(input)).user.role).toBe('user');
  });

  test('creates no admin without configuration', async () => {
    expect(await createDemoAdmin({ store, db })).toBeNull();

    expect(
      db.prepare(
        'SELECT COUNT(*) AS count FROM user_credentials'
      ).get().count
    ).toBe(0);
  });
});

describe('SQLite auth API', () => {
  test('registers, authenticates, and logs in after reopening', async () => {
    let app = createApp({ db });

    try {
      const registered = await request(app)
        .post('/api/auth/register')
        .send(input);

      expect(registered.status).toBe(201);

      expect(
        Object.keys(registered.body.data.user).sort()
      ).toEqual(['email', 'id', 'name', 'role']);

      const token = registered.body.data.token;

      const me = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(me.status).toBe(200);
      expect(me.body.data.id).toBe(registered.body.data.user.id);

      app.locals.stopSubscribers();
      db.close();
      db = openDatabase({ filename });

      app = createApp({ db });

      const login = await request(app)
        .post('/api/auth/login')
        .send({
            email: input.email,
            password: input.password,
        });

      expect(login.status).toBe(200);
      expect(login.body.data.user)
        .toEqual(registered.body.data.user);

      const oldSession = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(oldSession.status).toBe(401);
    } finally {
      app.locals.stopSubscribers();
    }
  });

  test('retains validation and duplicate-email HTTP behavior', async () => {
    const app = createApp({ db });

    try {
      const invalid = await request(app)
        .post('/api/auth/register')
        .send({ ...input, role: 'admin' });

      expect(invalid.status).toBe(400);

      const registered = await request(app)
        .post('/api/auth/register')
        .send(input);

      expect(registered.status).toBe(201);

      const duplicate = await request(app)
        .post('/api/auth/register')
        .send(input);

      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe('EMAIL_IN_USE');

      const wrongPassword = await request(app)
        .post('/api/auth/login')
        .send({
            email: input.email,
            password: 'wrong-password',
        });

      expect(wrongPassword.status).toBe(401);
    } finally {
      app.locals.stopSubscribers();
    }
  });
});