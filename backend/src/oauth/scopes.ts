export const VALID_SCOPES = [
  'shorten:create',
  'shorten:create:never',
  'shorten:create:alias',
  'urls:read',
  'urls:delete',
  'user:read',
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
  'user:read': 'user',
  'admin:*': 'admin',
};

export function isValidScope(s: string): s is Scope {
  return VALID_SCOPES.includes(s as Scope);
}

export function parseScopes(scopeStr: string): Scope[] {
  return scopeStr
    .split(' ')
    .map((s) => s.trim())
    .filter((s): s is Scope => isValidScope(s));
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
