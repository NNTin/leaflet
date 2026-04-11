import os from 'os';
import { Command, CommanderError } from 'commander';
import fetch from 'node-fetch';
import { CliError } from './errors';
import { getConfigPath, readStoredConfig, resolveConfig, writeStoredConfig, StoredConfig } from './config';
import { ApiResult, FetchLike, LeafletApiClient } from './http';
import { CommandHelp, Output } from './output';
import {
  computeCodeChallenge,
  exchangeCodeForTokens,
  generateCodeVerifier,
  generateState,
  isTokenExpiringSoon,
  openBrowser,
  refreshAccessToken,
  startCallbackServer,
  StoredOAuth,
} from './oauth';

type SharedOptions = {
  json?: boolean;
  verbose?: boolean;
  debug?: boolean;
};

type ShortenOptions = SharedOptions & {
  ttl: string;
  alias?: string;
};

type AuthLoginOptions = SharedOptions & {
  /** Client ID for the OAuth PKCE flow (defaults to the built-in leaflet-cli client). */
  clientId?: string;
  /** Optional fixed local callback port for remote SSH forwarding workflows. */
  callbackPort?: string;
};

type DeleteOptions = SharedOptions;

type LogoutOptions = {
  json?: boolean;
  verbose?: boolean;
};

type AuthStatus = 'admin' | 'authenticated' | 'anonymous';

type OAuthDeps = {
  computeCodeChallenge: typeof computeCodeChallenge;
  exchangeCodeForTokens: typeof exchangeCodeForTokens;
  generateCodeVerifier: typeof generateCodeVerifier;
  generateState: typeof generateState;
  isTokenExpiringSoon: typeof isTokenExpiringSoon;
  openBrowser: typeof openBrowser;
  refreshAccessToken: typeof refreshAccessToken;
  startCallbackServer: typeof startCallbackServer;
};

export interface CliRuntime {
  env: NodeJS.ProcessEnv;
  homeDir: string;
  fetchImpl: FetchLike;
  writeOut: (chunk: string) => void;
  writeErr: (chunk: string) => void;
  oauthDeps?: Partial<OAuthDeps>;
}

const ROOT_HELP: CommandHelp = {
  usage: 'leaflet-cli <command> [options]',
  example: 'leaflet-cli shorten https://example.com --ttl=60m',
};

const HELP_BY_COMMAND: Record<string, CommandHelp> = {
  root: ROOT_HELP,
  shorten: {
    usage: 'leaflet-cli shorten <url> [options]',
    example: 'leaflet-cli shorten https://example.com --ttl=60m',
  },
  'auth login': {
    usage: 'leaflet-cli auth login [options]',
    example: 'leaflet-cli auth login',
  },
  'auth logout': {
    usage: 'leaflet-cli auth logout [options]',
    example: 'leaflet-cli auth logout --json',
  },
  'auth status': {
    usage: 'leaflet-cli auth status [options]',
    example: 'leaflet-cli auth status --json',
  },
  delete: {
    usage: 'leaflet-cli delete <id> [options]',
    example: 'leaflet-cli delete 42',
  },
};

const ALIAS_PATTERN = /^[a-zA-Z0-9-_]{3,50}$/;

const defaultOAuthDeps: OAuthDeps = {
  computeCodeChallenge,
  exchangeCodeForTokens,
  generateCodeVerifier,
  generateState,
  isTokenExpiringSoon,
  openBrowser,
  refreshAccessToken,
  startCallbackServer,
};

function createDefaultRuntime(): CliRuntime {
  return {
    env: process.env,
    homeDir: os.homedir(),
    fetchImpl: fetch,
    writeOut: (chunk) => process.stdout.write(chunk),
    writeErr: (chunk) => process.stderr.write(chunk),
  };
}

function resolveOAuthDeps(runtime: CliRuntime): OAuthDeps {
  return {
    ...defaultOAuthDeps,
    ...(runtime.oauthDeps ?? {}),
  };
}

