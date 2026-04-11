export const VALID_SCOPES = [
  'shorten:create',
  'shorten:create:never',
  'shorten:create:alias',
  'urls:read',
  'urls:delete',
  'users:read',
  'users:write',
  'user:read',
  'oauth:apps:read',
  'oauth:apps:write',
  'admin:*',
] as const;

export type Scope = (typeof VALID_SCOPES)[number];

/** Minimum user role required to use a scope. */
export const SCOPE_ROLE_REQUIREMENT: Record<Scope, 'user' | 'privileged' | 'admin'> = {
  'shorten:create': 'user',
  'shorten:create:never': 'admin',
  'shorten:create:alias': 'privileged',
  'urls:read': 'admin',
  'urls:delete': 'admin',
  'users:read': 'admin',
  'users:write': 'admin',
  'user:read': 'user',
  'oauth:apps:read': 'user',
  'oauth:apps:write': 'user',
  'admin:*': 'admin',
};

export function isValidScope(s: string): s is Scope {
  return VALID_SCOPES.includes(s as Scope);
}

export function parseScopes(scopeStr: string): Scope[] {
  const requestedScopes = scopeStr
    .split(' ')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const invalidScope = requestedScopes.find((s) => !isValidScope(s));
  if (invalidScope !== undefined) {
    throw new Error(`Invalid scope: ${invalidScope}`);
  }

  return requestedScopes as Scope[];
}

export function userRoleSatisfiesScope(
  role: 'user' | 'privileged' | 'admin',
  scope: Scope,
): boolean {
  const required = SCOPE_ROLE_REQUIREMENT[scope];
  if (required === 'user') return true;
  if (required === 'privileged') return role === 'privileged' || role === 'admin';
  return role === 'admin';
}
