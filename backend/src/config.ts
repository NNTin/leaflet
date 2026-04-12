const LOCAL_FRONTEND_URL = 'http://localhost:5173';
const LOCAL_API_ORIGIN = 'http://localhost:3001';
const PAGES_ORIGIN = 'https://nntin.xyz';
const SUBDOMAIN_ORIGIN = 'https://leaflet.lair.nntin.xyz';
const PAGES_ALLOWED_RETURN_PATHS = ['/leaflet', '/leafspots'] as const;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function toOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function normalizeUrl(value: string, fallback: string): string {
  try {
    return new URL(value).toString();
  } catch {
    return fallback;
  }
}

function matchesAllowedPathPrefix(pathname: string, allowedPrefixes: readonly string[]): boolean {
  return allowedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function parseOriginList(value: string | undefined): string[] {
  if (!value) return [];

  const origins = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map(toOrigin)
    .filter((origin): origin is string => origin !== null);

  return Array.from(new Set(origins));
}

export const defaultFrontendUrl = normalizeUrl(
  process.env.DEFAULT_FRONTEND_URL || process.env.FRONTEND_URL || LOCAL_FRONTEND_URL,
  LOCAL_FRONTEND_URL
);

const fallbackFrontendOrigin = toOrigin(defaultFrontendUrl) ?? LOCAL_FRONTEND_URL;

export const allowedFrontendOrigins = parseOriginList(process.env.ALLOWED_FRONTEND_ORIGINS);
if (allowedFrontendOrigins.length === 0) {
  allowedFrontendOrigins.push(fallbackFrontendOrigin);
}

export const publicApiOrigin = trimTrailingSlash(process.env.PUBLIC_API_ORIGIN || LOCAL_API_ORIGIN);
export const publicShortUrlBase = trimTrailingSlash(process.env.PUBLIC_SHORT_URL_BASE || `${publicApiOrigin}/s`);

export function isAllowedFrontendOrigin(origin: string): boolean {
  return allowedFrontendOrigins.includes(origin);
}

function allowsReturnPath(url: URL): boolean {
  if (url.origin === PAGES_ORIGIN) {
    return matchesAllowedPathPrefix(url.pathname, PAGES_ALLOWED_RETURN_PATHS);
  }

  if (url.origin === SUBDOMAIN_ORIGIN) {
    return url.pathname.startsWith('/');
  }

  const defaultUrl = new URL(defaultFrontendUrl);
  if (url.origin === defaultUrl.origin && defaultUrl.pathname !== '/') {
    const defaultPath = trimTrailingSlash(defaultUrl.pathname);
    return url.pathname === defaultPath || url.pathname.startsWith(`${defaultPath}/`);
  }

  return true;
}

export function validateOAuthReturnTo(rawReturnTo: string | undefined): string | null {
  if (!rawReturnTo) return null;

  try {
    const normalizedReturnTo = rawReturnTo.startsWith('/')
      ? new URL(rawReturnTo, `${publicApiOrigin}/`).toString()
      : rawReturnTo;

    const url = new URL(normalizedReturnTo);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!isAllowedFrontendOrigin(url.origin)) return null;
    if (!allowsReturnPath(url)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function resolveOAuthReturnTo(rawReturnTo: string | undefined): string {
  return validateOAuthReturnTo(rawReturnTo) ?? defaultFrontendUrl;
}

export function addAuthFailureParam(returnTo: string): string {
  const url = new URL(returnTo);
  url.searchParams.set('auth', 'failed');
  return url.toString();
}