function addSharedOptions(command: Command): Command {
  return command
    .option('--json', 'Output machine-readable JSON')
    .option('--verbose', 'Print additional command progress to stderr')
    .option('--debug', 'Print HTTP request and response details to stderr');
}

function createOutput(options: SharedOptions | LogoutOptions, runtime: CliRuntime): Output {
  return new Output({
    json: options.json ?? false,
    verbose: options.verbose ?? false,
    debug: 'debug' in options ? options.debug ?? false : false,
  }, {
    writeOut: runtime.writeOut,
    writeErr: runtime.writeErr,
  });
}

function createFallbackOutput(argv: string[], runtime: CliRuntime): Output {
  return new Output({
    json: argv.includes('--json'),
    verbose: argv.includes('--verbose'),
    debug: argv.includes('--debug'),
  }, {
    writeOut: runtime.writeOut,
    writeErr: runtime.writeErr,
  });
}

function stripCommanderPrefix(message: string): string {
  return message.replace(/^error:\s*/i, '');
}

function inferCommandKey(argv: string[]): keyof typeof HELP_BY_COMMAND {
  const args = argv.slice(2);
  const firstArg = args.find((arg) => !arg.startsWith('-'));

  if (firstArg === 'shorten') return 'shorten';
  if (firstArg === 'delete') return 'delete';
  if (firstArg === 'auth') {
    const authAction = args.slice(1).find((arg) => !arg.startsWith('-'));
    if (authAction === 'login') return 'auth login';
    if (authAction === 'logout') return 'auth logout';
    if (authAction === 'status') return 'auth status';
  }

  return 'root';
}

function createCommanderError(error: CommanderError, argv: string[]): CliError {
  const commandKey = inferCommandKey(argv);
  const help = HELP_BY_COMMAND[commandKey] ?? ROOT_HELP;
  const helpCommand = help.usage.replace(' [options]', '');

  switch (error.code) {
    case 'commander.missingArgument':
      return new CliError(stripCommanderPrefix(error.message), {
        hint: `Run '${helpCommand} --help' for more detail.`,
        usage: help.usage,
        example: help.example,
      });
    case 'commander.optionMissingArgument':
      return new CliError(stripCommanderPrefix(error.message), {
        hint: 'Provide the missing option value and try again.',
        usage: help.usage,
        example: help.example,
      });
    case 'commander.unknownCommand':
      return new CliError(stripCommanderPrefix(error.message), {
        hint: "Run 'leaflet-cli --help' to inspect the supported commands.",
        usage: ROOT_HELP.usage,
        example: ROOT_HELP.example,
      });
    default:
      return new CliError(stripCommanderPrefix(error.message), {
        hint: `Run '${helpCommand} --help' for more detail.`,
        usage: help.usage,
        example: help.example,
      });
  }
}

function ensureHttpUrl(urlValue: string): string {
  const trimmed = urlValue.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new CliError(`Invalid URL "${urlValue}".`, {
      hint: 'Provide a full http:// or https:// URL.',
      usage: HELP_BY_COMMAND.shorten.usage,
      example: HELP_BY_COMMAND.shorten.example,
    });
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CliError(`Invalid URL "${urlValue}".`, {
      hint: 'Only http and https URLs are supported.',
      usage: HELP_BY_COMMAND.shorten.usage,
      example: HELP_BY_COMMAND.shorten.example,
    });
  }

  return trimmed;
}

