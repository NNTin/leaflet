/**
 * Integration tests for the Leaflet backend.
 *
 * The database pool is mocked so tests run without a real PostgreSQL instance.
 */

import request from 'supertest';
import path from 'path';
import YAML from 'yamljs';

interface UrlRecord {
  id: number;
  short_code: string;
  original_url: string;
  user_id: number | null;
  expires_at: Date | null;
  is_custom: boolean;
  created_at: Date;
}

interface UserRecord {
  id: number;
  github_id: string;
  username: string;
  role: string;
  created_at: Date;
  api_key: string | null;
}

const db = {
  urls: [] as UrlRecord[],
  users: [] as UserRecord[],
  nextUrlId: 1,
  nextUserId: 1,
};

jest.mock('../db', () => {
  return {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      const s = sql.replace(/\s+/g, ' ').trim().toLowerCase();

      if (s.startsWith('insert into urls')) {
        const [short_code, original_url, user_id, expires_at, is_custom] = params as [string, string, number | null, Date | null, boolean];
        const row: UrlRecord = {
          id: db.nextUrlId++,
          short_code,
          original_url,
          user_id: user_id ?? null,
          expires_at: expires_at ?? null,
          is_custom: is_custom || false,
          created_at: new Date(),
        };
        db.urls.push(row);
        return { rows: [row] };
      }

      if (s.startsWith('select id from urls where short_code')) {
        const [code] = params as [string];
        return { rows: db.urls.filter(u => u.short_code === code) };
      }

      if (s.includes('select original_url from urls')) {
        const [code] = params as [string];
        const now = new Date();
        return { rows: db.urls.filter(u => u.short_code === code && (u.expires_at === null || u.expires_at > now)) };
      }

      if (s.startsWith('select') && s.includes('from urls')) {
        const rows = db.urls.map(u => {
          const creator = db.users.find(usr => usr.id === u.user_id);
          return { ...u, created_by: creator ? creator.username : null };
        });
        return { rows };
      }

      if (s.startsWith('delete from urls')) {
        const [id] = params as [string];
        const idx = db.urls.findIndex(u => u.id === Number(id));
        if (idx === -1) return { rows: [] };
        db.urls.splice(idx, 1);
        return { rows: [{ id }] };
      }

      if (s.startsWith('insert into users')) {
        const [github_id, username, role] = params as [string, string, string];
        const existing = db.users.find(u => u.github_id === github_id);
        if (existing) {
          existing.username = username;
          existing.role = existing.role === 'admin' ? 'admin' : (role === 'admin' ? 'admin' : existing.role);
          return { rows: [existing] };
        }
        const row: UserRecord = { id: db.nextUserId++, github_id, username, role, created_at: new Date(), api_key: null };
        db.users.push(row);
        return { rows: [row] };
      }

      if (s.startsWith('select * from users where id')) {
        const [id] = params as [number];
        return { rows: db.users.filter(u => u.id === Number(id)) };
      }

      if (s.startsWith('select * from users where api_key')) {
        const [apiKey] = params as [string];
        return { rows: db.users.filter(u => u.api_key === apiKey) };
      }

      if (s.startsWith('select') && s.includes('from users')) {
        return { rows: db.users };
      }

      if (s.startsWith('update users set role')) {
        const [role, id] = params as [string, string];
        const user = db.users.find(u => u.id === Number(id) && u.role !== 'admin');
        if (!user) return { rows: [] };
        user.role = role;
        return { rows: [user] };
      }

      if (s.startsWith('update users set api_key')) {
        const [apiKey, id] = params as [string, number];
        const user = db.users.find(u => u.id === Number(id));
        if (user) user.api_key = apiKey;
        return { rows: [] };
      }

      return { rows: [] };
    }),
  };
});

jest.mock('../shortcode', () => ({
  generateShortCode: jest.fn(async () => 'testcode'),
}));

process.env.ALLOWED_FRONTEND_ORIGINS = 'http://localhost:5173,https://nntin.xyz,https://leaflet.lair.nntin.xyz';
process.env.PUBLIC_SHORT_URL_BASE = 'https://leaflet.lair.nntin.xyz/s';
process.env.PUBLIC_API_ORIGIN = 'https://leaflet.lair.nntin.xyz';
process.env.DEFAULT_FRONTEND_URL = 'http://localhost:5173';

import app from '../app';

function makeAdminUser(): UserRecord {
  const user: UserRecord = { id: db.nextUserId++, github_id: 'admin-gh', username: 'adminuser', role: 'admin', created_at: new Date(), api_key: 'admin-api-key-test' };
  db.users.push(user);
  return user;
}

