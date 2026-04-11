/**
 * Integration tests for the Leaflet backend.
 *
 * The database pool is mocked so tests run without a real PostgreSQL instance.
 */

import request from 'supertest';
import path from 'path';
import crypto from 'crypto';
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

interface OAuthClientRecord {
  id: string;
  user_id: number | null;
  name: string;
  client_id: string;
  client_secret: string | null;
  is_public: boolean;
  redirect_uris: string[];
  scopes: string[];
  created_at: Date;
  revoked_at: Date | null;
}

interface OAuthCodeRecord {
  id: string;
  code: string;
  client_id: string;
  user_id: number;
  redirect_uri: string;
  scopes: string[];
  code_challenge: string | null;
  code_challenge_method: string;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
}

interface OAuthAccessTokenRecord {
  id: string;
  token_hash: string;
  client_id: string;
  user_id: number;
  scopes: string[];
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

interface OAuthRefreshTokenRecord {
  id: string;
  token_hash: string;
  access_token_id: string | null;
  client_id: string;
  user_id: number;
  scopes: string[];
  expires_at: Date;
  rotated_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

const db = {
  urls: [] as UrlRecord[],
  users: [] as UserRecord[],
  nextUrlId: 1,
  nextUserId: 1,
  oauthClients: [] as OAuthClientRecord[],
  oauthCodes: [] as OAuthCodeRecord[],
  oauthAccessTokens: [] as OAuthAccessTokenRecord[],
  oauthRefreshTokens: [] as OAuthRefreshTokenRecord[],
};

function nextUuid(): string {
  return crypto.randomUUID();
}

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

      // OAuth: oauth_clients
      if (s.startsWith('select * from oauth_clients where client_id')) {
        const [clientId] = params as [string];
        return { rows: db.oauthClients.filter(c => c.client_id === clientId && c.revoked_at === null) };
      }

      if (s.startsWith('insert into oauth_clients')) {
        const [userId, name, clientId, clientSecret, isPublic, redirectUris, scopes] =
          params as [number | null, string, string, string | null, boolean, string[], string[]];
        const row: OAuthClientRecord = {
          id: nextUuid(), user_id: userId, name, client_id: clientId,
          client_secret: clientSecret, is_public: isPublic,
          redirect_uris: redirectUris, scopes, created_at: new Date(), revoked_at: null,
        };
        db.oauthClients.push(row);
        return { rows: [row] };
      }

      if (s.startsWith('update oauth_clients set revoked_at')) {
        const [clientId] = params as [string];
        const c = db.oauthClients.find(c => c.client_id === clientId);
        if (c) c.revoked_at = new Date();
        return { rows: [] };
      }

      // OAuth: oauth_authorization_codes
      if (s.startsWith('insert into oauth_authorization_codes')) {
        const [code, clientId, userId, redirectUri, scopes, codeChallenge, codeChallengeMethod, expiresAt] =
          params as [string, string, number, string, string[], string | null, string, Date];
        db.oauthCodes.push({
          id: nextUuid(), code, client_id: clientId, user_id: userId, redirect_uri: redirectUri,
          scopes, code_challenge: codeChallenge, code_challenge_method: codeChallengeMethod,
          expires_at: expiresAt, used_at: null, created_at: new Date(),
        });
        return { rows: [] };
      }

      if (s.startsWith('update oauth_authorization_codes set used_at')) {
        const [code] = params as [string];
        const now = new Date();
        const existing = db.oauthCodes.find(c => c.code === code && c.used_at === null && c.expires_at > now);
        if (!existing) return { rows: [] };
        existing.used_at = now;
        return { rows: [existing] };
      }

      // OAuth: oauth_access_tokens
      if (s.startsWith('insert into oauth_access_tokens')) {
        const [tokenHash, clientId, userId, scopes, expiresAt] =
          params as [string, string, number, string[], Date];
        const row: OAuthAccessTokenRecord = {
          id: nextUuid(), token_hash: tokenHash, client_id: clientId, user_id: userId,
          scopes, expires_at: expiresAt, revoked_at: null, created_at: new Date(),
        };
        db.oauthAccessTokens.push(row);
        return { rows: [{ id: row.id }] };
      }