function normalizeTtl(input: string): { apiTtl: '5m' | '1h' | '24h' | 'never'; outputTtl: '5m' | '60m' | '24h' | 'never' } {
  const ttl = input.trim();

  switch (ttl) {
    case '5m':
      return { apiTtl: '5m', outputTtl: '5m' };
    case '60m':
    case '1h':
      return { apiTtl: '1h', outputTtl: '60m' };
    case '24h':
      return { apiTtl: '24h', outputTtl: '24h' };
    case 'never':
      return { apiTtl: 'never', outputTtl: 'never' };
    default:
      throw new CliError(`Invalid TTL value "${input}".`, {
        hint: "Use one of the supported TTL values or run 'leaflet-cli shorten --help'.",
        usage: HELP_BY_COMMAND.shorten.usage,
        example: HELP_BY_COMMAND.shorten.example,
        details: [
          'Allowed values:\n  5m, 60m, 24h, never',
        ],
      });
  }
}

function ensureAlias(alias: string): string {
  const trimmed = alias.trim();

  if (!ALIAS_PATTERN.test(trimmed)) {
    throw new CliError(`Invalid alias value "${alias}".`, {
      hint: 'Use 3-50 letters, numbers, hyphens, or underscores.',
      usage: HELP_BY_COMMAND.shorten.usage,
      example: 'leaflet-cli shorten https://example.com --ttl=24h --alias=my-link',
    });
  }

  return trimmed;
}

function getResponseErrorMessage(result: ApiResult<Record<string, unknown>>): string {
  if (typeof result.body === 'object' && result.body) {
    if (typeof result.body.error === 'string') {
      return result.body.error;
    }

    if (Array.isArray(result.body.errors)) {
      const messages = result.body.errors
        .map((entry) => {
          if (entry && typeof entry === 'object' && 'msg' in entry && typeof entry.msg === 'string') {
            return entry.msg;
          }

          return null;
        })
        .filter((message): message is string => Boolean(message));

      if (messages.length > 0) {
        return messages.join(', ');
      }
    }
  }

  if (typeof result.body === 'string' && result.body.length > 0) {
    return result.body;
  }

  return `Server responded with status ${result.status}.`;
}

function getResponseHint(result: ApiResult<Record<string, unknown>>): string | null {
  if (typeof result.body === 'object' && result.body && typeof result.body.hint === 'string') {
    return result.body.hint;
  }

  return null;
}

function ensureShortenBody(result: ApiResult<Record<string, unknown>>): {
  shortCode: string;
  shortUrl: string;
  expiresAt: string | null;
} {
  if (
    typeof result.body === 'object' &&
    result.body &&
    typeof result.body.shortCode === 'string' &&
    typeof result.body.shortUrl === 'string'
  ) {
    return {
      shortCode: result.body.shortCode,
      shortUrl: result.body.shortUrl,
      expiresAt: typeof result.body.expiresAt === 'string' ? result.body.expiresAt : null,
    };
  }

  throw new CliError('The server returned an unexpected response.', {
    hint: 'Retry the command or inspect the backend logs.',
  });
}

