# Backend Rate Limits

This document defines the backend rate-limit contract for Leaflet. Runtime
middleware, OpenAPI output, and automated tests must match this file.

## Header Contract

- Limited endpoints emit `RateLimit` and `RateLimit-Policy` on every response.
- `429 Too Many Requests` responses also emit `Retry-After`.
- The backend uses IETF draft-8 rate-limit headers.
- The backend does not emit legacy `X-RateLimit-*` headers.
- If multiple buckets apply to one request, the response includes one
  draft-8 entry per active bucket.
- If a request is skipped because no bucket applies, the response does not emit
  rate-limit headers.

## Actor Keys

- Anonymous session buckets are keyed by `req.sessionID`.
- Anonymous IP buckets are keyed by `req.ip`.
- Authenticated user buckets are keyed by `user.id`.
- OAuth token buckets are keyed by `client_id` when present and valid, with
  `req.ip` as the fallback key.
- Authenticated admins are skipped for user-scoped buckets and admin probe
  buckets.

## Bucket Registry

These policy names should be the central source of truth in the backend.

| Policy | Key | Limit |
| --- | --- | --- |
| `csrf-bootstrap-anonymous` | IP | `30 / 5m` |
| `csrf-bootstrap-user` | user.id | `60 / 5m` |
| `csrf-bootstrap-privileged` | user.id | `120 / 5m` |
| `auth-read-anonymous` | IP | `120 / 1m` |
| `auth-read-user` | user.id | `240 / 1m` |
| `auth-read-privileged` | user.id | `480 / 1m` |
| `auth-flow` | IP | `20 / 15m` |
| `account-user` | user.id | `60 / 15m` |
| `account-privileged` | user.id | `120 / 15m` |
| `shorten-anonymous-session` | sessionID | `2 / 1m` |
| `shorten-anonymous-ip` | IP | `20 / 5m` |
| `shorten-user` | user.id | `60 / 15m` |
| `shorten-privileged` | user.id | `180 / 15m` |
| `openapi-anonymous` | IP | `60 / 5m` |
| `openapi-user` | user.id | `120 / 5m` |
| `openapi-privileged` | user.id | `240 / 5m` |
| `admin-probe` | IP | `30 / 15m` |
| `oauth-token` | client_id, fallback IP | `60 / 15m` |
| `oauth-apps-user` | user.id | `60 / 15m` |
| `oauth-apps-privileged` | user.id | `120 / 15m` |

## Route Matrix

The columns below describe the effective bucket for each caller type.

| Page / subpath | Anonymous (session) | Anonymous (IP) | Authenticated user | Privileged user | Admin |
| --- | --- | --- | --- | --- | --- |
| `GET /auth/csrf-token` | none | `csrf-bootstrap-anonymous` | `csrf-bootstrap-user` | `csrf-bootstrap-privileged` | none |
| `GET /auth/me` | none | `auth-read-anonymous` | `auth-read-user` | `auth-read-privileged` | none |
| `GET /auth/providers` | none | `auth-read-anonymous` | `auth-read-user` | `auth-read-privileged` | none |
| `GET /api/shorten/capabilities` | none | `auth-read-anonymous` | `auth-read-user` | `auth-read-privileged` | none |
| `GET /auth/:provider`, `GET /auth/:provider/callback`, `POST /auth/apple/callback` | none | `auth-flow` | `auth-flow` | `auth-flow` | none |
| `GET /auth/:provider/link` | none | none | `account-user` | `account-privileged` | none |
| `GET /auth/identities`, `DELETE /auth/identities/:provider`, `POST /auth/logout`, `DELETE /auth/me`, `POST /auth/merge/initiate`, `POST /auth/merge/confirm` | none | none | `account-user` | `account-privileged` | none |
| `POST /api/shorten` | `shorten-anonymous-session` | `shorten-anonymous-ip` | `shorten-user` | `shorten-privileged` | none |
| `GET /api/openapi.json` | none | `openapi-anonymous` | `openapi-user` | `openapi-privileged` | none |
| `GET /api/urls`, `DELETE /api/urls/:id`, `GET /admin/urls`, `DELETE /admin/urls/:id`, `GET /admin/users`, `PATCH /admin/users/:id/role` | none | `admin-probe` | `admin-probe` | `admin-probe` | none |
| `GET /oauth/authorize`, `POST /oauth/authorize/consent` | none | `auth-flow` | `account-user` | `account-privileged` | none |
| `POST /oauth/token`, `POST /oauth/revoke` | none | `oauth-token` | `oauth-token` | `oauth-token` | `oauth-token` |
| `GET /oauth/apps`, `POST /oauth/apps`, `DELETE /oauth/apps/:clientId` | none | none | `oauth-apps-user` | `oauth-apps-privileged` | none |
| `GET /api/:code`, `GET /s/:code` | none | none | none | none | none |

## Route Rules

- Anonymous `POST /api/shorten` traffic consumes both anonymous buckets at the
  same time: one session bucket and one IP bucket.
- Authenticated `POST /api/shorten` traffic consumes only the role-appropriate
  user bucket.
- Admin-only route families use the `admin-probe` bucket for any caller that is
  not an authenticated admin. Authenticated admins are fully skipped.
- Public redirect endpoints do not have an application-level rate limit.
- `POST /oauth/token` and `POST /oauth/revoke` are client-scoped, not
  user-scoped.

## OpenAPI Requirements

- Every limited operation documents `RateLimit` and `RateLimit-Policy` headers
  on every response status that the operation can return.
- Every documented `429` response documents `Retry-After`.
- Unlimited operations do not document rate-limit headers.
- `GET /api/openapi.json` is rate-limited and must document those headers.