function makePrivilegedUser(): UserRecord {
  const user: UserRecord = { id: db.nextUserId++, github_id: 'priv-gh', username: 'privuser', role: 'privileged', created_at: new Date(), api_key: 'priv-api-key-test' };
  db.users.push(user);
  return user;
}

function makeRegularUser(): UserRecord {
  const user: UserRecord = { id: db.nextUserId++, github_id: 'user-gh', username: 'regularuser', role: 'user', created_at: new Date(), api_key: 'user-api-key-test' };
  db.users.push(user);
  return user;
}

beforeEach(() => {
  db.urls = [];
  db.users = [];
  db.nextUrlId = 1;
  db.nextUserId = 1;
  jest.clearAllMocks();
});

describe('OpenAPI TTL enum contract', () => {
  it('has enum values matching backend TTL_MAP keys', () => {
    const spec = YAML.load(path.join(__dirname, '../openapi.yaml')) as {
      paths: { '/api/shorten': { post: { requestBody: { content: { 'application/json': { schema: { properties: { ttl: { enum: string[] } } } } } } } } };
    };
    const ttlEnum = spec.paths['/api/shorten'].post.requestBody.content['application/json'].schema.properties.ttl.enum;
    expect(ttlEnum.sort()).toEqual(['24h', '1h', '5m', 'never'].sort());
  });

  it('does not contain deprecated 60m value', () => {
    const spec = YAML.load(path.join(__dirname, '../openapi.yaml')) as {
      paths: { '/api/shorten': { post: { requestBody: { content: { 'application/json': { schema: { properties: { ttl: { enum: string[] } } } } } } } } };
    };
    const ttlEnum = spec.paths['/api/shorten'].post.requestBody.content['application/json'].schema.properties.ttl.enum;
    expect(ttlEnum).not.toContain('60m');
  });
});

describe('POST /api/shorten - anonymous rate limiting', () => {
  it('allows first request and blocks second (429) from same IP', async () => {
    const ip = '10.99.1.1';
    const agent = request.agent(app);
    const csrfRes = await agent.get('/auth/csrf-token').set('X-Forwarded-For', ip);
    const csrf = csrfRes.body.csrfToken as string;
    const body = { url: 'https://example.com', ttl: '24h' };

    const first = await agent.post('/api/shorten').set('X-CSRF-Token', csrf).set('X-Forwarded-For', ip).send(body);
    expect(first.status).toBe(201);

    const second = await agent.post('/api/shorten').set('X-CSRF-Token', csrf).set('X-Forwarded-For', ip).send(body);
    expect(second.status).toBe(429);
  });
});