function mapShortenError(result: ApiResult<Record<string, unknown>>, context: {
  alias?: string;
  token: string | null;
  ttl: '5m' | '60m' | '24h' | 'never';
}): CliError {
  const message = getResponseErrorMessage(result);
  const hint = getResponseHint(result);

  if (result.status === 400) {
    return new CliError(message, {
      hint: "Check the URL, TTL, and alias values, or run 'leaflet-cli shorten --help'.",
      usage: HELP_BY_COMMAND.shorten.usage,
      example: HELP_BY_COMMAND.shorten.example,
    });
  }

  if (result.status === 401) {
    return new CliError(message, {
      hint: "Run 'leaflet-cli auth login' again or unset LEAFLET_TOKEN before retrying.",
      usage: HELP_BY_COMMAND.shorten.usage,
      example: HELP_BY_COMMAND.shorten.example,
    });
  }

  if (result.status === 403) {
    if (hint) {
      return new CliError(message, {
        hint,
        usage: HELP_BY_COMMAND.shorten.usage,
        example: HELP_BY_COMMAND.shorten.example,
      });
    }

    if (context.alias) {
      return new CliError(message, {
        hint: "Remove --alias or authenticate with a privileged/admin account via 'leaflet-cli auth login'.",
        usage: HELP_BY_COMMAND.shorten.usage,
        example: 'leaflet-cli auth login',
      });
    }

    if (context.ttl === 'never') {
      return new CliError(message, {
        hint: "Use an admin OAuth token with the required scope, or choose 5m, 60m, or 24h instead.",
        usage: HELP_BY_COMMAND.shorten.usage,
        example: HELP_BY_COMMAND.shorten.example,
      });
    }

    return new CliError(message, {
      hint: "Retry with valid OAuth credentials or run without authentication for anonymous mode.",
      usage: HELP_BY_COMMAND.shorten.usage,
      example: HELP_BY_COMMAND.shorten.example,
    });
  }

  if (result.status === 409) {
    return new CliError(message, {
      hint: 'Choose a different alias and try again.',
      usage: HELP_BY_COMMAND.shorten.usage,
      example: 'leaflet-cli shorten https://example.com --ttl=24h --alias=my-link-2',
    });
  }

  if (result.status === 429) {
    return new CliError(message, {
      hint: "Anonymous requests are limited to one request per minute. Wait a minute or authenticate with 'leaflet-cli auth login'.",
      usage: HELP_BY_COMMAND.shorten.usage,
      example: 'leaflet-cli auth login',
    });
  }

  return new CliError(message, {
    hint: 'Retry the command or inspect the Leaflet backend logs.',
    usage: HELP_BY_COMMAND.shorten.usage,
    example: HELP_BY_COMMAND.shorten.example,
  });
}

function mapDeleteError(result: ApiResult<Record<string, unknown>>): CliError {
  const message = getResponseErrorMessage(result);
  const hint = getResponseHint(result);

  if (result.status === 401) {
    return new CliError(message, {
      hint: "Run 'leaflet-cli auth login' again or unset LEAFLET_TOKEN before deleting links.",
      usage: HELP_BY_COMMAND.delete.usage,
      example: HELP_BY_COMMAND.delete.example,
    });
  }

  if (result.status === 403) {
    return new CliError(message, {
      hint: hint ?? "Deleting links requires an admin OAuth token with the 'urls:delete' scope.",
      usage: HELP_BY_COMMAND.delete.usage,
      example: HELP_BY_COMMAND.delete.example,
    });
  }

  if (result.status === 404) {
    return new CliError(message, {
      hint: 'Confirm the numeric link id in the admin dashboard and try again.',
      usage: HELP_BY_COMMAND.delete.usage,
      example: HELP_BY_COMMAND.delete.example,
    });
  }

  return new CliError(message, {
    hint: 'Retry the command or inspect the backend logs.',
    usage: HELP_BY_COMMAND.delete.usage,
    example: HELP_BY_COMMAND.delete.example,
  });
}

/**
 * If a stored OAuth token is present and expiring soon, attempt to refresh it
 * silently and persist the new token pair. Returns the updated config.
 * Failures are non-fatal: if refresh fails the caller will get a 401 error later.
 */
async function maybeRefreshOAuthToken(
  storedConfig: StoredConfig,
  homeDir: string,
  output: Output,
  oauthDeps: OAuthDeps,
  server: string,
): Promise<StoredConfig> {
  if (!storedConfig.oauth) return storedConfig;
  if (!oauthDeps.isTokenExpiringSoon(storedConfig.oauth)) return storedConfig;

  output.info('OAuth access token is expiring soon, refreshing…');
  try {
    const tokenResponse = await oauthDeps.refreshAccessToken({
      server,
      clientId: storedConfig.oauth.clientId,
      refreshToken: storedConfig.oauth.refreshToken,
    });

    const newOAuth: StoredOAuth = {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt: Date.now() + tokenResponse.expires_in * 1000,
      scope: tokenResponse.scope,
      clientId: storedConfig.oauth.clientId,
    };

    const updated: StoredConfig = { ...storedConfig, oauth: newOAuth };
    await writeStoredConfig(updated, homeDir);
    output.info('OAuth token refreshed successfully.');
    return updated;
  } catch (err) {
    output.info(`Could not refresh OAuth token: ${(err as Error).message}`);
    return storedConfig;
  }
}

