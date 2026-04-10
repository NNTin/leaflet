const apiOrigin = (import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/+$/, '')

function normalizePath(path: string): string {
  if (!path) return ''
  return path.startsWith('/') ? path : `/${path}`
}

function normalizeBasePath(path: string): string {
  if (!path || path === './') return '/'
  const withLeadingSlash = path.startsWith('/') ? path : `/${path}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

function serviceUrl(prefix: string, path: string): string {
  return `${apiOrigin}${prefix}${normalizePath(path)}`
}

function withReturnTo(url: string, returnTo?: string): string {
  if (!returnTo) return url

  const parsed = new URL(url, window.location.origin)
  parsed.searchParams.set('returnTo', returnTo)

  if (apiOrigin) return parsed.toString()
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

export const appBasePath = normalizeBasePath(import.meta.env.BASE_URL)
export const routerBasename = appBasePath === '/' ? undefined : appBasePath.replace(/\/$/, '')

export function apiUrl(path: string): string {
  return serviceUrl('/api', path)
}

export function authUrl(path: string, returnTo?: string): string {
  return withReturnTo(serviceUrl('/auth', path), returnTo)
}

export function adminUrl(path: string): string {
  return serviceUrl('/admin', path)
}

export function apiDocsUrl(): string {
  return serviceUrl('', '/api-docs')
}

export function appUrl(path: string): string {
  const normalizedPath = normalizePath(path)
  if (!normalizedPath || normalizedPath === '/') return appBasePath
  return `${appBasePath.replace(/\/$/, '')}${normalizedPath}`
}

export function shortUrl(code: string): string {
  return serviceUrl('/s', `/${encodeURIComponent(code)}`)
}
