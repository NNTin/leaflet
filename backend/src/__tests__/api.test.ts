/**
 * Integration tests for the Leaflet backend.
 *
 * The database pool is mocked so tests run without a real PostgreSQL instance.
 */

import request from 'supertest';
import crypto from 'crypto';
import baseSpec from '../openapi';
import { REGISTERED_PROVIDERS } from '../providers/registry';

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
  github_id?: string | null;
  username: string;
  role: string;
  created_at: Date;
}

interface IdentityRecord {
  id: number;
  user_id: number;
  provider: string;
  provider_user_id: string;
  display_name: string | null;
  email: string | null;
  email_verified: boolean;
  created_at: Date;
  updated_at: Date;
}

interface MergeLogRecord {
  id: number;
  surviving_user_id: number;
  merged_user_id: number;
  initiated_by: number | null;
  merged_at: Date;
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
  userIdentities: [] as IdentityRecord[],
  mergeLogs: [] as MergeLogRecord[],
  nextIdentityId: 1,
  nextMergeLogId: 1,
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
        const row: UserRecord = { id: db.nextUserId++, github_id, username, role, created_at: new Date() };
        db.users.push(row);
        return { rows: [row] };
      }

      if (s.startsWith('select * from users where id')) {
        const [id] = params as [number];
        return { rows: db.users.filter(u => u.id === Number(id)) };
      }

      if (s.startsWith('select 1 from users where id')) {
        const [id] = params as [number];
        const found = db.users.find(u => u.id === Number(id));
        return { rows: found ? [{ 1: 1 }] : [] };
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

      // OAuth: oauth_clients
      if (s.startsWith('select * from oauth_clients where client_id')) {
        const [clientId] = params as [string];
        return { rows: db.oauthClients.filter(c => c.client_id === clientId && c.revoked_at === null) };
      }

      if (s.startsWith('select 1 from oauth_clients where client_id')) {
        const [clientId] = params as [string];
        const rows = db.oauthClients.filter(c => c.client_id === clientId && c.revoked_at === null);
        return { rows: rows.length > 0 ? [{ 1: 1 }] : [] };
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
        return { rows: [] };
      }

      if (s.startsWith('update oauth_consents')) {
        return { rows: [] };
      }

      // user_identities: upsert
      if (s.startsWith('insert into user_identities')) {
        const [userId, provider, providerUserId, displayName, email, emailVerified] =
          params as [number, string, string, string | null, string | null, boolean];
        const existing = db.userIdentities.find(
          (i) => i.user_id === userId && i.provider === provider,
        );
        if (existing) {
          existing.provider_user_id = providerUserId;
          existing.display_name = displayName;
          existing.email = email;
          existing.email_verified = emailVerified;
          existing.updated_at = new Date();
          return { rows: [existing] };
        }
        const row: IdentityRecord = {
          id: db.nextIdentityId++,
          user_id: userId,
          provider,
          provider_user_id: providerUserId,
          display_name: displayName,
          email,
          email_verified: emailVerified,
          created_at: new Date(),
          updated_at: new Date(),
        };
        db.userIdentities.push(row);
        return { rows: [row] };
      }

      // user_identities: find by provider + provider_user_id
      if (
        s.startsWith('select * from user_identities where provider') ||
        (s.includes('from user_identities') && s.includes('provider_user_id'))
      ) {
        const [provider, providerUserId] = params as [string, string];
        return {
          rows: db.userIdentities.filter(
            (i) => i.provider === provider && i.provider_user_id === providerUserId,
          ),
        };
      }

      // user_identities: list by user_id
      if (s.startsWith('select * from user_identities where user_id')) {
        const [userId] = params as [number];
        const rows = db.userIdentities
          .filter((i) => i.user_id === userId)
          .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
        return { rows };
      }

      // user_identities: count by user_id
      if (s.startsWith('select count') && s.includes('from user_identities where user_id')) {
        const [userId] = params as [number];
        const count = db.userIdentities.filter((i) => i.user_id === userId).length;
        return { rows: [{ count: String(count) }] };
      }

      // user_identities: delete duplicate providers before merge (specific check MUST come first)
      if (s.startsWith('delete from user_identities') && s.includes('and provider in')) {
        const [survivingId, mergedId] = params as [number, number];
        const survivorProviders = new Set(
          db.userIdentities.filter((i) => i.user_id === survivingId).map((i) => i.provider),
        );
        db.userIdentities = db.userIdentities.filter(
          (i) => !(i.user_id === mergedId && survivorProviders.has(i.provider)),
        );
        return { rowCount: 0, rows: [] };
      }

      // user_identities: disconnect (generic delete by user_id + provider)
      if (s.startsWith('delete from user_identities')) {
        const [userId, provider] = params as [number, string];
        const idx = db.userIdentities.findIndex(
          (i) => i.user_id === userId && i.provider === provider,
        );
        if (idx === -1) return { rowCount: 0, rows: [] };
        db.userIdentities.splice(idx, 1);
        return { rowCount: 1, rows: [] };
      }

      // user_identities: move on merge (UPDATE user_identities SET user_id = $1 WHERE user_id = $2)
      if (s.startsWith('update user_identities set user_id')) {
        const [survivingId, mergedId] = params as [number, number];
        db.userIdentities.forEach((i) => {
          if (i.user_id === mergedId) i.user_id = survivingId;
        });
        return { rows: [] };
      }

      // oauth_consents: delete duplicates before merge
      if (s.startsWith('delete from oauth_consents') && s.includes('and client_id in')) {
        return { rows: [] };
      }

      // oauth_consents: update user_id on merge
      if (s.startsWith('update oauth_consents set user_id')) {
        return { rows: [] };
      }

      // urls: move on merge (UPDATE urls SET user_id = $1 WHERE user_id = $2)
      if (s.startsWith('update urls set user_id')) {
        const [survivingId, mergedId] = params as [number, number];
        db.urls.forEach((u) => {
          if (u.user_id === mergedId) u.user_id = survivingId;
        });
        return { rows: [] };
      }

      // oauth_clients: move on merge
      if (s.startsWith('update oauth_clients set user_id')) {
        const [survivingId, mergedId] = params as [number, number];
        db.oauthClients.forEach((c) => {
          if (c.user_id === mergedId) c.user_id = survivingId;
        });
        return { rows: [] };
      }

      // users: new-style insert (username, role) without github_id
      if (s.startsWith('insert into users (username, role)') || s.startsWith('insert into users(username, role)')) {
        const [username, role] = params as [string, string];
        const row: UserRecord = { id: db.nextUserId++, username, role, created_at: new Date() };
        db.users.push(row);
        return { rows: [row] };
      }

      // users: select by id for identity-based lookups
      if (s.startsWith('select id, username, role, created_at from users where id')) {
        const [id] = params as [number];
        return { rows: db.users.filter((u) => u.id === Number(id)).map(({ id, username, role, created_at }) => ({ id, username, role, created_at })) };
      }

      // users: role resolution update for merge
      if (s.startsWith('update users set role = (')) {
        const [survivingId, mergedId] = params as [number, number];
        const s1 = db.users.find((u) => u.id === survivingId);
        const s2 = db.users.find((u) => u.id === mergedId);
        if (s1 && s2) {
          if (s1.role === 'admin' || s2.role === 'admin') {
            s1.role = 'admin';
          } else if (s1.role === 'privileged' || s2.role === 'privileged') {
            s1.role = 'privileged';
          }
        }
        return { rows: [] };
      }

      // users: update role to admin (from provider registry)
      if (s.startsWith("update users set role = 'admin' where id")) {
        const [id] = params as [number];
        const u = db.users.find((u) => u.id === id);
        if (u) u.role = 'admin';
        return { rows: [] };
      }

      // users: delete on merge
      if (s.startsWith('delete from users where id')) {
        const [id] = params as [number];
        const idx = db.users.findIndex((u) => u.id === Number(id));
        if (idx !== -1) db.users.splice(idx, 1);
        return { rows: [] };
      }

      // account_merge_log: insert
      if (s.startsWith('insert into account_merge_log')) {
        const [survivingUserId, mergedUserId, initiatedBy] = params as [number, number, number | null];
        const row: MergeLogRecord = {
          id: db.nextMergeLogId++,
          surviving_user_id: survivingUserId,
          merged_user_id: mergedUserId,
          initiated_by: initiatedBy,
          merged_at: new Date(),
        };
        db.mergeLogs.push(row);
        return { rows: [row] };
      }

      return { rows: [] };
    }),
    connect: jest.fn(async () => {
      // Return a mock pool client for the merge transaction route.
      // Delegates to the same query mock so db state changes are reflected.
      const mockClient = {
        query: jest.fn(async (sql: string, params: unknown[] = []) => {
          const s = sql.replace(/\s+/g, ' ').trim().toLowerCase();
          // Ignore transaction control statements.
          if (s === 'begin' || s === 'commit' || s === 'rollback') return { rows: [] };
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const pool = require('../db') as { query: jest.Mock };
          return pool.query(sql, params);
        }),
        release: jest.fn(),
      };
      return mockClient;
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

const { validateOAuthReturnTo } = require('../config') as {
  validateOAuthReturnTo: (rawReturnTo: string | undefined) => string | null;
};

import app, { sessionStore } from '../app';

function makeAdminUser(): UserRecord {
  const user: UserRecord = { id: db.nextUserId++, github_id: 'admin-gh', username: 'adminuser', role: 'admin', created_at: new Date() };
  db.users.push(user);
  return user;
}

function makePrivilegedUser(): UserRecord {
  const user: UserRecord = { id: db.nextUserId++, github_id: 'priv-gh', username: 'privuser', role: 'privileged', created_at: new Date() };
  db.users.push(user);
  return user;
}

function makeRegularUser(): UserRecord {
  const user: UserRecord = { id: db.nextUserId++, github_id: 'user-gh', username: 'regularuser', role: 'user', created_at: new Date() };
  db.users.push(user);
  return user;
}

function makeOAuthClient(overrides: Partial<OAuthClientRecord> = {}): OAuthClientRecord {
  const client: OAuthClientRecord = {
    id: nextUuid(), user_id: null, name: 'Test App', client_id: 'test-client-id',
    client_secret: null, is_public: true, redirect_uris: ['http://localhost'],
    scopes: [
      'shorten:create',
      'shorten:create:never',
      'shorten:create:alias',
      'urls:read',
      'urls:delete',
      'users:read',
      'users:write',
      'user:read',
      'oauth:apps:read',
      'oauth:apps:write',
      'admin:*',
    ],
    created_at: new Date(),
    revoked_at: null,
    ...overrides,
  };
  db.oauthClients.push(client);
  return client;
}

function issueAccessToken(user: UserRecord, scopes: string[], overrides: Partial<OAuthAccessTokenRecord> = {}): string {
  const rawToken = `token-${nextUuid()}`;
  db.oauthAccessTokens.push({
    id: nextUuid(),
    token_hash: crypto.createHash('sha256').update(rawToken).digest('hex'),
    client_id: 'test-client-id',
    user_id: user.id,
    scopes,
    expires_at: new Date(Date.now() + 15 * 60 * 1000),
    revoked_at: null,
    created_at: new Date(),
    ...overrides,
  });
  return rawToken;
}

type MemorySessionStore = {
  all: (callback: (err: Error | null, sessions?: Record<string, Record<string, unknown>>) => void) => void;
  clear: (callback: (err?: Error | null) => void) => void;
  set: (sid: string, session: Record<string, unknown>, callback: (err?: Error | null) => void) => void;
};

async function clearTestSessions(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    (sessionStore as unknown as MemorySessionStore).clear((err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });
}

async function createAuthenticatedSession(user: UserRecord, ip = '10.99.99.1'): Promise<{
  agent: ReturnType<typeof request.agent>;
  csrfToken: string;
}> {
  const agent = request.agent(app);
  const csrfRes = await agent.get('/auth/csrf-token').set('X-Forwarded-For', ip);
  const csrfToken = csrfRes.body.csrfToken as string;

  const sessions = await new Promise<Record<string, Record<string, unknown>>>((resolve, reject) => {
    (sessionStore as unknown as MemorySessionStore).all((err, currentSessions) => {
      if (err || !currentSessions) {
        reject(err ?? new Error('No sessions found.'));
        return;
      }

      resolve(currentSessions);
    });
  });

  const entry = Object.entries(sessions).find(([, session]) => session.csrfToken === csrfToken);
  if (!entry) {
    throw new Error('Could not locate test session in store.');
  }

  const [sid, session] = entry;
  await new Promise<void>((resolve, reject) => {
    (sessionStore as unknown as MemorySessionStore).set(
      sid,
      { ...session, passport: { user: user.id } },
      (err) => {
        if (err) {
          reject(err);
          return;
        }

        resolve();
      },
    );
  });

  return { agent, csrfToken };
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
  db.userIdentities = [];
  db.mergeLogs = [];
  db.nextIdentityId = 1;
  db.nextMergeLogId = 1;
  jest.clearAllMocks();
});

beforeEach(async () => {
  await clearTestSessions();
});

describe('OpenAPI TTL enum contract', () => {
  it('has enum values matching backend TTL_MAP keys', () => {
    const ttlEnum = (
      baseSpec.paths['/api/shorten'].post as {
        requestBody: { content: { 'application/json': { schema: { properties: { ttl: { enum: string[] } } } } } };
      }
    ).requestBody.content['application/json'].schema.properties.ttl.enum;
    expect(ttlEnum.sort()).toEqual(['24h', '1h', '5m', 'never'].sort());
  });

  it('does not contain deprecated 60m value', () => {
    const ttlEnum = (
      baseSpec.paths['/api/shorten'].post as {
        requestBody: { content: { 'application/json': { schema: { properties: { ttl: { enum: string[] } } } } } };
      }
    ).requestBody.content['application/json'].schema.properties.ttl.enum;
    expect(ttlEnum).not.toContain('60m');
  });

  it('documents provider callback error responses', () => {
    const callbackResponses = (
      baseSpec.paths['/auth/{provider}/callback'].get as { responses: Record<string, unknown> }
    ).responses;
    const appleCallbackResponses = (
      baseSpec.paths['/auth/apple/callback'].post as { responses: Record<string, unknown> }
    ).responses;

    expect(callbackResponses).toHaveProperty('400');
    expect(callbackResponses).toHaveProperty('405');
    expect(callbackResponses).toHaveProperty('503');
    expect(appleCallbackResponses).toHaveProperty('503');
  });

  it('documents the shorten capabilities endpoint', () => {
    const capabilities = (
      baseSpec.paths['/api/shorten/capabilities'].get as { responses: Record<string, unknown> }
    );

    expect(capabilities).toBeDefined();
    expect(capabilities.responses).toHaveProperty('200');
    expect(capabilities.responses).toHaveProperty('401');
    expect(capabilities.responses).toHaveProperty('429');
    expect((capabilities.responses['429'] as Record<string, unknown>)['$ref']).toBe('#/components/responses/TooManyRequests');
  });
});

describe('POST /api/shorten - anonymous rate limiting', () => {
  it('allows two requests then blocks the third (429) from the same anonymous session', async () => {
    const ip = '10.99.1.1';
    const agent = request.agent(app);
    const csrfRes = await agent.get('/auth/csrf-token').set('X-Forwarded-For', ip);
    const csrf = csrfRes.body.csrfToken as string;
    const body = { url: 'https://example.com', ttl: '24h' };

    const first = await agent.post('/api/shorten').set('X-CSRF-Token', csrf).set('X-Forwarded-For', ip).send(body);
    expect(first.status).toBe(201);

    const second = await agent.post('/api/shorten').set('X-CSRF-Token', csrf).set('X-Forwarded-For', ip).send(body);
    expect(second.status).toBe(201);

    const third = await agent.post('/api/shorten').set('X-CSRF-Token', csrf).set('X-Forwarded-For', ip).send(body);
    expect(third.status).toBe(429);
  });

  it('allows two requests per anonymous session even when sessions share the same IP', async () => {
    const ip = '10.99.1.2';
    const body = { url: 'https://example.com', ttl: '24h' };

    const agentOne = request.agent(app);
    const csrfOne = (await agentOne.get('/auth/csrf-token').set('X-Forwarded-For', ip)).body.csrfToken as string;
    const first = await agentOne.post('/api/shorten').set('X-CSRF-Token', csrfOne).set('X-Forwarded-For', ip).send(body);
    expect(first.status).toBe(201);
    const firstB = await agentOne.post('/api/shorten').set('X-CSRF-Token', csrfOne).set('X-Forwarded-For', ip).send(body);
    expect(firstB.status).toBe(201);

    const agentTwo = request.agent(app);
    const csrfTwo = (await agentTwo.get('/auth/csrf-token').set('X-Forwarded-For', ip)).body.csrfToken as string;
    const second = await agentTwo.post('/api/shorten').set('X-CSRF-Token', csrfTwo).set('X-Forwarded-For', ip).send(body);
    expect(second.status).toBe(201);
  });

  it('applies an IP guardrail across multiple anonymous sessions from the same IP', async () => {
    const ip = '10.99.1.3';
    const body = { url: 'https://example.com', ttl: '24h' };

    for (let index = 0; index < 20; index += 1) {
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
  it('returns 302 to original URL for active short code (no Accept header)', async () => {
    db.urls.push({ id: 1, short_code: 'active1', original_url: 'https://example.com', expires_at: new Date(Date.now() + 86400000), is_custom: false, user_id: null, created_at: new Date() });
    const res = await request(app).get('/s/active1').redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.com');
  });

  it('returns 302 to original URL for active short code (browser Accept header)', async () => {
    db.urls.push({ id: 2, short_code: 'active2', original_url: 'https://example.com', expires_at: new Date(Date.now() + 86400000), is_custom: false, user_id: null, created_at: new Date() });
    const res = await request(app).get('/s/active2').set('Accept', 'text/html,application/xhtml+xml,*/*').redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.com');
  });

  it('returns 404 JSON for expired short code when no Accept header (machine caller)', async () => {
    db.urls.push({ id: 3, short_code: 'expired1', original_url: 'https://example.com', expires_at: new Date(Date.now() - 1000), is_custom: false, user_id: null, created_at: new Date() });
    const res = await request(app).get('/s/expired1');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 404 JSON for expired short code when Accept is application/json', async () => {
    db.urls.push({ id: 4, short_code: 'expired2', original_url: 'https://example.com', expires_at: new Date(Date.now() - 1000), is_custom: false, user_id: null, created_at: new Date() });
    const res = await request(app).get('/s/expired2').set('Accept', 'application/json');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('redirects browser to /expired when expired short code and Accept includes text/html', async () => {
    db.urls.push({ id: 5, short_code: 'expired3', original_url: 'https://example.com', expires_at: new Date(Date.now() - 1000), is_custom: false, user_id: null, created_at: new Date() });
    const res = await request(app).get('/s/expired3').set('Accept', 'text/html,*/*').redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/expired');
  });

  it('redirects browser to /expired when nonexistent short code and Accept includes text/html', async () => {
    const res = await request(app).get('/s/doesnotexist').set('Accept', 'text/html').redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/expired');
  });

  it('returns 404 JSON for nonexistent short code with no Accept header', async () => {
    const res = await request(app).get('/s/doesnotexist');
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

  it('returns 403 when OAuth scope is missing for shorten requests', async () => {
    const user = makeRegularUser();
    const token = issueAccessToken(user, ['user:read']);
    const res = await request(app).post('/api/shorten').set('Authorization', `Bearer ${token}`).send({ url: 'https://example.com', ttl: '24h' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Insufficient scope.');
    expect(res.body.hint).toMatch(/shorten:create/);
  });

  it('forbids alias for regular user via OAuth token even when the alias scope is present', async () => {
    const user = makeRegularUser();
    const token = issueAccessToken(user, ['shorten:create', 'shorten:create:alias']);
    const res = await request(app).post('/api/shorten').set('Authorization', `Bearer ${token}`).send({ url: 'https://example.com', ttl: '24h', alias: 'my-alias' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Privileged account required for custom aliases.');
  });

  it('returns 403 when alias scope is missing for OAuth token requests', async () => {
    const user = makePrivilegedUser();
    const token = issueAccessToken(user, ['shorten:create']);
    const res = await request(app).post('/api/shorten').set('Authorization', `Bearer ${token}`).send({ url: 'https://example.com', ttl: '24h', alias: 'priv-alias' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Insufficient scope.');
    expect(res.body.hint).toMatch(/shorten:create:alias/);
  });

  it('allows alias for privileged user via OAuth token', async () => {
    const user = makePrivilegedUser();
    const token = issueAccessToken(user, ['shorten:create', 'shorten:create:alias']);
    const res = await request(app).post('/api/shorten').set('Authorization', `Bearer ${token}`).send({ url: 'https://example.com', ttl: '24h', alias: 'priv-alias' });
    expect(res.status).toBe(201);
    expect(res.body.shortCode).toBe('priv-alias');
  });

  it('allows alias for admin user via OAuth token', async () => {
    const user = makeAdminUser();
    const token = issueAccessToken(user, ['shorten:create', 'shorten:create:alias']);
    const res = await request(app).post('/api/shorten').set('Authorization', `Bearer ${token}`).send({ url: 'https://example.com', ttl: '24h', alias: 'admin-alias' });
    expect(res.status).toBe(201);
    expect(res.body.shortCode).toBe('admin-alias');
  });

  it('returns 409 for duplicate alias', async () => {
    const user = makePrivilegedUser();
    const token = issueAccessToken(user, ['shorten:create', 'shorten:create:alias']);
    db.urls.push({ id: 1, short_code: 'taken', original_url: 'https://other.com', expires_at: null, is_custom: true, user_id: null, created_at: new Date() });
    const res = await request(app).post('/api/shorten').set('Authorization', `Bearer ${token}`).send({ url: 'https://example.com', ttl: '24h', alias: 'taken' });
    expect(res.status).toBe(409);
  });

  it('forbids never-TTL for non-admin even when the scope is present', async () => {
    const user = makeRegularUser();
    const token = issueAccessToken(user, ['shorten:create', 'shorten:create:never']);
    const res = await request(app).post('/api/shorten').set('Authorization', `Bearer ${token}`).send({ url: 'https://example.com', ttl: 'never' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Admin access required to create links with no expiration.');
  });

  it('returns 403 when never-TTL scope is missing for admin OAuth requests', async () => {
    const user = makeAdminUser();
    const token = issueAccessToken(user, ['shorten:create']);
    const res = await request(app).post('/api/shorten').set('Authorization', `Bearer ${token}`).send({ url: 'https://example.com', ttl: 'never' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Insufficient scope.');
    expect(res.body.hint).toMatch(/shorten:create:never/);
  });

  it('allows never-TTL for admin with the required scope, resulting in null expiresAt', async () => {
    const user = makeAdminUser();
    const token = issueAccessToken(user, ['shorten:create', 'shorten:create:never']);
    const res = await request(app).post('/api/shorten').set('Authorization', `Bearer ${token}`).send({ url: 'https://example.com', ttl: 'never' });
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

  it('GET /admin/urls - rejects non-admin OAuth user with 403 even when the scope is present', async () => {
    const user = makeRegularUser();
    const token = issueAccessToken(user, ['urls:read']);
    const res = await request(app).get('/admin/urls').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Admin access required.');
  });

  it('GET /admin/urls - rejects admin OAuth user without the required scope', async () => {
    const user = makeAdminUser();
    const token = issueAccessToken(user, ['user:read']);
    const res = await request(app).get('/admin/urls').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Insufficient scope.');
    expect(res.body.hint).toMatch(/urls:read/);
  });

  it('GET /admin/urls - returns camelCase fields for admin OAuth requests with the required scope', async () => {
    const user = makeAdminUser();
    const token = issueAccessToken(user, ['urls:read']);
    db.urls.push({ id: 1, short_code: 'abc123', original_url: 'https://example.com', expires_at: null, is_custom: false, user_id: null, created_at: new Date() });
    const res = await request(app).get('/admin/urls').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const item = res.body[0] as Record<string, unknown>;
    expect(item).toHaveProperty('shortCode', 'abc123');
    expect(item).toHaveProperty('originalUrl');
    expect(item).toHaveProperty('createdAt');
    expect(item).not.toHaveProperty('short_code');
  });

  it('GET /admin/urls - allows admin browser sessions without OAuth scopes', async () => {
    const user = makeAdminUser();
    const { agent } = await createAuthenticatedSession(user, '10.99.6.1');
    db.urls.push({ id: 1, short_code: 'abc123', original_url: 'https://example.com', expires_at: null, is_custom: false, user_id: null, created_at: new Date() });

    const res = await agent.get('/admin/urls').set('X-Forwarded-For', '10.99.6.1');
    expect(res.status).toBe(200);
  });

  it('GET /admin/urls - keeps browser sessions role-gated', async () => {
    const user = makeRegularUser();
    const { agent } = await createAuthenticatedSession(user, '10.99.6.2');
    const res = await agent.get('/admin/urls').set('X-Forwarded-For', '10.99.6.2');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Admin access required.');
  });

  it('GET /admin/users - returns camelCase fields for admin', async () => {
    const admin = makeAdminUser();
    makeRegularUser();
    const token = issueAccessToken(admin, ['users:read']);
    const res = await request(app).get('/admin/users').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const user = (res.body as Record<string, unknown>[]).find(u => (u as { username: string }).username === 'regularuser');
    expect(user).toHaveProperty('createdAt');
    expect(user).not.toHaveProperty('created_at');
  });

  it('DELETE /admin/urls/:id - returns 404 for unknown id', async () => {
    const admin = makeAdminUser();
    const token = issueAccessToken(admin, ['urls:delete']);
    const res = await request(app).delete('/admin/urls/9999').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('PATCH /admin/users/:id/role - prevents admin self-demotion', async () => {
    const admin = makeAdminUser();
    const token = issueAccessToken(admin, ['users:write']);
    const res = await request(app).patch(`/admin/users/${admin.id}/role`).set('Authorization', `Bearer ${token}`).send({ role: 'user' });
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

  it('requires CSRF tokens for browser-session mutations', async () => {
    const admin = makeAdminUser();
    db.urls.push({ id: 1, short_code: 'delete-me', original_url: 'https://example.com', expires_at: null, is_custom: false, user_id: null, created_at: new Date() });

    const { agent, csrfToken } = await createAuthenticatedSession(admin, '10.99.5.4');

    const missingCsrf = await agent.delete('/admin/urls/1').set('X-Forwarded-For', '10.99.5.4');
    expect(missingCsrf.status).toBe(403);

    const allowed = await agent.delete('/admin/urls/1').set('X-CSRF-Token', csrfToken).set('X-Forwarded-For', '10.99.5.4');
    expect(allowed.status).toBe(200);
  });

  it('bypasses CSRF for OAuth Bearer authenticated requests', async () => {
    const user = makeRegularUser();
    const token = issueAccessToken(user, ['shorten:create']);
    const res = await request(app).post('/api/shorten').set('Authorization', `Bearer ${token}`).send({ url: 'https://example.com', ttl: '24h' });
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

  it('spec version is 3.0.3', async () => {
    const res = await request(app).get('/api/openapi.json');
    expect(res.body.openapi).toBe('3.0.3');
  });

  it('includes key route paths', async () => {
    const res = await request(app).get('/api/openapi.json');
    const paths: string[] = Object.keys(res.body.paths as Record<string, unknown>);
    expect(paths).toContain('/auth/me');
    expect(paths).toContain('/api/shorten');
    expect(paths).toContain('/api/urls');
    expect(paths).toContain('/admin/users');
    expect(paths).toContain('/admin/urls/{id}');
    expect(paths).toContain('/oauth/apps');
    expect(paths).toContain('/oauth/token');
    expect(paths).toContain('/s/{code}');
  });

  it('includes both security schemes', async () => {
    const res = await request(app).get('/api/openapi.json');
    const schemes: Record<string, unknown> = res.body.components.securitySchemes as Record<string, unknown>;
    expect(schemes).toHaveProperty('sessionCookie');
    expect(schemes).toHaveProperty('BearerAuth');
  });

  it('reflects the generated spec (openapi.ts is the source of truth)', async () => {
    const res = await request(app).get('/api/openapi.json');
    expect(res.body.info.title).toBe(baseSpec.info.title);
    expect(res.body.info.version).toBe(baseSpec.info.version);
    expect(Object.keys(res.body.paths as Record<string, unknown>).sort()).toEqual(
      Object.keys(baseSpec.paths).sort(),
    );
  });
});

// ============================================================================
// OAuth 2.0 endpoint tests
// ============================================================================

describe('GET /oauth/authorize', () => {
  it('redirects unauthenticated users to GitHub with an /oauth/authorize returnTo path', async () => {
    makeOAuthClient({
      client_id: 'leaflet-cli',
      is_public: true,
      redirect_uris: ['http://127.0.0.1'],
    });

    const res = await request(app).get(
      '/oauth/authorize?response_type=code&client_id=leaflet-cli&redirect_uri=http://127.0.0.1:43589/callback&scope=shorten:create&state=test-state&code_challenge=test-challenge&code_challenge_method=S256',
    );

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/auth/github?returnTo=');
    expect(decodeURIComponent(res.headers.location)).toContain('/oauth/authorize?response_type=code');
  });

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

describe('OAuth returnTo validation', () => {
  it('normalizes relative returnTo paths to the backend origin', () => {
    const resolved = validateOAuthReturnTo('/oauth/authorize?response_type=code');
    expect(resolved).toBe('https://leaflet.lair.nntin.xyz/oauth/authorize?response_type=code');
  });

  it('allows Pages returnTo URLs under /leafspots', () => {
    const resolved = validateOAuthReturnTo('https://nntin.xyz/leafspots/');
    expect(resolved).toBe('https://nntin.xyz/leafspots/');
  });

  it('rejects unrelated Pages returnTo paths', () => {
    expect(validateOAuthReturnTo('https://nntin.xyz/not-leafspots/')).toBeNull();
  });
});

describe('GET /api/shorten/capabilities', () => {
  it('returns anonymous shorten options and auth-read rate-limit headers', async () => {
    const res = await request(app).get('/api/shorten/capabilities').set('X-Forwarded-For', '10.99.1.40');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      authenticated: false,
      anonymous: true,
      role: null,
      shortenAllowed: true,
      aliasingAllowed: false,
      neverAllowed: false,
      ttlOptions: [
        { value: '5m', label: '5 minutes' },
        { value: '1h', label: '1 hour' },
        { value: '24h', label: '24 hours' },
      ],
    });

    expect(res.headers['ratelimit']).toBeDefined();
    expect(res.headers['ratelimit-policy']).toContain('auth-read-anonymous');
    expect(res.headers['ratelimit-policy']).not.toContain('shorten-anonymous');
  });

  it('returns role-based options for an authenticated browser session', async () => {
    const user = makePrivilegedUser();
    const { agent } = await createAuthenticatedSession(user, '10.99.1.41');

    const res = await agent.get('/api/shorten/capabilities').set('X-Forwarded-For', '10.99.1.41');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      authenticated: true,
      anonymous: false,
      role: 'privileged',
      shortenAllowed: true,
      aliasingAllowed: true,
      neverAllowed: false,
      ttlOptions: [
        { value: '5m', label: '5 minutes' },
        { value: '1h', label: '1 hour' },
        { value: '24h', label: '24 hours' },
      ],
    });
  });

  it('returns scope-aware options for OAuth callers', async () => {
    const admin = makeAdminUser();
    const token = issueAccessToken(admin, ['shorten:create']);

    const res = await request(app)
      .get('/api/shorten/capabilities')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', '10.99.1.42');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      authenticated: true,
      anonymous: false,
      role: 'admin',
      shortenAllowed: true,
      aliasingAllowed: false,
      neverAllowed: false,
      ttlOptions: [
        { value: '5m', label: '5 minutes' },
        { value: '1h', label: '1 hour' },
        { value: '24h', label: '24 hours' },
      ],
    });
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

  it('rejects unknown Bearer tokens without falling back to legacy API key auth', async () => {
    const res = await request(app)
      .post('/api/shorten')
      .set('Authorization', 'Bearer not-a-real-oauth-token')
      .send({ url: 'https://example.com', ttl: '24h' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid or expired bearer token.');
  });

  it('rejects expired OAuth access tokens with 401', async () => {
    const user = makeRegularUser();
    const token = issueAccessToken(user, ['shorten:create'], {
      expires_at: new Date(Date.now() - 1000),
    });

    const res = await request(app)
      .post('/api/shorten')
      .set('Authorization', `Bearer ${token}`)
      .send({ url: 'https://example.com', ttl: '24h' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid or expired bearer token.');
  });

  it('rejects revoked OAuth access tokens with 401', async () => {
    const user = makeRegularUser();
    const token = issueAccessToken(user, ['shorten:create'], {
      revoked_at: new Date(),
    });

    const res = await request(app)
      .post('/api/shorten')
      .set('Authorization', `Bearer ${token}`)
      .send({ url: 'https://example.com', ttl: '24h' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid or expired bearer token.');
  });
});

describe('GET /auth/me', () => {
  it('returns OAuth user info including granted scopes', async () => {
    const user = makeRegularUser();
    const token = issueAccessToken(user, ['user:read', 'shorten:create']);

    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('regularuser');
    expect(res.body.scopes).toEqual(['user:read', 'shorten:create']);
  });

  it('returns 403 with a scope hint when user:read is missing', async () => {
    const user = makeRegularUser();
    const token = issueAccessToken(user, ['shorten:create']);

    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Insufficient scope.');
    expect(res.body.hint).toMatch(/user:read/);
  });
});

describe('GET /auth/providers', () => {
  let originalProviders: typeof REGISTERED_PROVIDERS;

  beforeEach(() => {
    // Snapshot the current provider list so it can be restored after each test,
    // regardless of whether the developer has real provider credentials set.
    originalProviders = [...REGISTERED_PROVIDERS];
    REGISTERED_PROVIDERS.length = 0;
  });

  afterEach(() => {
    // Restore the REGISTERED_PROVIDERS array to its pre-test state.
    REGISTERED_PROVIDERS.length = 0;
    REGISTERED_PROVIDERS.push(...originalProviders);
  });

  it('returns an empty array when no providers are configured', async () => {
    const res = await request(app).get('/auth/providers');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns configured providers with name and label', async () => {
    REGISTERED_PROVIDERS.push('github', 'google');
    const res = await request(app).get('/auth/providers');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { name: 'github', label: 'GitHub' },
      { name: 'google', label: 'Google' },
    ]);
  });

  it('returns only the currently registered subset', async () => {
    REGISTERED_PROVIDERS.push('discord');
    const res = await request(app).get('/auth/providers');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toEqual({ name: 'discord', label: 'Discord' });
  });

  it('does not require authentication', async () => {
    const res = await request(app).get('/auth/providers');
    expect(res.status).toBe(200);
  });
});

describe('GET /oauth/apps', () => {
  it('returns 401 without authentication', async () => {
    const res = await request(app).get('/oauth/apps');
    expect(res.status).toBe(401);
  });

  it('returns 403 when the apps read scope is missing', async () => {
    const user = makeRegularUser();
    const token = issueAccessToken(user, ['user:read']);
    const res = await request(app)
      .get('/oauth/apps')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.hint).toMatch(/oauth:apps:read/);
  });

  it('returns empty array when user has no consented apps and the scope is present', async () => {
    const user = makeRegularUser();
    const token = issueAccessToken(user, ['oauth:apps:read']);
    const res = await request(app)
      .get('/oauth/apps')
      .set('Authorization', `Bearer ${token}`);
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

  it('returns 403 when the apps write scope is missing', async () => {
    const user = makeRegularUser();
    const token = issueAccessToken(user, ['oauth:apps:read']);
    const res = await request(app)
      .post('/oauth/apps')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'My Integration',
        redirectUris: ['https://myapp.com/callback'],
        scopes: ['shorten:create'],
        isPublic: false,
      });

    expect(res.status).toBe(403);
    expect(res.body.hint).toMatch(/oauth:apps:write/);
  });

  it('registers a new confidential client for an authenticated user', async () => {
    const user = makeRegularUser();
    const token = issueAccessToken(user, ['oauth:apps:write']);
    const res = await request(app)
      .post('/oauth/apps')
      .set('Authorization', `Bearer ${token}`)
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
    const user = makeRegularUser();
    const token = issueAccessToken(user, ['oauth:apps:write']);
    const res = await request(app)
      .post('/oauth/apps')
      .set('Authorization', `Bearer ${token}`)
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
    const user = makeRegularUser();
    const token = issueAccessToken(user, ['oauth:apps:write']);
    const res = await request(app)
      .post('/oauth/apps')
      .set('Authorization', `Bearer ${token}`)
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
    const user = makeRegularUser();
    const token = issueAccessToken(user, ['oauth:apps:write']);
    const res = await request(app)
      .delete('/oauth/apps/unknown-client-xyz')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('allows owner to revoke own client', async () => {
    const user = makeRegularUser();
    const token = issueAccessToken(user, ['oauth:apps:write']);
    makeOAuthClient({ client_id: 'owner-client', user_id: user.id });
    const res = await request(app)
      .delete('/oauth/apps/owner-client')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('prevents non-owner non-admin from revoking another users client', async () => {
    const owner = makeRegularUser();
    makeOAuthClient({ client_id: 'owned-client', user_id: owner.id });
    const attacker = makeRegularUser();
    attacker.github_id = 'attacker-gh';
    attacker.username = 'attacker';
    const token = issueAccessToken(attacker, ['oauth:apps:write']);
    const res = await request(app)
      .delete('/oauth/apps/owned-client')
      .set('Authorization', `Bearer ${token}`);
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

// ============================================================================
// Multi-provider auth tests (identities, linking, merge)
// ============================================================================

function makeIdentity(
  userId: number,
  provider: string,
  providerUserId = `pid-${provider}-${userId}`,
): IdentityRecord {
  const row: IdentityRecord = {
    id: db.nextIdentityId++,
    user_id: userId,
    provider,
    provider_user_id: providerUserId,
    display_name: `${provider}-user`,
    email: null,
    email_verified: false,
    created_at: new Date(),
    updated_at: new Date(),
  };
  db.userIdentities.push(row);
  return row;
}

describe('GET /auth/:provider - provider guards', () => {
  it('returns 400 for an unknown provider', async () => {
    const res = await request(app).get('/auth/unknown-provider');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown provider/i);
  });

  it('returns 503 when a valid provider is not configured', async () => {
    // In test env no provider env vars are set, so all registered providers
    // are absent.  Verify a valid provider name returns 503.
    const res = await request(app).get('/auth/google');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });
});

describe('GET /auth/:provider/link - provider link guards', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/auth/github/link');
    expect(res.status).toBe(401);
  });

  it('returns 503 for authenticated user when provider is not configured', async () => {
    const user = makeRegularUser();
    const { agent } = await createAuthenticatedSession(user, '10.101.1.1');
    const res = await agent.get('/auth/google/link').set('X-Forwarded-For', '10.101.1.1');
    expect(res.status).toBe(503);
  });

  it('returns 400 for an unknown provider even when authenticated', async () => {
    const user = makeRegularUser();
    const { agent } = await createAuthenticatedSession(user, '10.101.1.2');
    const res = await agent.get('/auth/unknown/link').set('X-Forwarded-For', '10.101.1.2');
    expect(res.status).toBe(400);
  });
});

describe('GET /auth/:provider/callback - provider guards', () => {
  it('returns 400 for an unknown provider', async () => {
    const res = await request(app).get('/auth/unknown/callback');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown provider/i);
  });

  it('returns 503 when a valid provider callback is not configured', async () => {
    const res = await request(app).get('/auth/google/callback');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });

  it('returns 405 for apple because the callback must use POST', async () => {
    const res = await request(app).get('/auth/apple/callback');
    expect(res.status).toBe(405);
    expect(res.body.error).toMatch(/must use post/i);
    expect(res.body.hint).toMatch(/form_post/i);
  });
});

describe('GET /auth/identities', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/auth/identities');
    expect(res.status).toBe(401);
  });

  it('returns an empty array when the user has no identities', async () => {
    const user = makeRegularUser();
    const { agent } = await createAuthenticatedSession(user, '10.101.2.1');
    const res = await agent.get('/auth/identities').set('X-Forwarded-For', '10.101.2.1');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it('returns connected identities in camelCase for the session user', async () => {
    const user = makeRegularUser();
    makeIdentity(user.id, 'github', 'gh-42');
    makeIdentity(user.id, 'google', 'google-99');
    const { agent } = await createAuthenticatedSession(user, '10.101.2.2');
    const res = await agent.get('/auth/identities').set('X-Forwarded-For', '10.101.2.2');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    const providers = (res.body as Array<{ provider: string }>).map((i) => i.provider);
    expect(providers).toContain('github');
    expect(providers).toContain('google');
    // Ensure camelCase output.
    const identity = res.body[0] as Record<string, unknown>;
    expect(identity).toHaveProperty('displayName');
    expect(identity).toHaveProperty('connectedAt');
    expect(identity).not.toHaveProperty('display_name');
    expect(identity).not.toHaveProperty('created_at');
  });

  it('does not return identities belonging to other users', async () => {
    const userA = makeRegularUser();
    const userB = makeRegularUser();
    makeIdentity(userA.id, 'github', 'gh-a');
    makeIdentity(userB.id, 'discord', 'dc-b');

    const { agent } = await createAuthenticatedSession(userA, '10.101.2.3');
    const res = await agent.get('/auth/identities').set('X-Forwarded-For', '10.101.2.3');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect((res.body as Array<{ provider: string }>)[0].provider).toBe('github');
  });
});

describe('DELETE /auth/identities/:provider', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).delete('/auth/identities/github');
    expect(res.status).toBe(401);
  });

  it('returns 400 for an unknown provider name', async () => {
    const user = makeRegularUser();
    makeIdentity(user.id, 'github');
    const { agent, csrfToken } = await createAuthenticatedSession(user, '10.101.3.1');
    const res = await agent
      .delete('/auth/identities/badprovider')
      .set('X-CSRF-Token', csrfToken)
      .set('X-Forwarded-For', '10.101.3.1');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown provider/i);
  });

  it('prevents disconnecting the last remaining identity', async () => {
    const user = makeRegularUser();
    makeIdentity(user.id, 'github');
    const { agent, csrfToken } = await createAuthenticatedSession(user, '10.101.3.2');
    const res = await agent
      .delete('/auth/identities/github')
      .set('X-CSRF-Token', csrfToken)
      .set('X-Forwarded-For', '10.101.3.2');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only login method/i);
    expect(res.body.hint).toBeTruthy();
  });

  it('returns 404 when the provider identity does not exist for the user', async () => {
    const user = makeRegularUser();
    makeIdentity(user.id, 'github');
    makeIdentity(user.id, 'google');
    const { agent, csrfToken } = await createAuthenticatedSession(user, '10.101.3.3');
    const res = await agent
      .delete('/auth/identities/discord')
      .set('X-CSRF-Token', csrfToken)
      .set('X-Forwarded-For', '10.101.3.3');
    expect(res.status).toBe(404);
  });

  it('successfully disconnects when multiple identities exist', async () => {
    const user = makeRegularUser();
    makeIdentity(user.id, 'github');
    makeIdentity(user.id, 'google');
    const { agent, csrfToken } = await createAuthenticatedSession(user, '10.101.3.4');
    const res = await agent
      .delete('/auth/identities/google')
      .set('X-CSRF-Token', csrfToken)
      .set('X-Forwarded-For', '10.101.3.4');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Verify the identity was removed.
    expect(db.userIdentities.some((i) => i.user_id === user.id && i.provider === 'google')).toBe(false);
  });
});

describe('POST /auth/merge/initiate', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).post('/auth/merge/initiate').send({ targetUserId: 1 });
    expect(res.status).toBe(401);
  });

  it('returns 400 when targetUserId is missing', async () => {
    const user = makeRegularUser();
    const { agent, csrfToken } = await createAuthenticatedSession(user, '10.101.4.1');
    const res = await agent
      .post('/auth/merge/initiate')
      .set('X-CSRF-Token', csrfToken)
      .set('X-Forwarded-For', '10.101.4.1')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/targetUserId/i);
  });

  it('returns 400 when targetUserId is not a whole number', async () => {
    const user = makeRegularUser();
    const userB = makeRegularUser();
    const { agent, csrfToken } = await createAuthenticatedSession(user, '10.101.4.1b');
    const res = await agent
      .post('/auth/merge/initiate')
      .set('X-CSRF-Token', csrfToken)
      .set('X-Forwarded-For', '10.101.4.1b')
      .send({ targetUserId: `${userB.id}abc` });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/whole number/i);
  });

  it('returns 400 when trying to merge with self', async () => {
    const user = makeRegularUser();
    const { agent, csrfToken } = await createAuthenticatedSession(user, '10.101.4.2');
    const res = await agent
      .post('/auth/merge/initiate')
      .set('X-CSRF-Token', csrfToken)
      .set('X-Forwarded-For', '10.101.4.2')
      .send({ targetUserId: user.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/itself/i);
  });

  it('returns 404 when target user does not exist', async () => {
    const user = makeRegularUser();
    const { agent, csrfToken } = await createAuthenticatedSession(user, '10.101.4.3');
    const res = await agent
      .post('/auth/merge/initiate')
      .set('X-CSRF-Token', csrfToken)
      .set('X-Forwarded-For', '10.101.4.3')
      .send({ targetUserId: 99999 });
    expect(res.status).toBe(404);
  });

  it('returns a mergeToken and target user info on success', async () => {
    const userA = makeRegularUser();
    const userB = makeRegularUser();
    const { agent, csrfToken } = await createAuthenticatedSession(userA, '10.101.4.4');
    const res = await agent
      .post('/auth/merge/initiate')
      .set('X-CSRF-Token', csrfToken)
      .set('X-Forwarded-For', '10.101.4.4')
      .send({ targetUserId: userB.id });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.mergeToken).toBe('string');
    expect(res.body.mergeToken.length).toBeGreaterThan(20);
    expect(res.body.targetUser.id).toBe(userB.id);
    expect(res.body.targetUser.username).toBe(userB.username);
    expect(res.body.expiresAt).toBeTruthy();
  });
});

describe('POST /auth/merge/confirm', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).post('/auth/merge/confirm').send({ mergeToken: 'abc' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when mergeToken is missing', async () => {
    const user = makeRegularUser();
    const { agent, csrfToken } = await createAuthenticatedSession(user, '10.101.5.1');
    const res = await agent
      .post('/auth/merge/confirm')
      .set('X-CSRF-Token', csrfToken)
      .set('X-Forwarded-For', '10.101.5.1')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.hint).toMatch(/initiate/i);
  });

  it('returns 400 when no pending merge exists in session', async () => {
    const user = makeRegularUser();
    const { agent, csrfToken } = await createAuthenticatedSession(user, '10.101.5.2');
    const res = await agent
      .post('/auth/merge/confirm')
      .set('X-CSRF-Token', csrfToken)
      .set('X-Forwarded-For', '10.101.5.2')
      .send({ mergeToken: 'some-token' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no pending merge/i);
  });

  it('returns 403 when the token does not match', async () => {
    const userA = makeRegularUser();
    const userB = makeRegularUser();
    const { agent, csrfToken } = await createAuthenticatedSession(userA, '10.101.5.3');

    // Initiate first.
    await agent
      .post('/auth/merge/initiate')
      .set('X-CSRF-Token', csrfToken)
      .set('X-Forwarded-For', '10.101.5.3')
      .send({ targetUserId: userB.id });

    // Confirm with wrong token.
    const res = await agent
      .post('/auth/merge/confirm')
      .set('X-CSRF-Token', csrfToken)
      .set('X-Forwarded-For', '10.101.5.3')
      .send({ mergeToken: 'wrong-token-value' });
    expect(res.status).toBe(403);
  });

  it('merges accounts on the happy path: moves identities and urls, deletes target user', async () => {
    const userA = makeRegularUser();
    userA.username = 'user-a';
    const userB = makeRegularUser();
    userB.username = 'user-b';

    // Give userB a github identity and a url.
    makeIdentity(userA.id, 'github', 'gh-a');
    makeIdentity(userB.id, 'discord', 'dc-b');
    db.urls.push({
      id: db.nextUrlId++,
      short_code: 'user-b-url',
      original_url: 'https://b.example.com',
      user_id: userB.id,
      expires_at: null,
      is_custom: false,
      created_at: new Date(),
    });

    const { agent, csrfToken } = await createAuthenticatedSession(userA, '10.101.5.4');

    // Initiate merge.
    const initiateRes = await agent
      .post('/auth/merge/initiate')
      .set('X-CSRF-Token', csrfToken)
      .set('X-Forwarded-For', '10.101.5.4')
      .send({ targetUserId: userB.id });
    expect(initiateRes.status).toBe(200);
    const { mergeToken } = initiateRes.body as { mergeToken: string };

    // Confirm merge.
    const confirmRes = await agent
      .post('/auth/merge/confirm')
      .set('X-CSRF-Token', csrfToken)
      .set('X-Forwarded-For', '10.101.5.4')
      .send({ mergeToken });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.success).toBe(true);

    // UserB's discord identity should now belong to userA.
    const discordIdentity = db.userIdentities.find((i) => i.provider === 'discord');
    expect(discordIdentity?.user_id).toBe(userA.id);

    // URL owned by userB should now belong to userA.
    const movedUrl = db.urls.find((u) => u.short_code === 'user-b-url');
    expect(movedUrl?.user_id).toBe(userA.id);

    // UserB should be deleted.
    expect(db.users.find((u) => u.id === userB.id)).toBeUndefined();

    // Audit log should record the merge.
    expect(db.mergeLogs).toHaveLength(1);
    expect(db.mergeLogs[0].surviving_user_id).toBe(userA.id);
    expect(db.mergeLogs[0].merged_user_id).toBe(userB.id);
  });

  it('merge token cannot be used a second time', async () => {
    const userA = makeRegularUser();
    const userB = makeRegularUser();
    makeIdentity(userA.id, 'github');
    makeIdentity(userB.id, 'google');

    const { agent, csrfToken } = await createAuthenticatedSession(userA, '10.101.5.5');

    const initiateRes = await agent
      .post('/auth/merge/initiate')
      .set('X-CSRF-Token', csrfToken)
      .set('X-Forwarded-For', '10.101.5.5')
      .send({ targetUserId: userB.id });
    const { mergeToken } = initiateRes.body as { mergeToken: string };

    // First confirm: succeeds.
    const firstConfirm = await agent
      .post('/auth/merge/confirm')
      .set('X-CSRF-Token', csrfToken)
      .set('X-Forwarded-For', '10.101.5.5')
      .send({ mergeToken });
    expect(firstConfirm.status).toBe(200);

    // Second confirm: no pending merge left.
    const secondConfirm = await agent
      .post('/auth/merge/confirm')
      .set('X-CSRF-Token', csrfToken)
      .set('X-Forwarded-For', '10.101.5.5')
      .send({ mergeToken });
    expect(secondConfirm.status).toBe(400);
    expect(secondConfirm.body.error).toMatch(/no pending merge/i);
  });
});

describe('GET /auth/me - session-based browser auth (no OAuth scope required)', () => {
  it('returns user info for authenticated browser session', async () => {
    const user = makeRegularUser();
    const { agent } = await createAuthenticatedSession(user, '10.101.6.1');
    const res = await agent.get('/auth/me').set('X-Forwarded-For', '10.101.6.1');
    expect(res.status).toBe(200);
    expect(res.body.username).toBe(user.username);
    expect(res.body.role).toBe('user');
    // Session-based responses do not include scopes.
    expect(res.body.scopes).toBeUndefined();
  });

  it('returns null for unauthenticated request', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });
});

describe('POST /auth/merge/confirm - duplicate provider handling', () => {
  it('deduplicates providers when both users share the same provider before merging', async () => {
    const userA = makeRegularUser();
    const userB = makeRegularUser();

    // Both users have github identity; userB also has google.
    makeIdentity(userA.id, 'github', 'gh-a');
    makeIdentity(userB.id, 'github', 'gh-b');
    makeIdentity(userB.id, 'google', 'google-b');

    const { agent, csrfToken } = await createAuthenticatedSession(userA, '10.101.7.1');

    // Initiate merge.
    const initiateRes = await agent
      .post('/auth/merge/initiate')
      .set('X-CSRF-Token', csrfToken)
      .set('X-Forwarded-For', '10.101.7.1')
      .send({ targetUserId: userB.id });
    expect(initiateRes.status).toBe(200);
    const { mergeToken } = initiateRes.body as { mergeToken: string };

    // Confirm merge.
    const confirmRes = await agent
      .post('/auth/merge/confirm')
      .set('X-CSRF-Token', csrfToken)
      .set('X-Forwarded-For', '10.101.7.1')
      .send({ mergeToken });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.success).toBe(true);

    // userA keeps their own github identity (userB's conflicting github is dropped).
    const githubIdentities = db.userIdentities.filter(
      (i) => i.provider === 'github' && i.user_id === userA.id,
    );
    expect(githubIdentities).toHaveLength(1);
    expect(githubIdentities[0].provider_user_id).toBe('gh-a');

    // userB's google identity is moved to userA.
    const googleIdentity = db.userIdentities.find(
      (i) => i.provider === 'google' && i.user_id === userA.id,
    );
    expect(googleIdentity).toBeDefined();
    expect(googleIdentity?.provider_user_id).toBe('google-b');

    // userB is deleted.
    expect(db.users.find((u) => u.id === userB.id)).toBeUndefined();
  });
});

describe('DELETE /auth/me - account deletion', () => {
  it('deletes the authenticated user and returns 200', async () => {
    const user = makeRegularUser();
    const { agent, csrfToken } = await createAuthenticatedSession(user, '10.102.1.1');

    const res = await agent
      .delete('/auth/me')
      .set('X-CSRF-Token', csrfToken)
      .set('X-Forwarded-For', '10.102.1.1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(db.users.find((u) => u.id === user.id)).toBeUndefined();
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app)
      .delete('/auth/me')
      .set('X-Forwarded-For', '10.102.1.2');

    expect(res.status).toBe(401);
  });

  it('returns 403 when called with OAuth bearer token', async () => {
    const user = makeRegularUser();
    const token = issueAccessToken(user, ['user:read']);

    const res = await request(app)
      .delete('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', '10.102.1.3');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});

// ============================================================================
// Rate-limit header contract tests
// ============================================================================

describe('Rate-limit headers — IETF draft-8 contract', () => {
  it('GET /auth/csrf-token emits RateLimit and RateLimit-Policy for anonymous requests', async () => {
    const res = await request(app).get('/auth/csrf-token').set('X-Forwarded-For', '10.200.0.1');
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit']).toBeDefined();
    expect(res.headers['ratelimit-policy']).toBeDefined();
    expect(res.headers['x-ratelimit-limit']).toBeUndefined();
  });

  it('GET /auth/csrf-token emits no rate-limit headers for admin', async () => {
    const admin = makeAdminUser();
    const token = issueAccessToken(admin, ['user:read']);
    const res = await request(app)
      .get('/auth/csrf-token')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', '10.200.0.2');
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit']).toBeUndefined();
    expect(res.headers['ratelimit-policy']).toBeUndefined();
  });

  it('GET /auth/me emits RateLimit headers for anonymous requests', async () => {
    const res = await request(app).get('/auth/me').set('X-Forwarded-For', '10.200.1.1');
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit']).toBeDefined();
    expect(res.headers['ratelimit-policy']).toBeDefined();
  });

  it('GET /auth/me emits no rate-limit headers for admin', async () => {
    const admin = makeAdminUser();
    const token = issueAccessToken(admin, ['user:read']);
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', '10.200.1.2');
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit']).toBeUndefined();
    expect(res.headers['ratelimit-policy']).toBeUndefined();
  });

  it('POST /api/shorten for anonymous user emits both session and IP bucket headers', async () => {
    const ip = '10.200.2.1';
    const agent = request.agent(app);
    const csrf = (await agent.get('/auth/csrf-token').set('X-Forwarded-For', ip)).body.csrfToken as string;

    const res = await agent
      .post('/api/shorten')
      .set('X-CSRF-Token', csrf)
      .set('X-Forwarded-For', ip)
      .send({ url: 'https://example.com', ttl: '24h' });

    expect(res.status).toBe(201);
    expect(res.headers['ratelimit']).toBeDefined();
    expect(res.headers['ratelimit-policy']).toBeDefined();
    // Both session and IP policies should appear (comma-separated).
    expect(res.headers['ratelimit-policy']).toContain(',');
  });

  it('POST /api/shorten for authenticated user emits only one bucket header', async () => {
    const user = makeRegularUser();
    const token = issueAccessToken(user, ['shorten:create']);

    const res = await request(app)
      .post('/api/shorten')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', '10.200.2.2')
      .send({ url: 'https://example.com', ttl: '24h' });

    expect(res.status).toBe(201);
    expect(res.headers['ratelimit']).toBeDefined();
    expect(res.headers['ratelimit-policy']).toBeDefined();
    // Only one user-scoped policy.
    expect(res.headers['ratelimit-policy']).not.toContain(',');
  });

  it('POST /api/shorten for admin emits no rate-limit headers', async () => {
    const admin = makeAdminUser();
    const token = issueAccessToken(admin, ['shorten:create']);

    const res = await request(app)
      .post('/api/shorten')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', '10.200.2.3')
      .send({ url: 'https://example.com', ttl: '24h' });

    expect(res.status).toBe(201);
    expect(res.headers['ratelimit']).toBeUndefined();
    expect(res.headers['ratelimit-policy']).toBeUndefined();
  });

  it('GET /api/openapi.json emits RateLimit headers for anonymous', async () => {
    const res = await request(app).get('/api/openapi.json').set('X-Forwarded-For', '10.200.3.1');
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit']).toBeDefined();
    expect(res.headers['ratelimit-policy']).toBeDefined();
  });

  it('GET /api/openapi.json emits no rate-limit headers for admin', async () => {
    const admin = makeAdminUser();
    const token = issueAccessToken(admin, ['user:read']);
    const res = await request(app)
      .get('/api/openapi.json')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', '10.200.3.2');
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit']).toBeUndefined();
    expect(res.headers['ratelimit-policy']).toBeUndefined();
  });

  it('GET /s/:code emits no rate-limit headers (unlimited endpoint)', async () => {
    db.urls.push({ id: 99, short_code: 'rl-test', original_url: 'https://example.com', expires_at: new Date(Date.now() + 86400000), is_custom: false, user_id: null, created_at: new Date() });
    const res = await request(app).get('/s/rl-test').redirects(0).set('X-Forwarded-For', '10.200.4.1');
    expect(res.status).toBe(302);
    expect(res.headers['ratelimit']).toBeUndefined();
    expect(res.headers['ratelimit-policy']).toBeUndefined();
  });

  it('GET /api/:code emits no rate-limit headers (unlimited endpoint)', async () => {
    db.urls.push({ id: 98, short_code: 'rl-test2', original_url: 'https://example.com', expires_at: new Date(Date.now() + 86400000), is_custom: false, user_id: null, created_at: new Date() });
    const res = await request(app).get('/api/rl-test2').redirects(0).set('X-Forwarded-For', '10.200.4.2');
    expect(res.status).toBe(302);
    expect(res.headers['ratelimit']).toBeUndefined();
    expect(res.headers['ratelimit-policy']).toBeUndefined();
  });

  it('429 response includes Retry-After header', async () => {
    const ip = '10.200.5.1';
    const agent = request.agent(app);
    const csrf = (await agent.get('/auth/csrf-token').set('X-Forwarded-For', ip)).body.csrfToken as string;
    const body = { url: 'https://example.com', ttl: '24h' };

    await agent.post('/api/shorten').set('X-CSRF-Token', csrf).set('X-Forwarded-For', ip).send(body);
    await agent.post('/api/shorten').set('X-CSRF-Token', csrf).set('X-Forwarded-For', ip).send(body);
    const blocked = await agent.post('/api/shorten').set('X-CSRF-Token', csrf).set('X-Forwarded-For', ip).send(body);

    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('admin-probe bucket fires for non-admin requests to admin routes', async () => {
    const user = makeRegularUser();
    const token = issueAccessToken(user, ['urls:read']);
    const res = await request(app)
      .get('/admin/urls')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', '10.200.6.1');
    // 403 because user lacks admin role, but rate-limit headers should be present
    expect(res.status).toBe(403);
    expect(res.headers['ratelimit']).toBeDefined();
    expect(res.headers['ratelimit-policy']).toBeDefined();
  });

  it('admin-probe bucket is skipped for actual admin requests', async () => {
    const admin = makeAdminUser();
    const token = issueAccessToken(admin, ['urls:read']);
    const res = await request(app)
      .get('/admin/urls')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', '10.200.6.2');
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit']).toBeUndefined();
    expect(res.headers['ratelimit-policy']).toBeUndefined();
  });

  it('privileged user gets higher quota than regular user (higher max in policy header)', async () => {
    const user = makeRegularUser();
    const userToken = issueAccessToken(user, ['shorten:create']);
    const userRes = await request(app)
      .post('/api/shorten')
      .set('Authorization', `Bearer ${userToken}`)
      .set('X-Forwarded-For', '10.200.7.1')
      .send({ url: 'https://example.com', ttl: '24h' });
    expect(userRes.status).toBe(201);

    const privileged = makePrivilegedUser();
    const privToken = issueAccessToken(privileged, ['shorten:create']);
    const privRes = await request(app)
      .post('/api/shorten')
      .set('Authorization', `Bearer ${privToken}`)
      .set('X-Forwarded-For', '10.200.7.2')
      .send({ url: 'https://example.com', ttl: '24h' });
    expect(privRes.status).toBe(201);

    // Both get headers; privileged limit > user limit.
    const userPolicy: string = userRes.headers['ratelimit-policy'] as string;
    const privPolicy: string = privRes.headers['ratelimit-policy'] as string;
    expect(userPolicy).toBeDefined();
    expect(privPolicy).toBeDefined();

    // Extract the limit numbers from the policy header (e.g. `"shorten-user"; q=60; w=900; pk=:...:`)
    const extractLimit = (policy: string): number => {
      const match = /q=(\d+)/.exec(policy.trim());
      if (!match) throw new Error(`Unexpected RateLimit-Policy format: ${policy}`);
      return parseInt(match[1], 10);
    };
    expect(extractLimit(privPolicy)).toBeGreaterThan(extractLimit(userPolicy));
  });

  it('GET /auth/me emits ONLY auth-read policies — no auth-flow bucket', async () => {
    const res = await request(app).get('/auth/me').set('X-Forwarded-For', '10.200.8.1');
    expect(res.status).toBe(200);
    const policy: string = res.headers['ratelimit-policy'] as string;
    expect(policy).toBeDefined();
    expect(policy).toContain('auth-read-anonymous');
    expect(policy).not.toContain('auth-flow');
  });

  it('GET /auth/providers emits ONLY auth-read policies — no auth-flow bucket', async () => {
    const res = await request(app).get('/auth/providers').set('X-Forwarded-For', '10.200.8.2');
    expect(res.status).toBe(200);
    const policy: string = res.headers['ratelimit-policy'] as string;
    expect(policy).toBeDefined();
    expect(policy).toContain('auth-read-anonymous');
    expect(policy).not.toContain('auth-flow');
  });

  it('429 on anonymous POST /api/shorten returns both session and IP bucket headers', async () => {
    const ip = '10.200.9.1';
    const agent = request.agent(app);
    const csrf = (await agent.get('/auth/csrf-token').set('X-Forwarded-For', ip)).body.csrfToken as string;
    const body = { url: 'https://example.com', ttl: '24h' };

    // Exhaust the session bucket (limit = 2).
    await agent.post('/api/shorten').set('X-CSRF-Token', csrf).set('X-Forwarded-For', ip).send(body);
    await agent.post('/api/shorten').set('X-CSRF-Token', csrf).set('X-Forwarded-For', ip).send(body);
    const blocked = await agent.post('/api/shorten').set('X-CSRF-Token', csrf).set('X-Forwarded-For', ip).send(body);

    expect(blocked.status).toBe(429);
    const policy: string = blocked.headers['ratelimit-policy'] as string;
    expect(policy).toBeDefined();
    // Both the session and IP bucket policies must appear.
    expect(policy).toContain('shorten-anonymous-session');
    expect(policy).toContain('shorten-anonymous-ip');
  });

  it('POST /oauth/token with valid client_id keys the bucket by client', async () => {
    // Register a real client so the DB lookup succeeds.
    const client = makeOAuthClient({ client_id: 'rate-limit-test-client', is_public: true });
    const res = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('X-Forwarded-For', '10.200.10.1')
      .send(`grant_type=authorization_code&client_id=${client.client_id}&code=bogus&redirect_uri=http://localhost`);
    // Any non-network error is fine; we only care that rate-limit headers are present.
    expect([400, 401, 422, 200]).toContain(res.status);
    expect(res.headers['ratelimit']).toBeDefined();
    expect(res.headers['ratelimit-policy']).toBeDefined();
  });

  it('POST /oauth/token with unknown client_id falls back to IP bucket', async () => {
    // Use a client_id that is NOT in the DB — should fall back to IP key.
    const res = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('X-Forwarded-For', '10.200.10.2')
      .send('grant_type=authorization_code&client_id=totally-bogus-id&code=bogus&redirect_uri=http://localhost');
    expect([400, 401, 422, 200]).toContain(res.status);
    expect(res.headers['ratelimit']).toBeDefined();
    expect(res.headers['ratelimit-policy']).toBeDefined();
  });

  it('POST /api/shorten 429 in OpenAPI uses the shared TooManyRequests component', () => {
    const shorten = (baseSpec.paths as Record<string, Record<string, unknown>>)['/api/shorten'];
    expect(shorten).toBeDefined();
    const post = shorten['post'] as { responses: Record<string, unknown> };
    const response429 = post.responses['429'] as Record<string, unknown>;
    expect(response429).toBeDefined();
    expect(response429['$ref']).toBe('#/components/responses/TooManyRequests');
  });
});