async function handleShorten(urlValue: string, options: ShortenOptions, runtime: CliRuntime): Promise<void> {
  const output = createOutput(options, runtime);
  const oauthDeps = resolveOAuthDeps(runtime);
  let storedConfig = await readStoredConfig(runtime.homeDir);
  const server = resolveConfig({ env: runtime.env, storedConfig }).server;
  storedConfig = await maybeRefreshOAuthToken(storedConfig, runtime.homeDir, output, oauthDeps, server);
  const resolvedConfig = resolveConfig({
    env: runtime.env,
    storedConfig,
  });
  const client = new LeafletApiClient(runtime.fetchImpl, output);

  const url = ensureHttpUrl(urlValue);
  const ttl = normalizeTtl(options.ttl);
  const alias = options.alias ? ensureAlias(options.alias) : undefined;

  if (alias && !resolvedConfig.token) {
    throw new CliError('Custom aliases require OAuth authentication.', {
      hint: "Run 'leaflet-cli auth login' first, or remove --alias.",
      usage: HELP_BY_COMMAND.shorten.usage,
      example: HELP_BY_COMMAND.shorten.example,
    });
  }

  if (ttl.outputTtl === 'never' && !resolvedConfig.token) {
    throw new CliError('Indefinite links require OAuth authentication.', {
      hint: "Run 'leaflet-cli auth login' with an admin account, or choose 5m, 60m, or 24h.",
      usage: HELP_BY_COMMAND.shorten.usage,
      example: HELP_BY_COMMAND.shorten.example,
    });
  }

  output.info(`Using ${resolvedConfig.token ? 'authenticated' : 'anonymous'} mode against ${resolvedConfig.server}.`);
  if (resolvedConfig.token) {
    output.info(`Token source: ${resolvedConfig.tokenSource}.`);
  }

  const result = await client.shorten({
    server: resolvedConfig.server,
    token: resolvedConfig.token,
    url,
    ttl: ttl.apiTtl,
    alias,
  });

  if (!result.ok) {
    throw mapShortenError(result, {
      alias,
      token: resolvedConfig.token,
      ttl: ttl.outputTtl,
    });
  }

  const responseBody = ensureShortenBody(result);
  const mode = resolvedConfig.token ? 'authenticated' : 'anonymous';

  output.success({
    shortCode: responseBody.shortCode,
    shortUrl: responseBody.shortUrl,
    ttl: ttl.outputTtl,
    expiresAt: responseBody.expiresAt,
    mode,
  }, [
    `Short URL: ${responseBody.shortUrl}`,
    `Short code: ${responseBody.shortCode}`,
    `TTL: ${ttl.outputTtl}`,
    `Mode: ${mode}`,
    `Expires: ${responseBody.expiresAt ?? 'never'}`,
  ]);
}

