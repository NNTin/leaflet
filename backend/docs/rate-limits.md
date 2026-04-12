# Backend Rate Limits

This file documents the current backend rate limiting behavior implemented in
[backend/src/app.ts](../src/app.ts).

## Scope

- This covers the Express backend only.
- Frontend SPA page loads such as `/`, `/result`, `/expired`, `/error`,
  `/developer`, frontend `/settings`, and frontend `/admin` are not
  rate-limited by code in this repo.
- Every backend request first passes through the global limiter:
  `300 requests / 15 minutes / IP`.
- Additional limiters stack on top of that global limiter.
- Authenticated, privileged, and admin callers do not get separate
  user-keyed buckets. Outside the anonymous `/api/shorten` case, the
  implementation is IP-based.

## Bucket Keys

- Global limiter: IP address
- Anonymous `/api/shorten` session limiter: session ID, with IP fallback
- Anonymous `/api/shorten` IP guard: IP address
- `/auth/*` limiter: IP address
- `/auth/me` and `/auth/providers` relaxed limiter: IP address
- `/admin/*` limiter: IP address

IP-based buckets use Express `req.ip`, so proxy behavior depends on the
configured `TRUST_PROXY` setting.

## Matrix

The two anonymous columns are separate buckets. For anonymous
`POST /api/shorten` traffic, both of them apply at the same time.

| Page / subpath | Anonymous (session) | Anonymous (IP) | Authenticated user | Privileged user | Admin |
| --- | --- | --- | --- | --- | --- |
| Frontend SPA pages (`/`, `/result`, `/expired`, `/error`, `/developer`, frontend `/settings`, frontend `/admin`) | none in repo | none in repo | none in repo | none in repo | none in repo |
| `GET /auth/csrf-token` | global `300/15m` per IP | global `300/15m` per IP | global `300/15m` per IP | global `300/15m` per IP | global `300/15m` per IP |
| `/auth/me` | global `300/15m` per IP + auth-read `120/1m` per IP | same | same | same | same |
| `/auth/providers` | global `300/15m` per IP + auth-read `120/1m` per IP | same | same | same | same |
| Other `/auth/*` routes: `/auth/logout`, `/auth/identities`, `/auth/:provider`, `/auth/:provider/link`, provider callbacks, `/auth/merge/*` | global `300/15m` per IP + auth `30/15m` per IP | same | same | same | same |
| `POST /api/shorten` | global `300/15m` per IP + anonymous session `1/1m` per session + anonymous IP guard `10/1m` per IP | global `300/15m` per IP + anonymous IP guard `10/1m` per IP | global `300/15m` per IP only | global `300/15m` per IP only | global `300/15m` per IP only |
| `/api/openapi.json` | global `300/15m` per IP only | same | same | same | same |
| `/api/:code` redirect | global `300/15m` per IP only | same | same | same | same |
| `/api/urls`, `/api/urls/:id` | global `300/15m` per IP only, then auth and role checks reject access | same | global `300/15m` per IP only, then role checks reject access unless admin | same | global `300/15m` per IP only |
| `/admin/*` routes: `/admin/urls`, `/admin/users`, `/admin/users/:id/role`, `/admin/urls/:id` | global `300/15m` per IP + admin `60/1m` per IP, then auth and role checks reject access | same | global `300/15m` per IP + admin `60/1m` per IP, then role checks reject access unless admin | same | global `300/15m` per IP + admin `60/1m` per IP |
| `/oauth/*` routes: `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`, `/oauth/apps*` | global `300/15m` per IP only | same | same | same | same |
| `/s/:code` | global `300/15m` per IP only | same | same | same | same |

## Implementation Notes

- `GET /auth/csrf-token` is defined before the `/auth` limiters are mounted, so
  it only gets the global limiter.
- `/auth/me` and `/auth/providers` are matched by path, not by HTTP method.
  Today that means `DELETE /auth/me` gets the relaxed `120/1m` bucket too.
- Authenticated `/api/shorten` requests skip both anonymous limiters because the
  skip condition is `req.isAuthenticated() || !!req.user`. The earlier bearer
  auth middleware populates `req.user` for valid OAuth access tokens before rate
  limiting runs.
- `/admin/*` has an extra limiter, but the admin-only API routes under
  `/api/urls` do not. Those routes only inherit the global limiter.
- All limiters use `standardHeaders: true` and `legacyHeaders: false`, so
  `RateLimit-*` response headers are emitted on limited routes.
- Existing automated coverage in
  [backend/src/__tests__/api.test.ts](../src/__tests__/api.test.ts) currently
  verifies the anonymous `/api/shorten` behavior.
