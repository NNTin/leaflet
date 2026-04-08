import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { CliError } from './errors';

export interface StoredConfig {
  server?: string;
  token?: string;
}

export interface ResolvedConfig {
  configPath: string;
  server: string;
  serverSource: 'flag' | 'env' | 'config' | 'default';
  token: string | null;
  tokenSource: 'env' | 'config' | 'none';
}

export const DEFAULT_SERVER = 'http://localhost:3001';
export const SERVER_ENV_KEYS = ['LEAFLET_BASE_URL', 'LEAFLET_API_BASE_URL', 'LEAFLET_SERVER'] as const;
export const TOKEN_ENV_KEYS = ['LEAFLET_TOKEN', 'LEAFLET_API_TOKEN', 'LEAFLET_API_KEY'] as const;

function sanitizeString(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getFirstEnvValue(env: NodeJS.ProcessEnv, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = sanitizeString(env[key]);
    if (value) return value;
  }

  return undefined;
}

export function getConfigPath(homeDir = os.homedir()): string {
  return path.join(homeDir, '.leafletrc');
}

export function normalizeServer(value: string): string {
  const trimmed = value.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new CliError(`Invalid server URL "${value}".`, {
      hint: 'Use a full http:// or https:// URL for --server or the config file.',
    });
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CliError(`Invalid server URL "${value}".`, {
      hint: 'The server URL must use http or https.',
    });
  }

  return trimmed.replace(/\/+$/, '');
}

export async function readStoredConfig(homeDir = os.homedir()): Promise<StoredConfig> {
  const configPath = getConfigPath(homeDir);

  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Config file must contain a JSON object.');
    }

    const record = parsed as Record<string, unknown>;

    const config: StoredConfig = {};

    if (typeof record.server === 'string') {
      config.server = normalizeServer(record.server);
    }

    if (typeof record.token === 'string') {
      config.token = sanitizeString(record.token);
    }

    return config;
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;

    if (fileError.code === 'ENOENT') {
      return {};
    }

    if (error instanceof CliError) {
      throw new CliError(`Could not read ${configPath}.`, {
        hint: 'Fix the stored server URL or remove the config file and try again.',
        details: [error.message],
      });
    }

    throw new CliError(`Could not read ${configPath}.`, {
      hint: 'Fix the config file JSON or remove it and try again.',
      details: [(error as Error).message],
    });
  }
}

export async function writeStoredConfig(config: StoredConfig, homeDir = os.homedir()): Promise<string> {
  const configPath = getConfigPath(homeDir);
  const nextConfig: StoredConfig = {};

  if (config.server) {
    nextConfig.server = normalizeServer(config.server);
  }

  if (config.token) {
    const token = sanitizeString(config.token);
    if (token) nextConfig.token = token;
  }

  if (Object.keys(nextConfig).length === 0) {
    try {
      await fs.unlink(configPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    return configPath;
  }

  await fs.writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8');
  return configPath;
}

export function resolveConfig(input: {
  env: NodeJS.ProcessEnv;
  storedConfig: StoredConfig;
  server?: string;
}): ResolvedConfig {
  const configPath = getConfigPath();
  const envServer = getFirstEnvValue(input.env, SERVER_ENV_KEYS);
  const envToken = getFirstEnvValue(input.env, TOKEN_ENV_KEYS);

  let server = DEFAULT_SERVER;
  let serverSource: ResolvedConfig['serverSource'] = 'default';

  if (sanitizeString(input.server)) {
    server = normalizeServer(input.server as string);
    serverSource = 'flag';
  } else if (envServer) {
    server = normalizeServer(envServer);
    serverSource = 'env';
  } else if (input.storedConfig.server) {
    server = normalizeServer(input.storedConfig.server);
    serverSource = 'config';
  }

  if (envToken) {
    return {
      configPath,
      server,
      serverSource,
      token: envToken,
      tokenSource: 'env',
    };
  }

  if (input.storedConfig.token) {
    return {
      configPath,
      server,
      serverSource,
      token: input.storedConfig.token,
      tokenSource: 'config',
    };
  }

  return {
    configPath,
    server,
    serverSource,
    token: null,
    tokenSource: 'none',
  };
}