async function handleAuthLogin(options: AuthLoginOptions, runtime: CliRuntime): Promise<void> {
  const output = createOutput(options, runtime);
  const oauthDeps = resolveOAuthDeps(runtime);
  const storedConfig = await readStoredConfig(runtime.homeDir);
  const resolvedConfig = resolveConfig({
    env: runtime.env,
    storedConfig,
  });

  const clientId = options.clientId ?? 'leaflet-cli';
  let callbackListenPort: number | undefined;
  if (options.callbackPort) {
    const parsedPort = Number.parseInt(options.callbackPort, 10);
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      throw new CliError(`Invalid callback port "${options.callbackPort}".`, {
        hint: 'Use a numeric TCP port between 1 and 65535.',
        usage: HELP_BY_COMMAND['auth login'].usage,
        example: 'leaflet-cli auth login --callback-port 43189',
      });
    }
    callbackListenPort = parsedPort;
  }
  const codeVerifier = oauthDeps.generateCodeVerifier();
  const codeChallenge = oauthDeps.computeCodeChallenge(codeVerifier);
  const state = oauthDeps.generateState();
  const scope = 'shorten:create shorten:create:alias shorten:create:never urls:delete user:read';

  output.info('Starting OAuth browser login. A browser window will open for you to authorize the CLI.');

  const { port: portPromise, result: codePromise } = oauthDeps.startCallbackServer(
    state,
    120_000,
    callbackListenPort,
  );
  const callbackPort = await portPromise;
  const redirectUri = `http://127.0.0.1:${callbackPort}/callback`;

  const authorizeUrl = new URL(`${resolvedConfig.server}/oauth/authorize`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', scope);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  output.info(`Authorization URL:\n  ${authorizeUrl.toString()}`);
  output.info(`Callback URL:\n  ${redirectUri}`);

  try {
    await oauthDeps.openBrowser(authorizeUrl.toString());
    output.info('Browser opened. Waiting for authorization…');
  } catch {
    output.info('Could not open browser automatically. Open the URL above manually.');
  }

  let code: string;
  try {
    code = await codePromise;
  } catch (err) {
    throw new CliError('OAuth authorization failed.', {
      hint: (err as Error).message,
    });
  }

  let tokenResponse: Awaited<ReturnType<typeof exchangeCodeForTokens>>;
  try {
    tokenResponse = await oauthDeps.exchangeCodeForTokens({
      server: resolvedConfig.server,
      clientId,
      code,
      redirectUri,
      codeVerifier,
    });
  } catch (err) {
    throw new CliError('OAuth token exchange failed.', {
      hint: (err as Error).message,
    });
  }

  const oauth: StoredOAuth = {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    expiresAt: Date.now() + tokenResponse.expires_in * 1000,
    scope: tokenResponse.scope,
    clientId,
  };

  const configPath = await writeStoredConfig({
    ...storedConfig,
    oauth,
  }, runtime.homeDir);

  output.success({
    authenticated: true,
    authStatus: 'authenticated',
    configPath,
    server: resolvedConfig.server,
    tokenSource: 'config',
    scope: oauth.scope,
  }, [
    'Authentication: OAuth 2.0 configured',
    `Server: ${resolvedConfig.server}`,
    `Stored tokens: ${configPath}`,
    `Scope: ${oauth.scope}`,
  ]);
}

async function handleAuthLogout(options: LogoutOptions, runtime: CliRuntime): Promise<void> {
  const output = createOutput(options, runtime);
  const storedConfig = await readStoredConfig(runtime.homeDir);
  const resolvedBeforeLogout = resolveConfig({
    env: runtime.env,
    storedConfig,
  });

  const hadStoredToken = Boolean(storedConfig.oauth);
  const configPath = await writeStoredConfig({
    ...storedConfig,
    oauth: undefined,
  }, runtime.homeDir);

  const stillAuthenticated = resolvedBeforeLogout.tokenSource === 'env';
  const lines = [
    hadStoredToken ? 'Stored credentials removed.' : 'No stored credentials were present.',
    `Config path: ${configPath}`,
  ];

  if (stillAuthenticated) {
    lines.push('Environment token still active: commands will continue to authenticate until you unset it.');
  } else {
    lines.push('Mode: anonymous');
  }

  output.success({
    authenticated: stillAuthenticated,
    tokenCleared: hadStoredToken,
    configPath,
    tokenSource: stillAuthenticated ? 'env' : 'none',
  }, lines);
}

