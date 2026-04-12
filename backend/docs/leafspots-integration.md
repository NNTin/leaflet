# Leafspots Browser Integration

Leafspots integrates with Leaflet as a first-party browser client. It reuses the
existing Leaflet browser session cookie and CSRF flow instead of using a
separate bearer-token or OAuth-client login flow.

## Prerequisites

- `ALLOWED_FRONTEND_ORIGINS` must allow the shared Pages origin used by both apps.
  In production that is `https://nntin.xyz`.
- Leaflet validates OAuth `returnTo` targets in `backend/src/config.ts`.
  For the Pages origin, only these path families are accepted:
  - `https://nntin.xyz/leaflet/...`
  - `https://nntin.xyz/leafspots/...`
- If `returnTo` is missing or rejected, Leaflet falls back to the configured
  `DEFAULT_FRONTEND_URL`.

## Login Handoff Page

- URL: `https://nntin.xyz/leaflet/login`
- Query params:
  - `returnTo` (optional): absolute frontend URL to send the browser back to
    after the auth callback completes.
- Page behavior:
  - Shows the heading `Sign in to Leaflet`.
  - Fetches the configured providers from `GET /auth/providers`.
  - Starts the existing provider flow through `GET /auth/{provider}?returnTo=...`.
  - Surfaces provider-list and auth-start rate limits inline on the page.
- Redirect behavior:
  - Success: the backend redirects to the validated `returnTo` URL.
  - Failure after the provider round-trip: the backend redirects to the same
    validated `returnTo` URL and sets `auth=failed` on the query string.
  - Invalid or missing `returnTo`: the backend redirects to `DEFAULT_FRONTEND_URL`
    on success, or to that same fallback URL with `auth=failed` on failure.

## Required Leafspots Calls

Leafspots is expected to use these existing and new contracts:

- `GET /auth/me`
- `GET /auth/csrf-token`
- `POST /api/shorten`
- `POST /auth/logout`
- `GET /api/shorten/capabilities`
- Frontend login handoff page: `GET /leaflet/login?returnTo=...`

## Shorten Capabilities Endpoint

- URL: `GET /api/shorten/capabilities`
- Auth model:
  - Anonymous browser callers are allowed.
  - Session-authenticated browser callers are allowed.
  - OAuth bearer tokens are optional; invalid tokens return `401`.
- Response fields:
  - `authenticated`
  - `anonymous`
  - `role`
  - `shortenAllowed`
  - `aliasingAllowed`
  - `neverAllowed`
  - `ttlOptions[]`
    - `value`
    - `label`
- TTL options are derived from Leaflet's backend rules for the current caller.
  Anonymous callers receive only anonymous-safe TTLs. Authenticated callers
  receive options based on their role, and OAuth callers are further limited by
  their granted scopes.

## Rate Limits

- `GET /auth/providers`, `GET /auth/me`, and
  `GET /api/shorten/capabilities` use the auth-read rate-limit buckets.
- `GET /auth/{provider}` and callback routes use the auth-flow bucket.
- `POST /api/shorten` continues to use the shorten buckets.
- Header behavior is documented in [rate-limits.md](./rate-limits.md).
