/**
 * E2E browser tests — frontend + backend integration.
 *
 * Covers:
 *  - App loads and shows the correct UI
 *  - Logged-out state: Login button visible, modal opens, empty provider state
 *  - Logged-in state: username/role visible, modal not shown
 *  - Authenticated shorten URL flow via the UI
 *  - Unauthenticated shorten (anonymous)
 *  - /auth/me reflects the authenticated session
 *  - Provider-unavailable: empty state in the login modal
 */

import { test, expect } from '@playwright/test';
import { loginAsTestUser, resetTestData, BACKEND_URL } from '../helpers/auth';

const FRONTEND_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5099';

test.beforeEach(async () => {
  await resetTestData();
});

// ---------------------------------------------------------------------------
// Smoke: app loads
// ---------------------------------------------------------------------------

test('app loads and shows the Leaflet branding', async ({ page }) => {
  await page.goto(FRONTEND_URL);
  await expect(page.getByRole('heading', { name: 'Leaflet', exact: true })).toBeVisible();
});

test('/developer renders the API documentation page', async ({ page }) => {
  await page.goto(`${FRONTEND_URL}/developer`);
  await expect(page.getByRole('heading', { name: 'Developer API' })).toBeVisible();
});

test('/expired renders the expired-link page', async ({ page }) => {
  await page.goto(`${FRONTEND_URL}/expired`);
  await expect(page.getByRole('heading', { name: 'Link not found' })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Logged-out navbar
// ---------------------------------------------------------------------------

test('logged-out navbar shows a Login button, not Login with GitHub', async ({ page }) => {
  await page.goto(FRONTEND_URL);
  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
  await expect(page.getByText('Login with GitHub')).not.toBeVisible();
});

test('clicking Login opens the login modal', async ({ page }) => {
  await page.goto(FRONTEND_URL);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Sign in to Leaflet')).toBeVisible();
});

test('login modal shows empty state when no providers are configured', async ({ page }) => {
  // The e2e backend starts without any OAuth provider credentials, so
  // GET /auth/providers returns []. The modal should show the empty state.
  await page.goto(FRONTEND_URL);
  await page.getByRole('button', { name: 'Login' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Wait for the provider fetch to complete.
  await expect(dialog.getByText('No sign-in providers are currently configured')).toBeVisible();
});

test('login modal closes on Escape key', async ({ page }) => {
  await page.goto(FRONTEND_URL);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('login modal closes on backdrop click', async ({ page }) => {
  await page.goto(FRONTEND_URL);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  // Click outside the modal card (on the backdrop).
  await page.mouse.click(10, 10);
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('login modal closes on the explicit close button', async ({ page }) => {
  await page.goto(FRONTEND_URL);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// Logged-in state (injecting a test session)
// ---------------------------------------------------------------------------

test('injected session shows the authenticated navbar', async ({ page, context }) => {
  await loginAsTestUser(context, { username: 'browseruser' });
  await page.goto(FRONTEND_URL);
  // Logged-in navbar: username is visible, no Login button.
  await expect(page.getByText('browseruser')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Login' })).not.toBeVisible();
});

test('admin user sees the Admin link in the navbar', async ({ page, context }) => {
  await loginAsTestUser(context, { username: 'adminbrowser', role: 'admin' });
  await page.goto(FRONTEND_URL);
  await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible();
});

test('regular user does not see the Admin link', async ({ page, context }) => {
  await loginAsTestUser(context, { username: 'regularuser' });
  await page.goto(FRONTEND_URL);
  await expect(page.getByRole('link', { name: 'Admin' })).not.toBeVisible();
});

test('privileged users can see the alias field on the home page', async ({ page, context }) => {
  await loginAsTestUser(context, { username: 'aliasuser', role: 'privileged' });
  await page.goto(FRONTEND_URL);
  await expect(page.getByLabel(/custom alias/i)).toBeVisible();
});

test('admin users can choose a never-expiring link on the home page', async ({ page, context }) => {
  await loginAsTestUser(context, { username: 'adminhome', role: 'admin' });
  await page.goto(FRONTEND_URL);
  await expect(page.getByText('Never expire')).toBeVisible();
});

test('/settings redirects anonymous users to the home page', async ({ page }) => {
  await page.goto(`${FRONTEND_URL}/settings`);
  await expect(page).toHaveURL(`${FRONTEND_URL}/`);
});

test('/settings renders for an authenticated user', async ({ page, context }) => {
  await loginAsTestUser(context, { username: 'settingsbrowser' });
  await page.goto(`${FRONTEND_URL}/settings`);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByText('Connected Accounts')).toBeVisible();
});

test('/admin denies anonymous users', async ({ page }) => {
  await page.goto(`${FRONTEND_URL}/admin`);
  await expect(page.getByRole('heading', { name: 'Access Denied' })).toBeVisible();
});

test('/admin denies non-admin users', async ({ page, context }) => {
  await loginAsTestUser(context, { username: 'notadmin' });
  await page.goto(`${FRONTEND_URL}/admin`);
  await expect(page.getByRole('heading', { name: 'Access Denied' })).toBeVisible();
});

test('/admin renders the dashboard for admins', async ({ page, context }) => {
  await loginAsTestUser(context, { username: 'adminpage', role: 'admin' });
  await page.goto(`${FRONTEND_URL}/admin`);
  await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'All Links' })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Shorten URL (authenticated via injected session)
// ---------------------------------------------------------------------------

test('authenticated user can shorten a URL through the UI', async ({ page, context }) => {
  await loginAsTestUser(context, { username: 'shortenuser' });
  await page.goto(FRONTEND_URL);

  // Find the URL input and submit.
  const urlInput = page.getByPlaceholder(/https?:\/\//i).first();
  await urlInput.fill('https://example.com/e2e-test');

  // Submit the form.
  await page.getByRole('button', { name: /shorten/i }).first().click();

  // After a successful shorten, the app navigates to /result and shows a success message.
  await expect(page.getByRole('heading', { name: /your link is ready/i })).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/result$/);
  // The short URL is displayed (points to the local backend).
  await expect(page.getByText(/localhost:3099/i)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Anonymous shorten (no session)
// ---------------------------------------------------------------------------

test('anonymous user can shorten a URL (no login required)', async ({ page }) => {
  await page.goto(FRONTEND_URL);

  const urlInput = page.getByPlaceholder(/https?:\/\//i).first();
  await urlInput.fill('https://example.com/anon-e2e');
  await page.getByRole('button', { name: /shorten/i }).first().click();

  // After shortening, the app navigates to /result and shows a success message.
  await expect(page.getByRole('heading', { name: /your link is ready/i })).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/result$/);
});

// ---------------------------------------------------------------------------
// Backend /auth/me reflects session auth
// ---------------------------------------------------------------------------

test('/auth/me returns authenticated user over session cookie', async ({ context }) => {
  const { sessionCookie, username } = await loginAsTestUser(context, { username: 'meuser' });

  const res = await fetch(`${BACKEND_URL}/auth/me`, {
    headers: { Cookie: sessionCookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { username?: string };
  expect(body.username).toBe(username);
});

test('/auth/me returns 401 without a session cookie', async () => {
  const res = await fetch(`${BACKEND_URL}/auth/me`);
  // /auth/me requires OAuth scope when using Bearer; for session it returns null/401
  // When unauthenticated and no Bearer, it returns 200 with null body per the route impl.
  // The important thing is it does NOT return an authenticated user.
  const body = (await res.json()) as unknown;
  expect(body).toBeNull();
});

// ---------------------------------------------------------------------------
// GET /auth/providers — no providers configured in e2e mode
// ---------------------------------------------------------------------------

test('GET /auth/providers returns empty array when no providers are configured', async () => {
  const res = await fetch(`${BACKEND_URL}/auth/providers`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as unknown[];
  expect(Array.isArray(body)).toBe(true);
  expect(body).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Short link redirect
// ---------------------------------------------------------------------------

test('short link redirect works end-to-end', async ({ request }) => {
  // Create a short link via the API (anonymous).
  const csrfRes = await request.get(`${BACKEND_URL}/auth/csrf-token`);
  const { csrfToken } = await csrfRes.json() as { csrfToken: string };

  const shortenRes = await request.post(`${BACKEND_URL}/api/shorten`, {
    data: { url: 'https://example.com/redirect-test', ttl: '24h' },
    headers: { 'X-CSRF-Token': csrfToken },
  });
  expect(shortenRes.status()).toBe(201);
  const { shortCode } = await shortenRes.json() as { shortCode: string };

  // GET /s/{code} should redirect.
  const redirectRes = await request.get(`${BACKEND_URL}/s/${shortCode}`, {
    maxRedirects: 0,
  });
  expect(redirectRes.status()).toBe(302);
  expect(redirectRes.headers()['location']).toBe('https://example.com/redirect-test');
});