async function handleAuthStatus(options: SharedOptions, runtime: CliRuntime): Promise<void> {
  const output = createOutput(options, runtime);
  const oauthDeps = resolveOAuthDeps(runtime);
  let storedConfig = await readStoredConfig(runtime.homeDir);
  const server = resolveConfig({ env: runtime.env, storedConfig }).server;
  storedConfig = await maybeRefreshOAuthToken(storedConfig, runtime.homeDir, output, oauthDeps, server);
  const resolvedConfig = resolveConfig({
    env: runtime.env,
    storedConfig,
  });

  if (!resolvedConfig.token) {
    output.success({
      authenticated: false,
      authStatus: 'anonymous',
      server: resolvedConfig.server,
      tokenSource: 'none',
      configPath: getConfigPath(runtime.homeDir),
    }, [
      'Authentication: anonymous',
      `Server: ${resolvedConfig.server}`,
      `Config path: ${getConfigPath(runtime.homeDir)}`,
    ]);
    return;
  }

  const client = new LeafletApiClient(runtime.fetchImpl, output);
  const identityResult = await client.getOAuthIdentity(resolvedConfig.server, resolvedConfig.token);

  if (identityResult.status === 'invalid') {
    throw new CliError(identityResult.error, {
      hint: "Run 'leaflet-cli auth login' with a fresh token, or unset LEAFLET_TOKEN.",
      usage: HELP_BY_COMMAND['auth status'].usage,
      example: HELP_BY_COMMAND['auth status'].example,
    });
  }

  if (identityResult.status === 'insufficient_scope') {
    throw new CliError(identityResult.error, {
      hint: identityResult.hint ?? "Re-authenticate with 'leaflet-cli auth login' so the token includes 'user:read'.",
      usage: HELP_BY_COMMAND['auth status'].usage,
      example: HELP_BY_COMMAND['auth status'].example,
    });
  }

  const authStatus: AuthStatus = identityResult.identity.role === 'admin' ? 'admin' : 'authenticated';
  const scope = identityResult.identity.scopes.join(' ');

  output.success({
    authenticated: true,
    authStatus,
    server: resolvedConfig.server,
    tokenSource: resolvedConfig.tokenSource,
    configPath: getConfigPath(runtime.homeDir),
    scope,
    scopes: identityResult.identity.scopes,
  }, [
    `Authentication: ${authStatus}`,
    `Server: ${resolvedConfig.server}`,
    `Token source: ${resolvedConfig.tokenSource}`,
    `Scopes: ${scope || '(none)'}`,
    `Config path: ${getConfigPath(runtime.homeDir)}`,
  ]);
}

async function handleDelete(idValue: string, options: DeleteOptions, runtime: CliRuntime): Promise<void> {
  const output = createOutput(options, runtime);
  const oauthDeps = resolveOAuthDeps(runtime);
  let storedConfig = await readStoredConfig(runtime.homeDir);
  const server = resolveConfig({ env: runtime.env, storedConfig }).server;
  storedConfig = await maybeRefreshOAuthToken(storedConfig, runtime.homeDir, output, oauthDeps, server);
  const resolvedConfig = resolveConfig({
    env: runtime.env,
    storedConfig,
  });

  if (!resolvedConfig.token) {
    throw new CliError('Deleting links requires OAuth authentication.', {
      hint: "Run 'leaflet-cli auth login' first.",
      usage: HELP_BY_COMMAND.delete.usage,
      example: HELP_BY_COMMAND.delete.example,
    });
  }

  const id = Number.parseInt(idValue, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new CliError(`Invalid id "${idValue}".`, {
      hint: 'Pass a positive numeric link id.',
      usage: HELP_BY_COMMAND.delete.usage,
      example: HELP_BY_COMMAND.delete.example,
    });
  }

  output.info(`Deleting link ${id} via ${resolvedConfig.server}.`);

  const client = new LeafletApiClient(runtime.fetchImpl, output);
  const result = await client.deleteUrl(resolvedConfig.server, resolvedConfig.token, id);

  if (!result.ok) {
    throw mapDeleteError(result);
  }

  output.success({
    deleted: true,
    id,
    server: resolvedConfig.server,
  }, [
    `Deleted link: ${id}`,
    `Server: ${resolvedConfig.server}`,
  ]);
}

