import { User } from './models/user';

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

export type ShortenTtl = '5m' | '1h' | '24h' | '1w' | 'never';
export type ShortenRole = User['role'] | null;

export interface ShortenTtlOption {
  value: ShortenTtl;
  label: string;
}

export interface ShortenCapabilityContext {
  user: Pick<User, 'role'> | null;
  oauthAuthenticated?: boolean;
  oauthScopes?: string[];
}

export interface ShortenCapabilities {
  authenticated: boolean;
  anonymous: boolean;
  role: ShortenRole;
  shortenAllowed: boolean;
  aliasingAllowed: boolean;
  neverAllowed: boolean;
  ttlOptions: ShortenTtlOption[];
}

export const SHORTEN_TTL_OPTIONS: ReadonlyArray<ShortenTtlOption> = [
  { value: '5m', label: '5 minutes' },
  { value: '1h', label: '1 hour' },
  { value: '24h', label: '24 hours' },
  { value: '1w', label: '1 week' },
  { value: 'never', label: 'Never expire' },
];

export const SHORTEN_TTL_VALUES: ShortenTtl[] = SHORTEN_TTL_OPTIONS.map(({ value }) => value);

export const SHORTEN_TTL_MAP: Record<ShortenTtl, number | null> = {
  '5m': 5 * SECONDS_PER_MINUTE * MS_PER_SECOND,
  '1h': MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND,
  '24h': HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND,
  '1w': 7 * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND,
  'never': null,
};

function hasOAuthScope(context: ShortenCapabilityContext, scope: string): boolean {
  if (!context.oauthAuthenticated) {
    return true;
  }

  const scopes = context.oauthScopes ?? [];
  return scopes.includes('admin:*') || scopes.includes(scope);
}

export function canRoleUseCustomAlias(role: ShortenRole): boolean {
  return role === 'privileged' || role === 'admin';
}

export function canRoleUseNeverTtl(role: ShortenRole): boolean {
  return role === 'admin';
}

export function canContextShorten(context: ShortenCapabilityContext): boolean {
  return hasOAuthScope(context, 'shorten:create');
}

export function canContextUseCustomAlias(context: ShortenCapabilityContext): boolean {
  return canContextShorten(context)
    && canRoleUseCustomAlias(context.user?.role ?? null)
    && hasOAuthScope(context, 'shorten:create:alias');
}

export function canContextUseNeverTtl(context: ShortenCapabilityContext): boolean {
  return canContextShorten(context)
    && canRoleUseNeverTtl(context.user?.role ?? null)
    && hasOAuthScope(context, 'shorten:create:never');
}

export function getShortenTtlOptions(context: ShortenCapabilityContext): ShortenTtlOption[] {
  if (!canContextShorten(context)) {
    return [];
  }

  const weekAllowed = context.user !== null;
  const neverAllowed = canContextUseNeverTtl(context);

  return SHORTEN_TTL_OPTIONS.filter(({ value }) => {
    if (value === '1w') return weekAllowed;
    if (value === 'never') return neverAllowed;
    return true;
  });
}

export function getShortenCapabilities(context: ShortenCapabilityContext): ShortenCapabilities {
  const role = context.user?.role ?? null;

  return {
    authenticated: context.user !== null,
    anonymous: context.user === null,
    role,
    shortenAllowed: canContextShorten(context),
    aliasingAllowed: canContextUseCustomAlias(context),
    neverAllowed: canContextUseNeverTtl(context),
    ttlOptions: getShortenTtlOptions(context),
  };
}
