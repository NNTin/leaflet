/**
 * E2E test authentication helpers.
 * Interact with the test-only /auth/e2e/login endpoint to set up sessions.
 */

import { BrowserContext } from '@playwright/test';

export const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3099';

export interface TestUser {
  userId: number;
  username: string;
  role: string;
  csrfToken: string;
  /** Raw session cookie value to pass in Cookie headers, e.g. "connect.sid=..." */
  sessionCookie: string;
}

/**
 * Creates (or finds) a test user and injects the resulting session cookie into
 * the Playwright browser context so subsequent page loads appear authenticated.
 */
export async function loginAsTestUser(
  context: BrowserContext,
  options: { username?: string; role?: string } = {},
): Promise<TestUser> {
  const { username = 'e2e-user', role = 'user' } = options;

  const res = await fetch(`${BACKEND_URL}/e2e/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, role }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Test login failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    success: boolean;
    userId: number;
    username: string;
    role: string;
    csrfToken: string;
  };

  // Parse session cookie from Set-Cookie header.
  const setCookieHeader = res.headers.get('set-cookie');
  if (!setCookieHeader) {
    throw new Error('Test login response did not include a Set-Cookie header');
  }
  const sessionCookie = setCookieHeader.split(';')[0].trim(); // e.g. "connect.sid=..."

  // Inject the session cookie into the browser context so the browser will
  // send it with all requests to the backend origin.
  const [cookieName, cookieValue] = sessionCookie.split('=');
  await context.addCookies([
    {
      name: cookieName,
      value: cookieValue,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  return { ...data, sessionCookie };
}

/**
 * Resets all test data (users, URLs, tokens, etc.) and re-seeds the leaflet-cli
 * OAuth client. Call in beforeEach to guarantee test isolation.
 */
export async function resetTestData(): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/e2e/reset`, { method: 'POST' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Test reset failed (${res.status}): ${text}`);
  }
}