function buildProgram(runtime: CliRuntime): Command {
  const program = new Command();

  program
    .name('leaflet-cli')
    .description('Scriptable Leaflet CLI for creating and managing short URLs over HTTP.')
    .version('1.0.0')
    .configureOutput({
      writeOut: runtime.writeOut,
      writeErr: runtime.writeErr,
      outputError: (text, write) => write(text),
    })
    .exitOverride()
    .addHelpText('after', `
Examples:
  leaflet-cli shorten https://example.com --ttl=60m
  leaflet-cli auth login
  leaflet-cli auth status --json
`);

  addSharedOptions(
    program
      .command('shorten <url>')
      .description('Create a short URL.')
      .option('--ttl <ttl>', 'TTL: 5m, 60m, 24h, never', '24h')
      .option('--alias <alias>', 'Custom alias for privileged/admin tokens')
      .addHelpText('after', `
Examples:
  leaflet-cli shorten https://example.com --ttl=60m
  leaflet-cli shorten https://example.com --ttl=24h --alias=my-link
  leaflet-cli shorten https://example.com --ttl=24h --json
`)
  ).action(async (url: string, options: ShortenOptions) => {
    await handleShorten(url, options, runtime);
  });

  const authCommand = program
    .command('auth')
    .description('Manage stored OAuth credentials.')
    .addHelpText('after', `
Examples:
  leaflet-cli auth login
  leaflet-cli auth logout
  leaflet-cli auth status --json
`);

  addSharedOptions(
    authCommand
      .command('login')
      .description('Authenticate via the OAuth browser flow.')
      .option('--client-id <clientId>', 'OAuth client ID (default: leaflet-cli)')
      .option('--callback-port <port>', 'Fixed localhost callback port (useful over SSH with forwarded ports)')
      .addHelpText('after', `
Examples:
  leaflet-cli auth login
  leaflet-cli auth login --callback-port 43189
`)
  ).action(async (options: AuthLoginOptions) => {
    await handleAuthLogin(options, runtime);
  });

  authCommand
    .command('logout')
    .description('Remove locally stored OAuth credentials.')
    .option('--json', 'Output machine-readable JSON')
    .option('--verbose', 'Print additional command progress to stderr')
    .addHelpText('after', `
Example:
  leaflet-cli auth logout --json
`)
    .action(async (options: LogoutOptions) => {
      await handleAuthLogout(options, runtime);
    });

  addSharedOptions(
    authCommand
      .command('status')
      .description('Show the current authentication mode.')
      .addHelpText('after', `
Examples:
  leaflet-cli auth status
  leaflet-cli auth status --json
`)
  ).action(async (options: SharedOptions) => {
    await handleAuthStatus(options, runtime);
  });

  addSharedOptions(
    program
      .command('delete <id>')
      .description("Delete a short URL by numeric id. Requires admin role and the 'urls:delete' scope.")
      .addHelpText('after', `
Examples:
  leaflet-cli delete 42
  leaflet-cli delete 42 --json
`)
  ).action(async (id: string, options: DeleteOptions) => {
    await handleDelete(id, options, runtime);
  });

  return program;
}

export async function runCli(argv = process.argv, runtime = createDefaultRuntime()): Promise<number> {
  const program = buildProgram(runtime);

  if (argv.length <= 2) {
    program.outputHelp();
    return 0;
  }

  try {
    await program.parseAsync(argv);
    return 0;
  } catch (error) {
    if (error instanceof CommanderError && (
      error.code === 'commander.helpDisplayed' ||
      error.code === 'commander.version'
    )) {
      return 0;
    }

    const output = createFallbackOutput(argv, runtime);

    if (error instanceof CommanderError) {
      return output.failure(createCommanderError(error, argv), HELP_BY_COMMAND[inferCommandKey(argv)] ?? ROOT_HELP);
    }

    return output.failure(error, HELP_BY_COMMAND[inferCommandKey(argv)] ?? ROOT_HELP);
  }
}