      if (s.startsWith('select t.user_id, t.client_id, t.scopes from oauth_access_tokens')) {
        const [tokenHash] = params as [string];
        const now = new Date();
        const token = db.oauthAccessTokens.find(t => t.token_hash === tokenHash && t.revoked_at === null && t.expires_at > now);
        if (!token) return { rows: [] };
        return { rows: [{ user_id: token.user_id, client_id: token.client_id, scopes: token.scopes }] };
      }

      if (s.startsWith('update oauth_access_tokens set revoked_at') && s.includes('where token_hash')) {
        const [tokenHash, clientId] = params as [string, string];
        const t = db.oauthAccessTokens.find(t => t.token_hash === tokenHash && t.client_id === clientId);
        if (t) t.revoked_at = new Date();
        return { rows: [] };
      }

      if (s.includes('from oauth_access_tokens') && s.startsWith('update') && s.includes('where client_id')) {
        const [clientId] = params as [string];
        db.oauthAccessTokens.filter(t => t.client_id === clientId && t.revoked_at === null).forEach(t => { t.revoked_at = new Date(); });
        return { rows: [] };
      }

      // OAuth: oauth_refresh_tokens
      if (s.startsWith('insert into oauth_refresh_tokens')) {
        const [tokenHash, accessTokenId, clientId, userId, scopes, expiresAt] =
          params as [string, string | null, string, number, string[], Date];
        db.oauthRefreshTokens.push({
          id: nextUuid(), token_hash: tokenHash, access_token_id: accessTokenId,
          client_id: clientId, user_id: userId, scopes,
          expires_at: expiresAt, rotated_at: null, revoked_at: null, created_at: new Date(),
        });
        return { rows: [] };
      }

      // SELECT used in refresh_token grant (routes/oauth.ts)
      if (s.startsWith('select user_id, scopes from oauth_refresh_tokens')) {
        const [tokenHash, clientId] = params as [string, string];
        const now = new Date();
        const token = db.oauthRefreshTokens.find(
          (t) => t.token_hash === tokenHash && t.rotated_at === null &&
                 t.revoked_at === null && t.expires_at > now && t.client_id === clientId,
        );
        if (!token) return { rows: [] };
        return { rows: [{ user_id: token.user_id, scopes: token.scopes }] };
      }

      // UPDATE used in rotateRefreshToken (tokens.ts)
      if (s.startsWith('update oauth_refresh_tokens set rotated_at')) {
        const [tokenHash, clientId, userId] = params as [string, string, number];
        const now = new Date();
        const token = db.oauthRefreshTokens.find(
          (t) => t.token_hash === tokenHash && t.rotated_at === null &&
                 t.revoked_at === null && t.expires_at > now &&
                 t.client_id === clientId && t.user_id === userId,
        );
        if (!token) return { rows: [] };
        token.rotated_at = now;
        return { rows: [{ id: token.id }] };
      }

      if (s.startsWith('update oauth_refresh_tokens set revoked_at')) {
        const [tokenHash, clientId] = params as [string, string];
        const t = db.oauthRefreshTokens.find(t => t.token_hash === tokenHash && t.client_id === clientId);
        if (t) t.revoked_at = new Date();
        return { rows: [] };
      }

      // OAuth: oauth_consents
      if (s.startsWith('insert into oauth_consents')) {
        return { rows: [] };
      }

      if (s.includes('from oauth_consents') && s.startsWith('select')) {
        const [userId] = params as [number];
        return { rows: [] };
      }

