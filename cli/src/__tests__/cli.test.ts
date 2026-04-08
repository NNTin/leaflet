import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Headers, Response } from 'node-fetch';
import { getConfigPath, readStoredConfig } from '../config';
import { runCli } from '../cli';

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

function createFetchStub(responses: Array<Response | ((url: string, init?: FetchCall['init']) => Response)>): FetchStub {
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

async function invokeCli(args: string[], options: {
  homeDir: string;
  env?: NodeJS.ProcessEnv;
  fetchStub: FetchStub;
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
  });

  return { exitCode, stdout, stderr };
}

test('auth login stores the token after validating a non-admin token', async () => {
  const homeDir = await makeTempHome();
  const fetchStub = createFetchStub([
    jsonResponse({ error: 'Admin access required.' }, { status: 403 }),
  ]);

  const result = await invokeCli([
    'auth',
    'login',
    '--token',
    'test-token',
    '--server',
    'http://localhost:3001',
    '--json',
  ], { homeDir, fetchStub });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');

  const payload = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(payload.success, true);
  assert.equal(payload.authStatus, 'authenticated');
  assert.equal(payload.tokenSource, 'config');

  const storedConfig = await readStoredConfig(homeDir);
  assert.equal(storedConfig.token, 'test-token');
  assert.equal(storedConfig.server, 'http://localhost:3001');
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
  assert.equal(fetchStub.calls[0].url, 'http://localhost:3001/auth/csrf-token');
  assert.equal(fetchStub.calls[1].url, 'http://localhost:3001/api/shorten');
  assert.equal(fetchStub.calls[1].init?.headers?.Cookie, 'connect.sid=test-session');
  assert.equal(fetchStub.calls[1].init?.headers?.['X-CSRF-Token'], 'csrf-value');

  const requestBody = JSON.parse(fetchStub.calls[1].init?.body ?? '{}') as Record<string, unknown>;
  assert.equal(requestBody.ttl, '1h');
});

test('auth status reports anonymous mode when no token is configured', async () => {
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
});

test('auth status returns a structured error when the token is invalid', async () => {
  const homeDir = await makeTempHome();
  const configPath = getConfigPath(homeDir);
  await fs.writeFile(configPath, `${JSON.stringify({ token: 'bad-token', server: 'http://localhost:3001' }, null, 2)}\n`, 'utf8');

  const fetchStub = createFetchStub([
    jsonResponse({ error: 'Authentication required.' }, { status: 401 }),
  ]);

  const result = await invokeCli([
    'auth',
    'status',
    '--json',
  ], { homeDir, fetchStub });

  assert.equal(result.exitCode, 1);

  const payload = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(payload.success, false);
  assert.match(String(payload.error), /token was rejected/i);
  assert.match(String(payload.hint), /auth login/i);
});

test('missing required arguments produce machine-readable commander errors', async () => {
  const homeDir = await makeTempHome();
  const fetchStub = createFetchStub([]);

  const result = await invokeCli([
    'shorten',
    '--json',
  ], { homeDir, fetchStub });

  assert.equal(result.exitCode, 1);

  const payload = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(payload.success, false);
  assert.match(String(payload.error), /missing required argument/i);
  assert.equal(payload.usage, 'leaflet-cli shorten <url> [options]');
});
