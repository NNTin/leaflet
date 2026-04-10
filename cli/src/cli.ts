import os from 'os';
import { Command, CommanderError } from 'commander';
import fetch from 'node-fetch';
import { CliError } from './errors';
import { getConfigPath, readStoredConfig, resolveConfig, writeStoredConfig, DEFAULT_SERVER, StoredConfig } from './config';
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
  /** Optional: if omitted, the OAuth browser flow is used instead. */
  token?: string;
  /** Client ID for the OAuth PKCE flow (defaults to the built-in leaflet-cli client). */
  clientId?: string;
};

type DeleteOptions = SharedOptions;

type LogoutOptions = {
  json?: boolean;
  verbose?: boolean;
};

type AuthStatus = 'admin' | 'authenticated' | 'anonymous';

export interface CliRuntime {
  env: NodeJS.ProcessEnv;
  homeDir: string;
  fetchImpl: FetchLike;
  writeOut: (chunk: string) => void;
  writeErr: (chunk: string) => void;
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
    usage: 'leaflet-cli auth login [--token <API_TOKEN>] [options]',
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

function createDefaultRuntime(): CliRuntime {
  return {
    env: process.env,
    homeDir: os.homedir(),
    fetchImpl: fetch,
    writeOut: (chunk) => process.stdout.write(chunk),
    writeErr: (chunk) => process.stderr.write(chunk),
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

  if (result.status === 400) {
    return new CliError(message, {
      hint: "Check the URL, TTL, and alias values, or run 'leaflet-cli shorten --help'.",
      usage: HELP_BY_COMMAND.shorten.usage,
      example: HELP_BY_COMMAND.shorten.example,
    });
  }

  if (result.status === 403) {
    if (message === 'CSRF validation failed.' && context.token) {
      return new CliError('The configured token was rejected by the server.', {
        hint: "Run 'leaflet-cli auth login --token <API_TOKEN>' with a fresh token or unset the token environment variable.",
        usage: HELP_BY_COMMAND.shorten.usage,
        example: HELP_BY_COMMAND.shorten.example,
      });
    }

    if (context.alias) {
      return new CliError(message, {
        hint: 'Remove --alias or authenticate with a privileged or admin token.',
        usage: HELP_BY_COMMAND.shorten.usage,
        example: 'leaflet-cli auth login --token <API_TOKEN>',
      });
    }

    if (context.ttl === 'never') {
      return new CliError(message, {
        hint: 'Use an admin token or choose 5m, 60m, or 24h instead.',
        usage: HELP_BY_COMMAND.shorten.usage,
        example: HELP_BY_COMMAND.shorten.example,
      });
    }

    return new CliError(message, {
      hint: 'Retry with a valid token or run without authentication for anonymous mode.',
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
      hint: 'Anonymous requests are limited to one request per minute. Wait a minute or authenticate with a token.',
      usage: HELP_BY_COMMAND.shorten.usage,
      example: 'leaflet-cli auth login --token <API_TOKEN>',
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

  if (result.status === 401) {
    return new CliError(message, {
      hint: "Run 'leaflet-cli auth login --token <API_TOKEN>' with an admin token before deleting links.",
      usage: HELP_BY_COMMAND.delete.usage,
      example: HELP_BY_COMMAND.delete.example,
    });
  }

  if (result.status === 403) {
    return new CliError(message, {
      hint: 'Deleting links requires an admin token.',
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
): Promise<StoredConfig> {
  if (!storedConfig.oauth) return storedConfig;
  if (!isTokenExpiringSoon(storedConfig.oauth)) return storedConfig;

  output.info('OAuth access token is expiring soon, refreshing…');
  try {
    const tokenResponse = await refreshAccessToken({
      server: DEFAULT_SERVER,
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
  let storedConfig = await readStoredConfig(runtime.homeDir);
  storedConfig = await maybeRefreshOAuthToken(storedConfig, runtime.homeDir, output);
  const resolvedConfig = resolveConfig({
    env: runtime.env,
    storedConfig,
  });
  const client = new LeafletApiClient(runtime.fetchImpl, output);

  const url = ensureHttpUrl(urlValue);
  const ttl = normalizeTtl(options.ttl);
  const alias = options.alias ? ensureAlias(options.alias) : undefined;

  if (alias && !resolvedConfig.token) {
    throw new CliError('Custom aliases require an authenticated token.', {
      hint: "Run 'leaflet-cli auth login --token <API_TOKEN>' first, or remove --alias.",
      usage: HELP_BY_COMMAND.shorten.usage,
      example: HELP_BY_COMMAND.shorten.example,
    });
  }

  if (ttl.outputTtl === 'never' && !resolvedConfig.token) {
    throw new CliError('Indefinite links require an authenticated admin token.', {
      hint: "Run 'leaflet-cli auth login --token <API_TOKEN>' with an admin token, or choose 5m, 60m, or 24h.",
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
  const storedConfig = await readStoredConfig(runtime.homeDir);
  const resolvedConfig = resolveConfig({
    env: runtime.env,
    storedConfig,
  });

  // -------------------------------------------------------------------
  // Legacy API key flow (--token provided)
  // -------------------------------------------------------------------
  if (options.token !== undefined) {
    const token = options.token.trim();

    if (!token) {
      throw new CliError('The token cannot be empty.', {
        hint: 'Pass a non-empty token with --token.',
        usage: HELP_BY_COMMAND['auth login'].usage,
        example: HELP_BY_COMMAND['auth login'].example,
      });
    }

    const client = new LeafletApiClient(runtime.fetchImpl, output);
    const validation = await client.validateToken(resolvedConfig.server, token);

    if (validation === 'invalid') {
      throw new CliError('The token was rejected by the server.', {
        hint: 'Generate a fresh token from /auth/api-key and try again.',
        usage: HELP_BY_COMMAND['auth login'].usage,
        example: HELP_BY_COMMAND['auth login'].example,
      });
    }

    const configPath = await writeStoredConfig({
      ...storedConfig,
      token,
      // Clear any previously stored OAuth tokens when switching to an API key.
      oauth: undefined,
    }, runtime.homeDir);

    output.success({
      authenticated: true,
      authStatus: validation,
      configPath,
      server: resolvedConfig.server,
      tokenSource: 'config',
    }, [
      'Authentication: configured',
      `Server: ${resolvedConfig.server}`,
      `Stored token: ${configPath}`,
      `Server validation: ${validation === 'admin' ? 'admin token' : 'non-admin token'}`,
    ]);
    return;
  }

  // -------------------------------------------------------------------
  // OAuth 2.0 PKCE flow (no --token: open browser)
  // -------------------------------------------------------------------
  const clientId = options.clientId ?? 'leaflet-cli';
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = computeCodeChallenge(codeVerifier);
  const state = generateState();
  const scope = 'shorten:create user:read';

  output.info('Starting OAuth browser login. A browser window will open for you to authorize the CLI.');

  const { port: portPromise, result: codePromise } = startCallbackServer(state);
  const callbackPort = await portPromise;
  const redirectUri = `http://localhost:${callbackPort}/callback`;

  const authorizeUrl = new URL(`${resolvedConfig.server}/oauth/authorize`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', scope);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  output.info(`Authorization URL:\n  ${authorizeUrl.toString()}`);

  try {
    await openBrowser(authorizeUrl.toString());
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
    tokenResponse = await exchangeCodeForTokens({
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
    // Clear any legacy API key when switching to OAuth.
    token: undefined,
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

  const hadStoredToken = Boolean(storedConfig.token) || Boolean(storedConfig.oauth);
  const configPath = await writeStoredConfig({
    ...storedConfig,
    token: undefined,
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
  const storedConfig = await readStoredConfig(runtime.homeDir);
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
  const validation = await client.validateToken(resolvedConfig.server, resolvedConfig.token);

  if (validation === 'invalid') {
    throw new CliError('The configured token was rejected by the server.', {
      hint: "Run 'leaflet-cli auth login --token <API_TOKEN>' with a fresh token, or unset the token environment variable.",
      usage: HELP_BY_COMMAND['auth status'].usage,
      example: HELP_BY_COMMAND['auth status'].example,
    });
  }

  const authStatus: AuthStatus = validation === 'admin' ? 'admin' : 'authenticated';

  output.success({
    authenticated: true,
    authStatus,
    server: resolvedConfig.server,
    tokenSource: resolvedConfig.tokenSource,
    configPath: getConfigPath(runtime.homeDir),
  }, [
    `Authentication: ${authStatus}`,
    `Server: ${resolvedConfig.server}`,
    `Token source: ${resolvedConfig.tokenSource}`,
    `Config path: ${getConfigPath(runtime.homeDir)}`,
  ]);
}

async function handleDelete(idValue: string, options: DeleteOptions, runtime: CliRuntime): Promise<void> {
  const output = createOutput(options, runtime);
  let storedConfig = await readStoredConfig(runtime.homeDir);
  storedConfig = await maybeRefreshOAuthToken(storedConfig, runtime.homeDir, output);
  const resolvedConfig = resolveConfig({
    env: runtime.env,
    storedConfig,
  });

  if (!resolvedConfig.token) {
    throw new CliError('Deleting links requires an authenticated admin token.', {
      hint: "Run 'leaflet-cli auth login --token <API_TOKEN>' first.",
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
  leaflet-cli auth login --token <API_TOKEN>
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
    .description('Manage the stored API token.')
    .addHelpText('after', `
Examples:
  leaflet-cli auth login --token <API_TOKEN>
  leaflet-cli auth logout
  leaflet-cli auth status --json
`);

  addSharedOptions(
    authCommand
      .command('login')
      .description('Authenticate via OAuth browser flow, or store a legacy API token.')
      .option('--token <token>', 'Legacy API token from /auth/api-key (optional; if omitted the OAuth browser flow is used)')
      .option('--client-id <clientId>', 'OAuth client ID (default: leaflet-cli)')
      .addHelpText('after', `
Examples:
  leaflet-cli auth login
  leaflet-cli auth login --token <API_TOKEN>
`)
  ).action(async (options: AuthLoginOptions) => {
    await handleAuthLogin(options, runtime);
  });

  authCommand
    .command('logout')
    .description('Remove the locally stored API token.')
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
      .description('Delete a short URL by numeric id. Admin token required.')
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