      if (s.startsWith('update oauth_consents')) {
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

function makeOAuthClient(overrides: Partial<OAuthClientRecord> = {}): OAuthClientRecord {
  const client: OAuthClientRecord = {
    id: nextUuid(), user_id: null, name: 'Test App', client_id: 'test-client-id',
    client_secret: null, is_public: true, redirect_uris: ['http://localhost'],
    scopes: ['shorten:create', 'user:read'], created_at: new Date(), revoked_at: null,
    ...overrides,
  };
  db.oauthClients.push(client);
  return client;
}

beforeEach(() => {
  db.urls = [];
  db.users = [];
  db.nextUrlId = 1;
  db.nextUserId = 1;
  db.oauthClients = [];
  db.oauthCodes = [];
  db.oauthAccessTokens = [];
  db.oauthRefreshTokens = [];
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

  it('allows one request per anonymous session even when sessions share the same IP', async () => {
    const ip = '10.99.1.2';
    const body = { url: 'https://example.com', ttl: '24h' };

    const agentOne = request.agent(app);
    const csrfOne = (await agentOne.get('/auth/csrf-token').set('X-Forwarded-For', ip)).body.csrfToken as string;
    const first = await agentOne.post('/api/shorten').set('X-CSRF-Token', csrfOne).set('X-Forwarded-For', ip).send(body);
    expect(first.status).toBe(201);

    const agentTwo = request.agent(app);
    const csrfTwo = (await agentTwo.get('/auth/csrf-token').set('X-Forwarded-For', ip)).body.csrfToken as string;
    const second = await agentTwo.post('/api/shorten').set('X-CSRF-Token', csrfTwo).set('X-Forwarded-For', ip).send(body);
    expect(second.status).toBe(201);
  });

  it('applies an IP guardrail across multiple anonymous sessions from the same IP', async () => {
    const ip = '10.99.1.3';
    const body = { url: 'https://example.com', ttl: '24h' };

    for (let index = 0; index < 10; index += 1) {
      const agent = request.agent(app);
      const csrf = (await agent.get('/auth/csrf-token').set('X-Forwarded-For', ip)).body.csrfToken as string;
      const res = await agent.post('/api/shorten').set('X-CSRF-Token', csrf).set('X-Forwarded-For', ip).send(body);
      expect(res.status).toBe(201);
    }

    const overflowAgent = request.agent(app);
    const overflowCsrf = (await overflowAgent.get('/auth/csrf-token').set('X-Forwarded-For', ip)).body.csrfToken as string;
    const overflow = await overflowAgent.post('/api/shorten').set('X-CSRF-Token', overflowCsrf).set('X-Forwarded-For', ip).send(body);
    expect(overflow.status).toBe(429);
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

// ============================================================================
// OAuth 2.0 endpoint tests
// ============================================================================

describe('GET /oauth/authorize', () => {
  it('returns 400 when client_id is missing', async () => {
    const res = await request(app).get('/oauth/authorize?response_type=code&redirect_uri=http://localhost:3000/cb&scope=shorten:create');
    expect(res.status).toBe(400);
  });

  it('returns 400 for unknown client_id', async () => {
    const res = await request(app).get('/oauth/authorize?response_type=code&client_id=unknown&redirect_uri=http://localhost:3000/cb&scope=shorten:create');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_client');
  });

  it('returns 400 for invalid redirect_uri not in client allowlist', async () => {
    makeOAuthClient({ client_id: 'my-client', redirect_uris: ['https://example.com/cb'] });
    const res = await request(app).get(
      '/oauth/authorize?response_type=code&client_id=my-client&redirect_uri=https://evil.com/cb&scope=shorten:create',
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });
});

describe('POST /oauth/token', () => {
  it('returns invalid_request for missing grant_type', async () => {
    const res = await request(app)
      .post('/oauth/token')
      .type('form')
      .send({ client_id: 'test-client' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('returns invalid_client for unknown client', async () => {
    const res = await request(app)
      .post('/oauth/token')
      .type('form')
      .send({ grant_type: 'authorization_code', client_id: 'does-not-exist', code: 'abc', redirect_uri: 'http://localhost:3000/cb' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_client');
  });

  it('returns invalid_grant for unknown code', async () => {
    makeOAuthClient({ client_id: 'pub-client', is_public: true });
    const res = await request(app)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        client_id: 'pub-client',
        code: 'nonexistent-code',
        redirect_uri: 'http://localhost:9999/cb',
        code_verifier: 'dummyverifier',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('exchanges a valid authorization code for tokens (public client with PKCE)', async () => {
    const user = makeRegularUser();
    makeOAuthClient({ client_id: 'pub-client', is_public: true });

    const codeVerifier = 'averylongcodeverifierstring_thatisatleast43characters';
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    const redirectUri = 'http://localhost:9999/cb';

    db.oauthCodes.push({
      id: nextUuid(),
      code: 'valid-code-123',
      client_id: 'pub-client',
      user_id: user.id,
      redirect_uri: redirectUri,
      scopes: ['shorten:create'],
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      expires_at: new Date(Date.now() + 10 * 60 * 1000),
      used_at: null,
      created_at: new Date(),
    });

    const res = await request(app)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        client_id: 'pub-client',
        code: 'valid-code-123',
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('access_token');
    expect(res.body).toHaveProperty('refresh_token');
    expect(res.body.token_type).toBe('Bearer');
    expect(res.body.expires_in).toBe(900);
    expect(res.body.scope).toBe('shorten:create');
  });

  it('rejects replay of an already-used authorization code', async () => {
    const user = makeRegularUser();
    makeOAuthClient({ client_id: 'pub-client', is_public: true });

    const codeVerifier = 'averylongcodeverifierstring_thatisatleast43characters';
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    const redirectUri = 'http://localhost:9999/cb';

    db.oauthCodes.push({
      id: nextUuid(),
      code: 'one-time-code',
      client_id: 'pub-client',
      user_id: user.id,
      redirect_uri: redirectUri,
      scopes: ['shorten:create'],
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      expires_at: new Date(Date.now() + 10 * 60 * 1000),
      used_at: null,
      created_at: new Date(),
    });

    await request(app)
      .post('/oauth/token')
      .type('form')
      .send({ grant_type: 'authorization_code', client_id: 'pub-client', code: 'one-time-code', redirect_uri: redirectUri, code_verifier: codeVerifier });

    const replay = await request(app)
      .post('/oauth/token')
      .type('form')
      .send({ grant_type: 'authorization_code', client_id: 'pub-client', code: 'one-time-code', redirect_uri: redirectUri, code_verifier: codeVerifier });

    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe('invalid_grant');
  });

  it('returns invalid_grant for wrong PKCE code_verifier', async () => {
    const user = makeRegularUser();
    makeOAuthClient({ client_id: 'pub-client', is_public: true });

    const codeVerifier = 'correctverifier_thatisatleast43characterslong____';
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    db.oauthCodes.push({
      id: nextUuid(),
      code: 'pkce-code',
      client_id: 'pub-client',
      user_id: user.id,
      redirect_uri: 'http://localhost:9999/cb',
      scopes: ['shorten:create'],
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      expires_at: new Date(Date.now() + 10 * 60 * 1000),
      used_at: null,
      created_at: new Date(),
    });

    const res = await request(app)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        client_id: 'pub-client',
        code: 'pkce-code',
        redirect_uri: 'http://localhost:9999/cb',
        code_verifier: 'wrong-verifier-that-does-not-match-at-all-!!!',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('successfully refreshes an access token and rotates the refresh token', async () => {
    const user = makeRegularUser();
    makeOAuthClient({ client_id: 'pub-client', is_public: true });

    const rawRefreshToken = 'raw-refresh-token-for-rotation-test';
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

    db.oauthRefreshTokens.push({
      id: nextUuid(),
      token_hash: tokenHash,
      access_token_id: null,
      client_id: 'pub-client',
      user_id: user.id,
      scopes: ['shorten:create'],
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      rotated_at: null,
      revoked_at: null,
      created_at: new Date(),
    });

    const res = await request(app)
      .post('/oauth/token')
      .type('form')
      .send({ grant_type: 'refresh_token', client_id: 'pub-client', refresh_token: rawRefreshToken });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('access_token');
    expect(res.body).toHaveProperty('refresh_token');
    expect(res.body.token_type).toBe('Bearer');
    expect(res.body.expires_in).toBe(900);
    expect(res.body.scope).toBe('shorten:create');

    // The old refresh token should be marked as rotated (single-use).
    const oldToken = db.oauthRefreshTokens.find((t) => t.token_hash === tokenHash);
    expect(oldToken?.rotated_at).not.toBeNull();
  });

  it('rejects replay of an already-rotated refresh token', async () => {
    const user = makeRegularUser();
    makeOAuthClient({ client_id: 'pub-client', is_public: true });

    const rawRefreshToken = 'raw-refresh-token-for-replay-test';
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

    db.oauthRefreshTokens.push({
      id: nextUuid(),
      token_hash: tokenHash,
      access_token_id: null,
      client_id: 'pub-client',
      user_id: user.id,
      scopes: ['shorten:create'],
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      rotated_at: null,
      revoked_at: null,
      created_at: new Date(),
    });

    // First use — should succeed and rotate.
    await request(app)
      .post('/oauth/token')
      .type('form')
      .send({ grant_type: 'refresh_token', client_id: 'pub-client', refresh_token: rawRefreshToken });

    // Replay of same refresh token — must be rejected.
    const replay = await request(app)
      .post('/oauth/token')
      .type('form')
      .send({ grant_type: 'refresh_token', client_id: 'pub-client', refresh_token: rawRefreshToken });

    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe('invalid_grant');
  });
});

describe('POST /oauth/revoke', () => {
  it('returns 200 even for unknown token (RFC 7009)', async () => {
    makeOAuthClient({ client_id: 'pub-client', is_public: true });
    const res = await request(app)
      .post('/oauth/revoke')
      .type('form')
      .send({ token: 'does-not-exist', client_id: 'pub-client' });
    expect(res.status).toBe(200);
  });

  it('returns 200 when missing required fields', async () => {
    const res = await request(app).post('/oauth/revoke').type('form').send({ token: 'x' });
    expect(res.status).toBe(200);
  });

  it('bypasses CSRF for revocation endpoint', async () => {
    makeOAuthClient({ client_id: 'pub-client', is_public: true });
    const res = await request(app)
      .post('/oauth/revoke')
      .set('Origin', 'http://localhost:5173')
      .type('form')
      .send({ token: 'sometoken', client_id: 'pub-client' });
    expect(res.status).toBe(200);
  });
});

describe('OAuth Bearer token authentication', () => {
  it('allows API shorten with a valid OAuth access token', async () => {
    const user = makeRegularUser();
    makeOAuthClient({ client_id: 'pub-client', is_public: true });

    const rawToken = 'raw-access-token-for-test';
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    db.oauthAccessTokens.push({
      id: nextUuid(),
      token_hash: tokenHash,
      client_id: 'pub-client',
      user_id: user.id,
      scopes: ['shorten:create'],
      expires_at: new Date(Date.now() + 15 * 60 * 1000),
      revoked_at: null,
      created_at: new Date(),
    });

    const res = await request(app)
      .post('/api/shorten')
      .set('Authorization', `Bearer ${rawToken}`)
      .send({ url: 'https://example.com', ttl: '24h' });

    expect(res.status).toBe(201);
  });

  it('falls back to API key auth when OAuth token lookup returns no rows', async () => {
    makeAdminUser();
    // admin-api-key-test is a legacy API key, not in oauth_access_tokens.
    const res = await request(app)
      .post('/api/shorten')
      .set('Authorization', 'Bearer admin-api-key-test')
      .send({ url: 'https://example.com', ttl: 'never' });
    expect(res.status).toBe(201);
  });
});

describe('GET /oauth/apps', () => {
  it('returns 401 without authentication', async () => {
    const res = await request(app).get('/oauth/apps');
    expect(res.status).toBe(401);
  });

  it('returns empty array when user has no consented apps', async () => {
    makeAdminUser();
    const res = await request(app)
      .get('/oauth/apps')
      .set('Authorization', 'Bearer admin-api-key-test');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /oauth/apps', () => {
  it('returns 401 without authentication', async () => {
    const res = await request(app)
      .post('/oauth/apps')
      .send({ name: 'Test', redirectUris: ['https://example.com/cb'], scopes: ['shorten:create'], isPublic: false });
    expect(res.status).toBe(401);
  });

  it('registers a new confidential client for authenticated user', async () => {
    makeAdminUser();
    const res = await request(app)
      .post('/oauth/apps')
      .set('Authorization', 'Bearer admin-api-key-test')
      .send({
        name: 'My Integration',
        redirectUris: ['https://myapp.com/callback'],
        scopes: ['shorten:create'],
        isPublic: false,
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('clientId');
    expect(res.body).toHaveProperty('clientSecret');
    expect(res.body.clientSecret).not.toBeNull();
    expect(res.body.isPublic).toBe(false);
  });

  it('registers a new public client without a clientSecret', async () => {
    makeAdminUser();
    const res = await request(app)
      .post('/oauth/apps')
      .set('Authorization', 'Bearer admin-api-key-test')
      .send({
        name: 'My SPA',
        redirectUris: ['https://myapp.com/callback'],
        scopes: ['shorten:create', 'user:read'],
        isPublic: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.clientSecret).toBeNull();
    expect(res.body.isPublic).toBe(true);
  });

  it('returns 400 for invalid scope', async () => {
    makeAdminUser();
    const res = await request(app)
      .post('/oauth/apps')
      .set('Authorization', 'Bearer admin-api-key-test')
      .send({
        name: 'Bad App',
        redirectUris: ['https://myapp.com/callback'],
        scopes: ['invalid:scope'],
        isPublic: false,
      });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /oauth/apps/:clientId', () => {
  it('returns 401 without authentication', async () => {
    makeOAuthClient({ client_id: 'some-client' });
    const res = await request(app).delete('/oauth/apps/some-client');
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown client', async () => {
    makeAdminUser();
    const res = await request(app)
      .delete('/oauth/apps/unknown-client-xyz')
      .set('Authorization', 'Bearer admin-api-key-test');
    expect(res.status).toBe(404);
  });

  it('allows owner to revoke own client', async () => {
    const user = makeAdminUser();
    makeOAuthClient({ client_id: 'owner-client', user_id: user.id });
    const res = await request(app)
      .delete('/oauth/apps/owner-client')
      .set('Authorization', 'Bearer admin-api-key-test');
    expect(res.status).toBe(200);
  });

  it('prevents non-owner non-admin from revoking another users client', async () => {
    const owner = makeRegularUser();
    makeOAuthClient({ client_id: 'owned-client', user_id: owner.id });
    const attacker: UserRecord = { id: db.nextUserId++, github_id: 'attacker-gh', username: 'attacker', role: 'user', created_at: new Date(), api_key: 'attacker-key' };
    db.users.push(attacker);
    const res = await request(app)
      .delete('/oauth/apps/owned-client')
      .set('Authorization', 'Bearer attacker-key');
    expect(res.status).toBe(403);
  });
});

describe('OAuth token endpoint bypasses CSRF', () => {
  it('POST /oauth/token is not blocked by CSRF (returns non-403)', async () => {
    const res = await request(app)
      .post('/oauth/token')
      .set('Origin', 'http://localhost:5173')
      .type('form')
      .send({ grant_type: 'authorization_code', client_id: 'x' });
    expect(res.status).not.toBe(403);
  });
});