describe('GET /api/:code - redirect contract', () => {
  it('returns 302 to original URL for active short code', async () => {
    db.urls.push({ id: 1, short_code: 'active1', original_url: 'https://example.com', expires_at: new Date(Date.now() + 86400000), is_custom: false, user_id: null, created_at: new Date() });
    const res = await request(app).get('/api/active1').redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.com');
  });

  it('returns 404 JSON for expired short code', async () => {
    db.urls.push({ id: 2, short_code: 'expired1', original_url: 'https://example.com', expires_at: new Date(Date.now() - 1000), is_custom: false, user_id: null, created_at: new Date() });
    const res = await request(app).get('/api/expired1');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 404 JSON for non-existent short code', async () => {
    const res = await request(app).get('/api/doesnotexist');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});

describe('GET /s/:code - canonical redirect contract', () => {
  it('returns 302 to original URL for active short code', async () => {
    db.urls.push({ id: 1, short_code: 'active1', original_url: 'https://example.com', expires_at: new Date(Date.now() + 86400000), is_custom: false, user_id: null, created_at: new Date() });
    const res = await request(app).get('/s/active1').redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.com');
  });

  it('returns 404 JSON for expired short code', async () => {
    db.urls.push({ id: 2, short_code: 'expired1', original_url: 'https://example.com', expires_at: new Date(Date.now() - 1000), is_custom: false, user_id: null, created_at: new Date() });
    const res = await request(app).get('/s/expired1');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});

describe('POST /api/shorten - TTL values', () => {
  const cases: [string, number][] = [['5m', 5 * 60 * 1000], ['1h', 60 * 60 * 1000], ['24h', 24 * 60 * 60 * 1000]];
  cases.forEach(([ttl, expectedMs], idx) => {
    it(`sets expires_at correctly for ${ttl}`, async () => {
      const ip = `10.99.2.${idx + 1}`;
      const agent = request.agent(app);
      const csrfRes = await agent.get('/auth/csrf-token').set('X-Forwarded-For', ip);
      const csrf = csrfRes.body.csrfToken as string;
      const before = Date.now();
      const res = await agent.post('/api/shorten').set('X-CSRF-Token', csrf).set('X-Forwarded-For', ip).send({ url: 'https://example.com', ttl });
      expect(res.status).toBe(201);
      const after = Date.now();
      const expiresAt = new Date(res.body.expiresAt as string).getTime();
      expect(expiresAt).toBeGreaterThanOrEqual(before + expectedMs - 2000);
      expect(expiresAt).toBeLessThanOrEqual(after + expectedMs + 2000);
    });
  });

  it('rejects invalid TTL value 60m with 400', async () => {
    const ip = '10.99.2.9';
    const agent = request.agent(app);
    const csrfRes = await agent.get('/auth/csrf-token').set('X-Forwarded-For', ip);
    const csrf = csrfRes.body.csrfToken as string;
    const res = await agent.post('/api/shorten').set('X-CSRF-Token', csrf).set('X-Forwarded-For', ip).send({ url: 'https://example.com', ttl: '60m' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/shorten - role enforcement', () => {
  it('forbids alias for anonymous users', async () => {
    const ip = '10.99.3.1';
    const agent = request.agent(app);
    const csrfRes = await agent.get('/auth/csrf-token').set('X-Forwarded-For', ip);
    const res = await agent.post('/api/shorten').set('X-CSRF-Token', csrfRes.body.csrfToken as string).set('X-Forwarded-For', ip).send({ url: 'https://example.com', ttl: '24h', alias: 'my-alias' });
    expect(res.status).toBe(403);
  });

  it('forbids alias for regular user via API key', async () => {
    makeRegularUser();
    const res = await request(app).post('/api/shorten').set('Authorization', 'Bearer user-api-key-test').send({ url: 'https://example.com', ttl: '24h', alias: 'my-alias' });
    expect(res.status).toBe(403);
  });

  it('allows alias for privileged user via API key', async () => {
    makePrivilegedUser();
    const res = await request(app).post('/api/shorten').set('Authorization', 'Bearer priv-api-key-test').send({ url: 'https://example.com', ttl: '24h', alias: 'priv-alias' });
    expect(res.status).toBe(201);
    expect(res.body.shortCode).toBe('priv-alias');
  });

  it('allows alias for admin user via API key', async () => {
    makeAdminUser();
    const res = await request(app).post('/api/shorten').set('Authorization', 'Bearer admin-api-key-test').send({ url: 'https://example.com', ttl: '24h', alias: 'admin-alias' });
    expect(res.status).toBe(201);
    expect(res.body.shortCode).toBe('admin-alias');
  });

  it('returns 409 for duplicate alias', async () => {
    makePrivilegedUser();
    db.urls.push({ id: 1, short_code: 'taken', original_url: 'https://other.com', expires_at: null, is_custom: true, user_id: null, created_at: new Date() });
    const res = await request(app).post('/api/shorten').set('Authorization', 'Bearer priv-api-key-test').send({ url: 'https://example.com', ttl: '24h', alias: 'taken' });
    expect(res.status).toBe(409);
  });

  it('forbids never-TTL for non-admin', async () => {
    makeRegularUser();
    const res = await request(app).post('/api/shorten').set('Authorization', 'Bearer user-api-key-test').send({ url: 'https://example.com', ttl: 'never' });
    expect(res.status).toBe(403);
  });

  it('allows never-TTL for admin, resulting in null expiresAt', async () => {
    makeAdminUser();
    const res = await request(app).post('/api/shorten').set('Authorization', 'Bearer admin-api-key-test').send({ url: 'https://example.com', ttl: 'never' });
    expect(res.status).toBe(201);
    expect(res.body.expiresAt).toBeNull();
  });
});

describe('POST /api/shorten - shortUrl shape', () => {
  it('returns the canonical backend shortUrl with /s/ prefix, not /api/', async () => {
    const ip = '10.99.4.1';
    const agent = request.agent(app);
    const csrfRes = await agent.get('/auth/csrf-token').set('X-Forwarded-For', ip);
    const res = await agent.post('/api/shorten').set('X-CSRF-Token', csrfRes.body.csrfToken as string).set('X-Forwarded-For', ip).send({ url: 'https://example.com', ttl: '24h' });
    expect(res.status).toBe(201);
    expect(res.body.shortUrl).toBe('https://leaflet.lair.nntin.xyz/s/testcode');
    expect(res.body.shortUrl).not.toMatch(/\/api\//);
  });
});

describe('Admin dashboard API endpoints', () => {
  it('GET /admin/urls - rejects unauthenticated request with 401', async () => {
    const res = await request(app).get('/admin/urls');
    expect(res.status).toBe(401);
  });

  it('GET /admin/urls - rejects non-admin user with 403', async () => {
    makeRegularUser();
    const res = await request(app).get('/admin/urls').set('Authorization', 'Bearer user-api-key-test');
    expect(res.status).toBe(403);
  });

  it('GET /admin/urls - returns camelCase fields for admin', async () => {
    makeAdminUser();
    db.urls.push({ id: 1, short_code: 'abc123', original_url: 'https://example.com', expires_at: null, is_custom: false, user_id: null, created_at: new Date() });
    const res = await request(app).get('/admin/urls').set('Authorization', 'Bearer admin-api-key-test');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const item = res.body[0] as Record<string, unknown>;
    expect(item).toHaveProperty('shortCode', 'abc123');
    expect(item).toHaveProperty('originalUrl');
    expect(item).toHaveProperty('createdAt');
    expect(item).not.toHaveProperty('short_code');
  });

  it('GET /admin/users - returns camelCase fields for admin', async () => {
    makeAdminUser();
    makeRegularUser();
    const res = await request(app).get('/admin/users').set('Authorization', 'Bearer admin-api-key-test');
    expect(res.status).toBe(200);
    const user = (res.body as Record<string, unknown>[]).find(u => (u as { username: string }).username === 'regularuser');
    expect(user).toHaveProperty('createdAt');
    expect(user).not.toHaveProperty('created_at');
  });

  it('DELETE /admin/urls/:id - returns 404 for unknown id', async () => {
    makeAdminUser();
    const res = await request(app).delete('/admin/urls/9999').set('Authorization', 'Bearer admin-api-key-test');
    expect(res.status).toBe(404);
  });

  it('PATCH /admin/users/:id/role - prevents admin self-demotion', async () => {
    const admin = makeAdminUser();
    const res = await request(app).patch(`/admin/users/${admin.id}/role`).set('Authorization', 'Bearer admin-api-key-test').send({ role: 'user' });
    expect(res.status).toBe(400);
  });
});

describe('CSRF protection', () => {
  it('accepts valid X-CSRF-Token and returns 201', async () => {
    const ip = '10.99.5.1';
    const agent = request.agent(app);
    const csrfRes = await agent.get('/auth/csrf-token').set('X-Forwarded-For', ip);
    const res = await agent.post('/api/shorten').set('X-CSRF-Token', csrfRes.body.csrfToken as string).set('X-Forwarded-For', ip).send({ url: 'https://example.com', ttl: '24h' });
    expect([201, 429]).toContain(res.status);
  });

  it('rejects allowed frontend origins without a CSRF token', async () => {
    const res = await request(app)
      .post('/api/shorten')
      .set('Origin', 'http://localhost:5173')
      .send({ url: 'https://example.com', ttl: '24h' });

    expect(res.status).toBe(403);
  });

  it('accepts valid X-CSRF-Token from an allowed frontend origin', async () => {
    const ip = '10.99.5.2';
    const agent = request.agent(app);
    const csrfRes = await agent.get('/auth/csrf-token').set('X-Forwarded-For', ip);
    const res = await agent
      .post('/api/shorten')
      .set('Origin', 'http://localhost:5173')
      .set('X-CSRF-Token', csrfRes.body.csrfToken as string)
      .set('X-Forwarded-For', ip)
      .send({ url: 'https://example.com', ttl: '24h' });

    expect(res.status).toBe(201);
  });

  it('rejects prefix-matching origins that are not the frontend origin even with a CSRF token', async () => {
    const agent = request.agent(app);
    const csrfRes = await agent.get('/auth/csrf-token').set('X-Forwarded-For', '10.99.5.3');
    const res = await agent
      .post('/api/shorten')
      .set('Origin', 'http://localhost:5173.evil.test')
      .set('X-CSRF-Token', csrfRes.body.csrfToken as string)
      .send({ url: 'https://example.com', ttl: '24h' });

    expect(res.status).toBe(403);
  });

  it('bypasses CSRF for Bearer (API key) authenticated requests', async () => {
    makeAdminUser();
    const res = await request(app).post('/api/shorten').set('Authorization', 'Bearer admin-api-key-test').send({ url: 'https://example.com', ttl: '24h' });
    expect(res.status).toBe(201);
  });
});

describe('GET /api/openapi.json', () => {
  it('returns 200 with valid OpenAPI spec', async () => {
    const res = await request(app).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('openapi');
    expect(res.body).toHaveProperty('paths');
  });

  it('uses PUBLIC_API_ORIGIN for the served server URL', async () => {
    const res = await request(app).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.servers).toEqual([
      {
        url: 'https://leaflet.lair.nntin.xyz',
        description: 'Configured API server',
      },
    ]);
  });
});
