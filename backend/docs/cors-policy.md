# Leaflet Backend CORS Policy

This document defines the intended cross-origin policy for the Leaflet backend.
It exists to separate first-party browser session traffic from public
third-party browser API traffic.

## Goals

- Keep cookie-backed browser session endpoints restricted to trusted first-party
  frontends.
- Allow third-party websites to use anonymous URL shortening from the browser.
- Avoid treating CORS as a one-size-fits-all global policy.
- Ensure routes that only participate in top-level navigations or redirects do
  not depend on fetch/XHR CORS behavior.

## Policy Buckets

### 1. First-Party Browser Only

These routes are intended for trusted frontend origins only. They may use
cookies, browser sessions, and CSRF protections.

- `GET /auth/csrf-token`
- `GET /auth/me`
- `POST /auth/logout`
- `GET /auth/identities`
- `DELETE /auth/identities/:provider`
- `POST /auth/merge/*`
- `DELETE /auth/me`
- admin routes

Rules:

- CORS is restricted to configured first-party frontend origins.
- The allowlist is defined by `ALLOWED_FRONTEND_ORIGINS` in backend config
  (`src/config.ts`).
- If `ALLOWED_FRONTEND_ORIGINS` is unset/empty, backend falls back to the
  origin derived from `DEFAULT_FRONTEND_URL` (or `FRONTEND_URL`, then
  `http://localhost:5173`).
- Enforcement happens in `src/app.ts` via the `firstPartyCors` policy, which
  checks `isAllowedFrontendOrigin(origin)`.
- `Access-Control-Allow-Credentials` may be enabled.
- Browser session cookies are allowed.
- Browser mutations continue to require CSRF protection.
- Arbitrary third-party origins must not be able to call these endpoints from
  the browser.

Rationale:

- `GET /auth/me` is a privacy-sensitive session read.
- `GET /auth/csrf-token` is part of the first-party CSRF bootstrap and must not
  be exposed cross-origin to arbitrary sites.
- Logout, merge, identity management, and admin operations are all
  session-scoped actions and must remain first-party only.

### 2. Public Browser API

These routes are intentionally callable by third-party websites from the
browser.

- `GET /api/public/shorten/capabilities`
- `POST /api/public/shorten`

Rules:

- Open CORS is allowed.
- Requests must not rely on browser sessions or `credentials: include`.
- `Access-Control-Allow-Credentials` must not be enabled.
- These endpoints must not require CSRF tokens.
- Anonymous usage is the baseline supported flow.
- Explicit bearer-token authentication may be supported separately, but browser
  session authentication is out of scope for this route family.

Rationale:

- Third-party websites need a clean, browser-safe contract for shortening
  without inheriting first-party session behavior.
- Splitting public routes from the existing session-aware routes makes the trust
  boundary obvious and testable.

### 3. No CORS Needed

These routes should not depend on fetch/XHR-style cross-origin access.

- `GET /auth/:provider`
- auth callbacks
- `GET /oauth/authorize`
- `GET /s/:code`

Rules:

- These flows are driven by top-level navigation, redirects, or direct browser
  visits rather than cross-origin JavaScript fetches.
- They do not need to be part of the public browser API CORS surface.
- If a route in this family later gains an XHR/fetch use case, it must be
  reclassified explicitly rather than inheriting broad CORS by accident.

Rationale:

- OAuth login and callback flows are redirect-based.
- Short-link resolution at `GET /s/:code` is a normal browser navigation.
- `GET /oauth/authorize` serves the authorization flow, not a cross-origin
  JavaScript API.

## Design Principles

- Do not apply a single global CORS policy to the entire application.
- Route family determines trust level, not HTTP method alone.
- Cookie-backed endpoints stay narrow.
- Public browser endpoints stay stateless from the browser's point of view.
- CSRF protection and CORS are related but distinct controls:
  - first-party browser mutation routes use both trusted-origin checks and CSRF
    validation;
  - public no-credential routes use neither browser-session CSRF bootstrapping
    nor credentialed CORS.

## Operational Expectations

- First-party frontend origins remain environment-configured and exact.
- Runtime source of truth:
  - `src/config.ts`: parses `ALLOWED_FRONTEND_ORIGINS` into
    `allowedFrontendOrigins` and provides `isAllowedFrontendOrigin`.
  - `src/app.ts`: applies `firstPartyCors` to session-backed route families.
  - `.env.example`: currently documents `FRONTEND_URL`; set
    `ALLOWED_FRONTEND_ORIGINS` explicitly in deployed environments.
- Public browser routes are safe to call from arbitrary origins because they do
  not expose or consume browser session state.
- Tests should verify both allowed and denied origin behavior for each policy
  bucket.
- New endpoints must be classified into one of these three buckets before they
  are exposed.
