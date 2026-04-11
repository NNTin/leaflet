/**
 * E2E CLI test helpers.
 * Runs the leaflet-cli as a real child process and drives the PKCE auth flow
 * programmatically so tests do not depend on a real browser or OAuth provider.
 */

import { spawn, SpawnOptions } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const CLI_BIN = path.resolve(__dirname, '../../cli/dist/index.js');
export const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3099';

// ---------------------------------------------------------------------------
// Temp home directory management
// ---------------------------------------------------------------------------

/** Creates an isolated temp HOME so CLI config doesn't bleed between tests. */
export async function makeTempHome(): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'leaflet-e2e-cli-'));
}

/** Removes the temp directory. */
export async function cleanupTempHome(dir: string): Promise<void> {
  await fs.promises.rm(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// CLI runner
// ---------------------------------------------------------------------------

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Runs leaflet-cli with the given args and returns the output once it exits. */
export function runCli(args: string[], homeDir: string, env: NodeJS.ProcessEnv = {}): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const spawnEnv: NodeJS.ProcessEnv = {
      HOME: homeDir,
      LEAFLET_SERVER: BACKEND_URL,
      PATH: process.env.PATH,
      ...env,
    };

    const proc = spawn('node', [CLI_BIN, ...args], {
      env: spawnEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    } as SpawnOptions);

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('error', reject);
    proc.on('close', (code) => {
      resolve({ exitCode: code ?? 0, stdout, stderr });
    });
  });
}

// ---------------------------------------------------------------------------
// PKCE auth flow driver
// ---------------------------------------------------------------------------

/**
 * Completes the full CLI PKCE auth flow programmatically:
 *
 * 1. Starts `leaflet-cli auth login --callback-port <port>` as a child process.
 * 2. Extracts the authorization URL from the CLI's verbose output.
 * 3. Creates a test user session via POST /auth/e2e/login.
 * 4. GETs /oauth/authorize (with session cookie) → receives consent HTML.
 * 5. POSTs /oauth/authorize/consent (with session + CSRF token).
 * 6. Follows the redirect to the CLI callback server.
 * 7. Waits for the CLI process to finish saving tokens.
 *
 * Returns the CLI stdout/stderr after it exits.
 */
export async function driveCliPkceLogin(
  homeDir: string,
  options: { callbackPort?: number; username?: string; role?: string } = {},
): Promise<CliResult> {
  const callbackPort = options.callbackPort ?? 39877;
  const username = options.username ?? 'e2e-cli-user';
  const role = options.role ?? 'user';

  return new Promise((resolve, reject) => {
    // Start the CLI in the background.
    const proc = spawn(
      'node',
      [CLI_BIN, 'auth', 'login', '--callback-port', String(callbackPort), '--verbose'],
      {
        env: { HOME: homeDir, LEAFLET_SERVER: BACKEND_URL, PATH: process.env.PATH },
        stdio: ['ignore', 'pipe', 'pipe'],
      } as SpawnOptions,
    );

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    // Scan accumulated stderr for the authorization URL.
    // We fire on each new data chunk and search the full accumulated buffer
    // to handle URL being split across multiple chunks.
    let authorizeUrlFound = false;

    proc.stderr?.on('data', async (_chunk: Buffer) => {
      if (authorizeUrlFound) return;
      const match = stderr.match(/http:\/\/localhost:\d+\/oauth\/authorize\?[^\s]+/);
      if (!match) return;

      authorizeUrlFound = true;
      const authorizeUrl = match[0];

      try {
        await completeOAuthFlow(authorizeUrl, username, role, callbackPort);
      } catch (err) {
        proc.kill();
        reject(err);
      }
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      resolve({ exitCode: code ?? 0, stdout, stderr });
    });

    // Safety timeout — the CLI has its own 120s timeout; we set 90s here.
    setTimeout(() => {
      if (!authorizeUrlFound) {
        proc.kill();
        reject(new Error('Timed out waiting for CLI to print the authorization URL'));
      }
    }, 90_000);
  });
}

/**
 * Drives the OAuth authorize → consent → callback redirect chain using
 * raw HTTP requests (no browser).
 */
async function completeOAuthFlow(
  authorizeUrl: string,
  username: string,
  role: string,
  callbackPort: number,
): Promise<void> {
  // Step 1: Create a test session.
  const loginRes = await fetch(`${BACKEND_URL}/e2e/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, role }),
  });
  if (!loginRes.ok) {
    throw new Error(`Test login failed: ${loginRes.status}`);
  }

  const setCookieHeader = loginRes.headers.get('set-cookie');
  if (!setCookieHeader) {
    throw new Error('No Set-Cookie from /auth/e2e/login');
  }
  const sessionCookie = setCookieHeader.split(';')[0].trim();

  // Step 2: GET /oauth/authorize — backend returns consent HTML.
  const authRes = await fetch(authorizeUrl, {
    headers: { Cookie: sessionCookie },
    redirect: 'follow',
  });
  if (!authRes.ok) {
    throw new Error(`GET /oauth/authorize failed: ${authRes.status}`);
  }

  const consentHtml = await authRes.text();
  const csrfMatch = consentHtml.match(/<input\s+type="hidden"\s+name="_csrf"\s+value="([^"]+)"/);
  if (!csrfMatch) {
    throw new Error('Could not find _csrf token in consent page HTML');
  }
  const csrfToken = csrfMatch[1];

  // Step 3: POST consent approval.
  const consentRes = await fetch(`${BACKEND_URL}/oauth/authorize/consent`, {
    method: 'POST',
    headers: {
      Cookie: sessionCookie,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `approved=true&_csrf=${encodeURIComponent(csrfToken)}`,
    redirect: 'manual',
  });

  // Backend redirects to http://127.0.0.1:<callbackPort>/callback?code=...
  const location = consentRes.headers.get('location');
  if (!location) {
    const body = await consentRes.text().catch(() => '');
    throw new Error(`Consent POST did not redirect. Status: ${consentRes.status}. Body: ${body}`);
  }

  // Step 4: Hit the CLI callback URL to hand the code to the CLI process.
  // The CLI's local callback server is listening at this URL.
  const callbackRes = await fetch(location);
  if (!callbackRes.ok) {
    throw new Error(`CLI callback request failed: ${callbackRes.status}`);
  }
}
