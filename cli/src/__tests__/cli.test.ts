import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Headers, Response } from 'node-fetch';
import { getConfigPath, readStoredConfig } from '../config';
import { CliRuntime, runCli } from '../cli';

type FetchCall = {
  url: string;
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
};

type FetchStub = ((url: string, init?: FetchCall['init']) => Promise<Response>) & {
  calls: FetchCall[];
};

async function makeTempHome(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'leaflet-cli-test-'));
}

function createFetchStub(
  responses: Array<Response | ((url: string, init?: FetchCall['init']) => Response)>,
): FetchStub {
  const calls: FetchCall[] = [];

  const fetchStub = (async (url: string, init?: FetchCall['init']) => {
    calls.push({ url, init });
    const next = responses.shift();

    if (!next) {
      throw new Error(`Unexpected fetch call for ${url}`);
    }

    return typeof next === 'function' ? next(url, init) : next;
  }) as FetchStub;

  fetchStub.calls = calls;
  return fetchStub;
}

function jsonResponse(body: Record<string, unknown>, init: { status: number; headers?: Record<string, string> }): Response {
  return new Response(JSON.stringify(body), {
    status: init.status,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

function oauthTokenResponse(overrides: Partial<{
  access_token: string;
  token_type: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}> = {}) {
  return {
    access_token: 'oauth-access-token',
    token_type: 'Bearer',
    refresh_token: 'oauth-refresh-token',
    expires_in: 900,
    scope: 'shorten:create user:read',
    ...overrides,
  };
}

async function invokeCli(args: string[], options: {
  homeDir: string;
  env?: NodeJS.ProcessEnv;
  fetchStub: FetchStub;
  oauthDeps?: CliRuntime['oauthDeps'];
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';

  const exitCode = await runCli(['node', 'leaflet-cli', ...args], {
    env: options.env ?? {},
    homeDir: options.homeDir,
    fetchImpl: options.fetchStub,
    writeOut: (chunk) => {
      stdout += chunk;
    },
    writeErr: (chunk) => {
      stderr += chunk;
    },
    oauthDeps: options.oauthDeps,
  });

  return { exitCode, stdout, stderr };
}

test('auth login completes the PKCE OAuth flow and stores OAuth credentials', async () => {
  const homeDir = await makeTempHome();
  const fetchStub = createFetchStub([]);
  let openedUrl = '';

  const result = await invokeCli([
    'auth',
    'login',
    '--json',
  ], {
    homeDir,
    fetchStub,
    oauthDeps: {
      generateCodeVerifier: () => 'verifier-value',
      computeCodeChallenge: () => 'challenge-value',
      generateState: () => 'state-value',
      startCallbackServer: () => ({
        port: Promise.resolve(43123),
        result: Promise.resolve('auth-code'),
      }),
      openBrowser: async (url: string) => {
        openedUrl = url;
      },
      exchangeCodeForTokens: async (params: Record<string, string>) => {
        assert.equal(params.code, 'auth-code');
        assert.equal(params.redirectUri, 'http://localhost:43123/callback');
        assert.equal(params.codeVerifier, 'verifier-value');
        return oauthTokenResponse({
          scope: 'shorten:create shorten:create:alias urls:delete user:read',
        });
      },
    },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(fetchStub.calls.length, 0);

  const authorizeUrl = new URL(openedUrl);
  assert.equal(authorizeUrl.pathname, '/oauth/authorize');
  assert.equal(authorizeUrl.searchParams.get('client_id'), 'leaflet-cli');
  assert.equal(authorizeUrl.searchParams.get('redirect_uri'), 'http://localhost:43123/callback');
  assert.equal(authorizeUrl.searchParams.get('code_challenge'), 'challenge-value');
  assert.equal(
    authorizeUrl.searchParams.get('scope'),
    'shorten:create shorten:create:alias shorten:create:never urls:delete user:read',
  );

  const payload = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(payload.success, true);
  assert.equal(payload.authStatus, 'authenticated');
  assert.equal(payload.scope, 'shorten:create shorten:create:alias urls:delete user:read');

  const storedConfig = await readStoredConfig(homeDir);
  assert.equal(storedConfig.oauth?.accessToken, 'oauth-access-token');
  assert.equal(storedConfig.oauth?.refreshToken, 'oauth-refresh-token');
  assert.equal(storedConfig.oauth?.scope, 'shorten:create shorten:create:alias urls:delete user:read');
  assert.equal((storedConfig as Record<string, unknown>).token, undefined);
});

test('auth login keeps the manual fallback path when the browser cannot be opened automatically', async () => {
  const homeDir = await makeTempHome();
  const fetchStub = createFetchStub([]);

  const result = await invokeCli([
    'auth',
    'login',
    '--json',
    '--verbose',
  ], {
    homeDir,
    fetchStub,
    oauthDeps: {
      generateCodeVerifier: () => 'verifier-value',
      computeCodeChallenge: () => 'challenge-value',
      generateState: () => 'state-value',
      startCallbackServer: () => ({
        port: Promise.resolve(43124),
        result: Promise.resolve('auth-code'),
      }),
      openBrowser: async () => {
        throw new Error('browser launch failed');
      },
      exchangeCodeForTokens: async () => oauthTokenResponse(),
    },
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.stderr, /Could not open browser automatically/i);
});

test('auth login rejects the removed legacy --token option', async () => {
  const homeDir = await makeTempHome();
  const fetchStub = createFetchStub([]);

  const result = await invokeCli([
    'auth',
    'login',
    '--token',
    'legacy-token',
    '--json',
  ], { homeDir, fetchStub });

  assert.equal(result.exitCode, 1);

  const payload = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(payload.success, false);
  assert.match(String(payload.error), /unknown option/i);

  const storedConfig = await readStoredConfig(homeDir);
  assert.equal(storedConfig.oauth, undefined);
});

test('auth status reports anonymous mode when no OAuth credentials are configured', async () => {
  const homeDir = await makeTempHome();
  const fetchStub = createFetchStub([]);

  const result = await invokeCli([
    'auth',
    'status',
    '--json',
  ], { homeDir, fetchStub });

  assert.equal(result.exitCode, 0);

  const payload = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(payload.success, true);
  assert.equal(payload.authenticated, false);
  assert.equal(payload.authStatus, 'anonymous');
  assert.equal(fetchStub.calls.length, 0);
});

test('auth status ignores removed API key environment aliases', async () => {
  const homeDir = await makeTempHome();
  const fetchStub = createFetchStub([]);

  const result = await invokeCli([
    'auth',
    'status',
    '--json',
  ], {
    homeDir,
    fetchStub,
    env: {
      LEAFLET_API_KEY: 'legacy-key',
      LEAFLET_API_TOKEN: 'legacy-token',
    },
  });

  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(payload.authStatus, 'anonymous');
  assert.equal(fetchStub.calls.length, 0);
});

test('auth status validates OAuth credentials and reports granted scopes', async () => {
  const homeDir = await makeTempHome();
  const configPath = getConfigPath(homeDir);
  await fs.writeFile(configPath, `${JSON.stringify({
    oauth: {
      accessToken: 'stored-access-token',
      refreshToken: 'stored-refresh-token',
      expiresAt: Date.now() + 3_600_000,
      scope: 'shorten:create user:read',
      clientId: 'leaflet-cli',
    },
  }, null, 2)}\n`, 'utf8');

  const fetchStub = createFetchStub([
    jsonResponse({
      id: 1,
      username: 'adminuser',
      role: 'admin',
      scopes: ['shorten:create', 'user:read', 'urls:delete'],
    }, { status: 200 }),
  ]);

  const result = await invokeCli([
    'auth',
    'status',
    '--json',
  ], { homeDir, fetchStub });

  assert.equal(result.exitCode, 0);
  assert.equal(fetchStub.calls.length, 1);
  assert.equal(fetchStub.calls[0].url, 'https://leaflet.lair.nntin.xyz/auth/me');
  assert.equal(fetchStub.calls[0].init?.headers?.Authorization, 'Bearer stored-access-token');

  const payload = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(payload.success, true);
  assert.equal(payload.authStatus, 'admin');
  assert.equal(payload.scope, 'shorten:create user:read urls:delete');
  assert.deepEqual(payload.scopes, ['shorten:create', 'user:read', 'urls:delete']);
});

test('auth status refreshes an expiring stored OAuth token before validating it', async () => {
  const homeDir = await makeTempHome();
  const configPath = getConfigPath(homeDir);
  await fs.writeFile(configPath, `${JSON.stringify({
    oauth: {
      accessToken: 'expired-soon-token',
      refreshToken: 'refresh-me',
      expiresAt: Date.now() + 1_000,
      scope: 'shorten:create user:read',
      clientId: 'leaflet-cli',
    },
  }, null, 2)}\n`, 'utf8');

  const fetchStub = createFetchStub([
    jsonResponse({
      id: 2,
      username: 'regularuser',
      role: 'user',
      scopes: ['shorten:create', 'user:read'],
    }, { status: 200 }),
  ]);

  const result = await invokeCli([
    'auth',
    'status',
    '--json',
  ], {
    homeDir,
    fetchStub,
    oauthDeps: {
      isTokenExpiringSoon: () => true,
      refreshAccessToken: async (params: Record<string, string>) => {
        assert.equal(params.refreshToken, 'refresh-me');
        assert.equal(params.clientId, 'leaflet-cli');
        return oauthTokenResponse({
          access_token: 'refreshed-access-token',
          refresh_token: 'rotated-refresh-token',
          scope: 'shorten:create user:read',
        });
      },
    },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(fetchStub.calls[0].init?.headers?.Authorization, 'Bearer refreshed-access-token');

  const storedConfig = await readStoredConfig(homeDir);
  assert.equal(storedConfig.oauth?.accessToken, 'refreshed-access-token');
  assert.equal(storedConfig.oauth?.refreshToken, 'rotated-refresh-token');
});

test('auth status returns a structured error when the OAuth token is invalid', async () => {
  const homeDir = await makeTempHome();
  const configPath = getConfigPath(homeDir);
  await fs.writeFile(configPath, `${JSON.stringify({
    oauth: {
      accessToken: 'bad-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3_600_000,
      scope: 'shorten:create user:read',
      clientId: 'leaflet-cli',
    },
  }, null, 2)}\n`, 'utf8');

  const fetchStub = createFetchStub([
    jsonResponse({ error: 'Invalid or expired bearer token.' }, { status: 401 }),
  ]);

  const result = await invokeCli([
    'auth',
    'status',
    '--json',
  ], { homeDir, fetchStub });

  assert.equal(result.exitCode, 1);

  const payload = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(payload.success, false);
  assert.match(String(payload.error), /invalid or expired bearer token/i);
  assert.match(String(payload.hint), /auth login/i);
});

test('auth status returns a structured error when the OAuth token lacks user:read', async () => {
  const homeDir = await makeTempHome();
  const configPath = getConfigPath(homeDir);
  await fs.writeFile(configPath, `${JSON.stringify({
    oauth: {
      accessToken: 'scopeless-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3_600_000,
      scope: 'shorten:create',
      clientId: 'leaflet-cli',
    },
  }, null, 2)}\n`, 'utf8');

  const fetchStub = createFetchStub([
    jsonResponse({
      error: 'Insufficient scope.',
      hint: "Re-authenticate requesting the 'user:read' scope.",
    }, { status: 403 }),
  ]);

  const result = await invokeCli([
    'auth',
    'status',
    '--json',
  ], { homeDir, fetchStub });

  assert.equal(result.exitCode, 1);

  const payload = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(payload.success, false);
  assert.match(String(payload.error), /insufficient scope/i);
  assert.match(String(payload.hint), /user:read/i);
});

test('shorten accepts 60m, creates an anonymous session, and sends the CSRF cookie', async () => {
  const homeDir = await makeTempHome();
  const csrfHeaders = new Headers({
    'content-type': 'application/json',
    'set-cookie': 'connect.sid=test-session; Path=/; HttpOnly',
  });

  const fetchStub = createFetchStub([
    new Response(JSON.stringify({ csrfToken: 'csrf-value' }), {
      status: 200,
      headers: csrfHeaders,
    }),
    jsonResponse({
      shortCode: 'abc123',
      shortUrl: 'http://localhost:5173/s/abc123',
      expiresAt: '2026-04-08T18:00:00.000Z',
    }, { status: 201 }),
  ]);

  const result = await invokeCli([
    'shorten',
    'https://example.com',
    '--ttl',
    '60m',
    '--json',
  ], { homeDir, fetchStub });

  assert.equal(result.exitCode, 0);

  const payload = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(payload.success, true);
  assert.equal(payload.ttl, '60m');
  assert.equal(payload.mode, 'anonymous');

  assert.equal(fetchStub.calls.length, 2);
  assert.equal(fetchStub.calls[0].url, 'https://leaflet.lair.nntin.xyz/auth/csrf-token');
  assert.equal(fetchStub.calls[1].url, 'https://leaflet.lair.nntin.xyz/api/shorten');
  assert.equal(fetchStub.calls[1].init?.headers?.Cookie, 'connect.sid=test-session');
  assert.equal(fetchStub.calls[1].init?.headers?.['X-CSRF-Token'], 'csrf-value');
});

test('shorten with stored OAuth credentials sends a Bearer header and skips CSRF', async () => {
  const homeDir = await makeTempHome();
  const configPath = getConfigPath(homeDir);
  await fs.writeFile(configPath, `${JSON.stringify({
    oauth: {
      accessToken: 'oauth-access-token',
      refreshToken: 'oauth-refresh-token',
      expiresAt: Date.now() + 3_600_000,
      scope: 'shorten:create user:read',
      clientId: 'leaflet-cli',
    },
  }, null, 2)}\n`, 'utf8');

  const fetchStub = createFetchStub([
    jsonResponse({
      shortCode: 'xyz789',
      shortUrl: 'http://localhost:5173/s/xyz789',
      expiresAt: null,
    }, { status: 201 }),
  ]);

  const result = await invokeCli([
    'shorten',
    'https://example.com',
    '--ttl',
    '24h',
    '--json',
  ], { homeDir, fetchStub });

  assert.equal(result.exitCode, 0);
  assert.equal(fetchStub.calls.length, 1);
  assert.equal(fetchStub.calls[0].url, 'https://leaflet.lair.nntin.xyz/api/shorten');
  assert.equal(fetchStub.calls[0].init?.headers?.Authorization, 'Bearer oauth-access-token');
  assert.equal(fetchStub.calls[0].init?.headers?.Cookie, undefined);
});

test('delete succeeds with stored OAuth credentials', async () => {
  const homeDir = await makeTempHome();
  const configPath = getConfigPath(homeDir);
  await fs.writeFile(configPath, `${JSON.stringify({
    oauth: {
      accessToken: 'oauth-access-token',
      refreshToken: 'oauth-refresh-token',
      expiresAt: Date.now() + 3_600_000,
      scope: 'urls:delete user:read',
      clientId: 'leaflet-cli',
    },
  }, null, 2)}\n`, 'utf8');

  const fetchStub = createFetchStub([
    jsonResponse({ message: 'URL deleted.' }, { status: 200 }),
  ]);

  const result = await invokeCli([
    'delete',
    '42',
    '--json',
  ], { homeDir, fetchStub });

  assert.equal(result.exitCode, 0);

  const payload = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(payload.success, true);
  assert.equal(payload.deleted, true);

  assert.equal(fetchStub.calls[0].url, 'https://leaflet.lair.nntin.xyz/admin/urls/42');
  assert.equal(fetchStub.calls[0].init?.headers?.Authorization, 'Bearer oauth-access-token');
});

test('delete requires OAuth authentication and shows an actionable error', async () => {
  const homeDir = await makeTempHome();
  const fetchStub = createFetchStub([]);

  const result = await invokeCli([
    'delete',
    '42',
    '--json',
  ], { homeDir, fetchStub });

  assert.equal(result.exitCode, 1);
  assert.equal(fetchStub.calls.length, 0);

  const payload = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(payload.success, false);
  assert.match(String(payload.error), /requires oauth authentication/i);
  assert.match(String(payload.hint), /auth login/i);
});
