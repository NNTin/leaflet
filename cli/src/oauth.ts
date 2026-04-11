/**
 * OAuth 2.0 PKCE flow for the Leaflet CLI.
 *
 * Implements the Authorization Code flow with PKCE (RFC 7636) using a
 * temporary localhost HTTP server as the redirect URI (RFC 8252).
 */

import http from 'http';
import crypto from 'crypto';
import { URL } from 'url';

/** Stored OAuth token set, persisted in ~/.leafletrc under `oauth`. */
export interface StoredOAuth {
  accessToken: string;
  refreshToken: string;
  /** Unix timestamp in milliseconds when the access token expires. */
  expiresAt: number;
  scope: string;
  clientId: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

/** Generates a cryptographically random PKCE code verifier (43-128 chars). */
export function generateCodeVerifier(): string {
  return crypto.randomBytes(48).toString('base64url').slice(0, 96);
}

/** Computes the S256 code_challenge from a verifier. */
export function computeCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/** Generates a random state parameter for CSRF protection. */
export function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

/** Escapes special HTML characters to prevent XSS in inline content. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Renders a minimal HTML page for the OAuth callback browser tab. */
function callbackHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${title} - Leaflet</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5}
.card{background:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.12);padding:2rem;max-width:440px;text-align:center}
h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#555}</style></head>
<body><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`;
}

/**
 * Starts a temporary HTTP server on an ephemeral localhost port and waits
 * for the OAuth callback request.
 *
 * Returns both the server's port (resolved immediately after listen) and a
 * promise for the authorization code (resolved when the browser hits the
 * callback URL). This lets the caller build the authorization URL before
 * the browser redirect arrives.
 *
 * @param expectedState - the `state` value sent in the authorization URL
 * @param timeoutMs     - how long to wait for the browser to complete the flow
 */
export function startCallbackServer(
  expectedState: string,
  timeoutMs = 120_000,
): { port: Promise<number>; result: Promise<string> } {
  let portResolve!: (port: number) => void;
  let codeResolve!: (code: string) => void;
  let reject!: (err: Error) => void;

  const portPromise = new Promise<number>((res) => { portResolve = res; });
  const resultPromise = new Promise<string>((res, rej) => {
    codeResolve = res;
    reject = rej;
  });

  const server = http.createServer((req, res) => {
    if (!req.url) {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }

    const parsed = new URL(req.url, 'http://localhost');
    if (parsed.pathname !== '/callback') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const error = parsed.searchParams.get('error');
    const code = parsed.searchParams.get('code');
    const returnedState = parsed.searchParams.get('state');

    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(callbackHtml('Authorization denied', `The authorization request was denied: <code>${escapeHtml(error)}</code>. You can close this tab.`));
      server.close();
      reject(new Error(`Authorization denied: ${error}`));
      return;
    }

    if (!code || returnedState !== expectedState) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(callbackHtml('Invalid response', 'Unexpected response from the authorization server. You can close this tab.'));
      server.close();
      reject(new Error('Invalid OAuth callback: missing code or state mismatch'));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(callbackHtml('Authorization successful', 'You have successfully authorized the Leaflet CLI. You can close this tab.'));
    server.close();
    codeResolve(code);
  });

  const timeout = setTimeout(() => {
    server.close();
    reject(new Error('OAuth login timed out. No callback received within 2 minutes.'));
  }, timeoutMs);

  server.on('close', () => clearTimeout(timeout));
  server.on('error', (err) => reject(err as Error));

  server.listen(0, '127.0.0.1', () => {
    const addr = server.address() as { port: number };
    portResolve(addr.port);
  });

  return { port: portPromise, result: resultPromise };
}

/** Opens a URL in the system default browser. */
export async function openBrowser(url: string): Promise<void> {
  const { spawn } = await import('child_process');

  // Pass the URL as a separate argument (not via shell interpolation) to
  // avoid command injection if the URL contains shell metacharacters.
  // On Windows use explorer.exe directly instead of cmd /c start to avoid
  // cmd.exe argument parsing rules (& and other metacharacters in URLs).
  const platform = process.platform;
  let cmd: string;
  if (platform === 'darwin') {
    cmd = 'open';
  } else if (platform === 'win32') {
    cmd = 'explorer.exe';
  } else {
    cmd = 'xdg-open';
  }

  const args = [url];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', reject);
    child.on('spawn', resolve);
    child.unref();
  });
}

/** Exchanges an authorization code for tokens via POST /oauth/token. */
export async function exchangeCodeForTokens(params: {
  server: string;
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<OAuthTokenResponse> {
  const { default: fetch } = await import('node-fetch');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: params.clientId,
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });

  const response = await fetch(`${params.server}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await response.json() as Record<string, unknown>;

  if (!response.ok) {
    const errCode = typeof data.error === 'string' ? data.error : 'unknown_error';
    const errDesc = typeof data.error_description === 'string' ? data.error_description : 'Unknown error';
    throw new Error(`OAuth token exchange failed (${errCode}): ${errDesc}`);
  }

  return data as unknown as OAuthTokenResponse;
}

/** Refreshes an access token using the stored refresh token. */
export async function refreshAccessToken(params: {
  server: string;
  clientId: string;
  refreshToken: string;
}): Promise<OAuthTokenResponse> {
  const { default: fetch } = await import('node-fetch');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: params.clientId,
    refresh_token: params.refreshToken,
  });

  const response = await fetch(`${params.server}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await response.json() as Record<string, unknown>;

  if (!response.ok) {
    const errCode = typeof data.error === 'string' ? data.error : 'unknown_error';
    const errDesc = typeof data.error_description === 'string' ? data.error_description : 'Unknown error';
    throw new Error(`OAuth token refresh failed (${errCode}): ${errDesc}`);
  }

  return data as unknown as OAuthTokenResponse;
}

/** Returns true if the stored access token expires within the next `bufferMs` ms. */
export function isTokenExpiringSoon(oauth: StoredOAuth, bufferMs = 60_000): boolean {
  return Date.now() + bufferMs >= oauth.expiresAt;
}
