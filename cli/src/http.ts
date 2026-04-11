import fetch, { Headers, Response } from 'node-fetch';
import { CliError } from './errors';
import { Output } from './output';

export interface FetchRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export type FetchLike = (url: string, init?: FetchRequestInit) => Promise<Response>;

export interface ApiResult<T> {
  status: number;
  ok: boolean;
  headers: Headers;
  body: T | Record<string, unknown> | string | null;
}

export interface ShortenRequest {
  server: string;
  token: string | null;
  url: string;
  ttl: string;
  alias?: string;
}

export interface OAuthIdentity {
  id: number;
  username: string;
  role: string;
  scopes: string[];
}

interface RequestOptions {
  method: 'GET' | 'POST' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'authorization' || lowerKey === 'cookie') {
      redacted[key] = '<redacted>';
      continue;
    }

    redacted[key] = value;
  }

  return redacted;
}

function redactResponseHeaders(headers: Headers): Record<string, string> {
  const redacted = Object.fromEntries(headers.entries());

  if ('set-cookie' in redacted) {
    redacted['set-cookie'] = '<redacted>';
  }

  return redacted;
}

function extractCookies(headers: Headers): string | null {
  const rawCookies = headers.raw()['set-cookie'] ?? [];
  const cookiePairs = rawCookies
    .map((value) => value.split(';', 1)[0])
    .filter((value) => value.length > 0);

  if (cookiePairs.length === 0) {
    return null;
  }

  return cookiePairs.join('; ');
}

async function parseResponseBody(response: Response): Promise<Record<string, unknown> | string | null> {
  const text = await response.text();
  if (!text) return null;

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return text;
    }
  }

  return text;
}

export class LeafletApiClient {
  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly output: Output
  ) {}

  async getOAuthIdentity(server: string, token: string): Promise<
    | { status: 'ok'; identity: OAuthIdentity }
    | { status: 'invalid'; error: string }
    | { status: 'insufficient_scope'; error: string; hint: string | null }
  > {
    const result = await this.request({
      method: 'GET',
      url: `${server}/auth/me`,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (result.status === 200 && typeof result.body === 'object' && result.body) {
      const body = result.body as Record<string, unknown>;
      if (
        typeof body.id === 'number' &&
        typeof body.username === 'string' &&
        typeof body.role === 'string'
      ) {
        const scopes = Array.isArray(body.scopes)
          ? body.scopes.filter((value): value is string => typeof value === 'string')
          : [];

        return {
          status: 'ok',
          identity: {
            id: body.id,
            username: body.username,
            role: body.role,
            scopes,
          },
        };
      }
    }

    if (result.status === 401) {
      const body = typeof result.body === 'object' && result.body
        ? result.body as Record<string, unknown>
        : null;
      return {
        status: 'invalid',
        error: typeof body?.error === 'string'
          ? body.error
          : 'The configured OAuth access token was rejected by the server.',
      };
    }

    if (result.status === 403) {
      const body = typeof result.body === 'object' && result.body
        ? result.body as Record<string, unknown>
        : null;
      return {
        status: 'insufficient_scope',
        error: typeof body?.error === 'string' ? body.error : 'Insufficient scope.',
        hint: typeof body?.hint === 'string' ? body.hint : null,
      };
    }

    throw new CliError('Could not verify the OAuth access token against the server.', {
      hint: 'Retry the command or check that the Leaflet backend is running and reachable.',
      details: [`Server response: ${result.status}`],
    });
  }

  async shorten(request: ShortenRequest): Promise<ApiResult<Record<string, unknown>>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (request.token) {
      headers.Authorization = `Bearer ${request.token}`;
    } else {
      Object.assign(headers, await this.createAnonymousHeaders(request.server));
    }

    return this.request({
      method: 'POST',
      url: `${request.server}/api/shorten`,
      headers,
      body: {
        url: request.url,
        ttl: request.ttl,
        ...(request.alias ? { alias: request.alias } : {}),
      },
    });
  }

  async deleteUrl(server: string, token: string, id: number): Promise<ApiResult<Record<string, unknown>>> {
    return this.request({
      method: 'DELETE',
      url: `${server}/admin/urls/${id}`,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  private async createAnonymousHeaders(server: string): Promise<Record<string, string>> {
    this.output.info('Starting anonymous session and requesting a CSRF token.');

    const result = await this.request({
      method: 'GET',
      url: `${server}/auth/csrf-token`,
    });

    const csrfBody = typeof result.body === 'object' && result.body
      ? result.body as Record<string, unknown>
      : null;
    const csrfToken = typeof csrfBody?.csrfToken === 'string' ? csrfBody.csrfToken : null;
    const cookies = extractCookies(result.headers);

    if (!result.ok || !csrfToken || !cookies) {
      throw new CliError('Could not establish an anonymous session.', {
        hint: "Retry the command or authenticate with `leaflet-cli auth login`.",
      });
    }

    return {
      Cookie: cookies,
      'X-CSRF-Token': csrfToken,
    };
  }

  private async request<T>(options: RequestOptions): Promise<ApiResult<T>> {
    const headers = options.headers ?? {};
    const init: {
      method: RequestOptions['method'];
      headers: Record<string, string>;
      body?: string;
    } = {
      method: options.method,
      headers,
    };

    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }

    this.output.debug('HTTP request', {
      method: options.method,
      url: options.url,
      headers: redactHeaders(headers),
      body: options.body ?? null,
    });

    let response: Response;
    try {
      response = await this.fetchImpl(options.url, init);
    } catch (error) {
      throw new CliError(`Network request failed: ${(error as Error).message}`, {
        hint: 'Check the server URL and confirm that the Leaflet backend is reachable.',
      });
    }

    const body = await parseResponseBody(response);

    this.output.debug('HTTP response', {
      status: response.status,
      headers: redactResponseHeaders(response.headers),
      body,
    });

    return {
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      body: body as T | Record<string, unknown> | string | null,
    };
  }
}
