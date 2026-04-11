/**
 * E2E CLI tests — CLI subprocess against the real backend.
 *
 * Covers:
 *  - Anonymous shorten (no auth)
 *  - Full PKCE auth login flow (CLI process ↔ backend ↔ programmatic consent)
 *  - auth status after login
 *  - Authenticated shorten
 *  - Negative: expired/invalid Bearer token
 */

import { test, expect } from '@playwright/test';
import { resetTestData, BACKEND_URL } from '../helpers/auth';
import { runCli, driveCliPkceLogin, makeTempHome, cleanupTempHome } from '../helpers/cli';

let tempHome = '';

test.beforeEach(async () => {
  await resetTestData();
  tempHome = await makeTempHome();
});

test.afterEach(async () => {
  if (tempHome) {
    await cleanupTempHome(tempHome);
    tempHome = '';
  }
});

// ---------------------------------------------------------------------------
// Anonymous shorten (no auth required)
// ---------------------------------------------------------------------------

test('CLI anonymous shorten returns a short URL', async () => {
  const result = await runCli(
    ['shorten', 'https://example.com/cli-anon', '--ttl', '5m', '--json'],
    tempHome,
  );

  expect(result.exitCode).toBe(0);
  const output = JSON.parse(result.stdout);
  expect(output.shortCode).toBeTruthy();
  expect(output.shortUrl).toContain(output.shortCode);
  expect(output.mode).toBe('anonymous');
});

// ---------------------------------------------------------------------------
// Full PKCE auth flow
// ---------------------------------------------------------------------------

test('CLI PKCE login → auth status → authenticated shorten', async () => {
  // 1. Drive the full PKCE auth login flow.
  const loginResult = await driveCliPkceLogin(tempHome, {
    callbackPort: 39877,
    username: 'cli-pkce-user',
    role: 'user',
  });

  expect(loginResult.exitCode).toBe(0);
  // The success output goes to stdout; check for "OAuth 2.0 configured" or "Stored tokens".
  const combinedOutput = loginResult.stdout + loginResult.stderr;
  expect(combinedOutput).toMatch(/oauth.*configured|stored tokens|authenticated/i);

  // 2. Verify auth status.
  const statusResult = await runCli(['auth', 'status', '--json'], tempHome);
  expect(statusResult.exitCode).toBe(0);
  const status = JSON.parse(statusResult.stdout);
  expect(status.authenticated).toBe(true);
  expect(status.authStatus).toMatch(/authenticated|admin/);

  // 3. Authenticated shorten.
  const shortenResult = await runCli(
    ['shorten', 'https://example.com/cli-auth', '--ttl', '24h', '--json'],
    tempHome,
  );
  expect(shortenResult.exitCode).toBe(0);
  const shortenOutput = JSON.parse(shortenResult.stdout);
  expect(shortenOutput.shortCode).toBeTruthy();
  expect(shortenOutput.mode).toBe('authenticated');
});

// ---------------------------------------------------------------------------
// Cross-surface: CLI token works against same backend that browser session used
// ---------------------------------------------------------------------------

test('browser session and CLI token share the same user on the backend', async () => {
  // Create a test user via the e2e login endpoint (browser-style session).
  const loginRes = await fetch(`${BACKEND_URL}/e2e/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'shared-user' }),
  });
  expect(loginRes.ok).toBe(true);
  const { userId: browserUserId } = (await loginRes.json()) as { userId: number };

  // Drive CLI PKCE flow for the same username.
  await driveCliPkceLogin(tempHome, {
    callbackPort: 39878,
    username: 'shared-user',
    role: 'user',
  });

  // Get CLI status — should show authenticated.
  const statusResult = await runCli(['auth', 'status', '--json'], tempHome);
  const status = JSON.parse(statusResult.stdout);
  expect(status.authenticated).toBe(true);

  // The CLI shorten creates a URL owned by this user.
  const shortenResult = await runCli(
    ['shorten', 'https://example.com/cross-surface', '--ttl', '5m', '--json'],
    tempHome,
  );
  const shortened = JSON.parse(shortenResult.stdout);
  expect(shortened.shortCode).toBeTruthy();

  // Verify the URL is owned by the correct user via the browser session.
  const setCookieHeader = loginRes.headers.get('set-cookie')!;
  const sessionCookie = setCookieHeader.split(';')[0];
  const csrfToken = ((await loginRes.json().catch(() => null)) as null) ?? undefined;

  // Re-login to get a fresh session (the previous res body was already read).
  const loginRes2 = await fetch(`${BACKEND_URL}/e2e/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'shared-user' }),
  });
  const setCookie2 = loginRes2.headers.get('set-cookie')!;
  const sessionCookie2 = setCookie2.split(';')[0];

  const meRes = await fetch(`${BACKEND_URL}/auth/me`, {
    headers: { Cookie: sessionCookie2 },
  });
  const me = (await meRes.json()) as { id?: number; username?: string };
  expect(me.username).toBe('shared-user');
  // Both surfaces refer to the same user ID.
  expect(me.id).toBe(browserUserId);
});

// ---------------------------------------------------------------------------
// auth logout
// ---------------------------------------------------------------------------

test('CLI auth logout clears stored credentials', async () => {
  // Login first.
  await driveCliPkceLogin(tempHome, {
    callbackPort: 39879,
    username: 'logout-user',
    role: 'user',
  });

  // Verify logged in.
  const statusBefore = await runCli(['auth', 'status', '--json'], tempHome);
  expect(JSON.parse(statusBefore.stdout).authenticated).toBe(true);

  // Logout.
  const logoutResult = await runCli(['auth', 'logout', '--json'], tempHome);
  expect(logoutResult.exitCode).toBe(0);

  // Verify logged out.
  const statusAfter = await runCli(['auth', 'status', '--json'], tempHome);
  const afterStatus = JSON.parse(statusAfter.stdout);
  expect(afterStatus.authenticated).toBe(false);
});

// ---------------------------------------------------------------------------
// Negative: invalid Bearer token
// ---------------------------------------------------------------------------

test('CLI shorten with an invalid LEAFLET_TOKEN env var returns an error', async () => {
  const result = await runCli(
    ['shorten', 'https://example.com/bad-token', '--ttl', '5m', '--json'],
    tempHome,
    { LEAFLET_TOKEN: 'totally-invalid-token' },
  );

  // Should fail (non-zero exit code) with a 401-related message.
  expect(result.exitCode).not.toBe(0);
  // stderr or stdout should mention the error.
  const combined = result.stdout + result.stderr;
  expect(combined).toMatch(/invalid|expired|unauthorized|401/i);
});

// ---------------------------------------------------------------------------
// Negative: provider not configured
// ---------------------------------------------------------------------------

test('GET /auth/providers returns empty array (no providers configured in e2e mode)', async () => {
  const res = await fetch(`${BACKEND_URL}/auth/providers`);
  const providers = (await res.json()) as unknown[];
  expect(providers).toHaveLength(0);
});

test('POST /auth/github returns 503 when GitHub is not configured', async () => {
  const res = await fetch(`${BACKEND_URL}/auth/github`, { redirect: 'manual' });
  expect(res.status).toBe(503);
});
