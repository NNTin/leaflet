# Leaflet Integration Plan

Goal: integrate Leaflet into `lair.nntin.xyz` while serving the frontend from both `https://nntin.xyz/leaflet/` and `https://leaflet.lair.nntin.xyz`, serving the backend and short-link redirects from `https://leaflet.lair.nntin.xyz`, and keeping Postgres off the public edge.

## Checklist

### 1. Choose the routing shape

- [ ] Use `https://nntin.xyz/leaflet/` as the GitHub Pages frontend URL because GitHub Pages already owns the `nntin.xyz` CNAME.
- [ ] Use `https://leaflet.lair.nntin.xyz` as the self-hosted app and API origin.
- [x] Use backend-side short-link redirects as canonical, for example `https://leaflet.lair.nntin.xyz/s/<code>`, so short links return real HTTP redirects without relying on GitHub Pages or browser JavaScript.
- [ ] Route both frontend and backend through Traefik on the same host, `leaflet.lair.nntin.xyz`, with backend routes given a higher priority than the frontend catch-all route.
- [ ] Keep Postgres reachable only from the Leaflet Docker network; do not publish a host port and do not attach it to `lair-network`.

Preferred Traefik split:

```text
Host(`leaflet.lair.nntin.xyz`) && (PathPrefix(`/api`) || PathPrefix(`/auth`) || PathPrefix(`/admin`) || PathPrefix(`/api-docs`) || PathPrefix(`/s/`))
  -> backend, port 3001, high priority

Host(`leaflet.lair.nntin.xyz`) && PathPrefix(`/`)
  -> frontend, port 80, lower priority
```

### 2. Update Docker Compose

- [ ] Add a project-local private network, for example `leaflet-network`.
- [ ] Add the shared external network:

  ```yaml
  lair-network:
    external: true
    name: lair-network
  ```

- [ ] Attach `postgres` only to `leaflet-network`.
- [ ] Replace default Postgres credentials with required production variables, for example `LEAFLET_POSTGRES_PASSWORD`, and use Compose required variable syntax so deployment fails if secrets are missing.
- [ ] Remove the `postgres` host port mapping:

  ```yaml
  ports:
    - "5432:5432"
  ```

- [ ] Attach `backend` to `leaflet-network` and `lair-network`.
- [ ] Replace backend default secret fallbacks with required variables for `SESSION_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`, and `ADMIN_GITHUB_IDS`.
- [ ] Replace the backend host port mapping with `expose: ["3001"]`.
- [ ] Add backend Traefik labels for `leaflet.lair.nntin.xyz` API/auth/admin/api-docs/short-link paths, `websecure`, `letsencrypt`, service port `3001`, and `traefik.docker.network=lair-network`.
- [ ] Remove the backend proxy blocks from `frontend/nginx.conf` for `/api/`, `/auth/`, and `/admin/`; Traefik should route those paths directly to the backend.
- [ ] Attach `frontend` only to `lair-network`; do not attach it to `leaflet-network` after removing the Nginx backend proxy.
- [ ] Replace the frontend host port mapping with `expose: ["80"]`.
- [ ] Add frontend Traefik labels for the `leaflet.lair.nntin.xyz` catch-all route, `websecure`, `letsencrypt`, service port `80`, and `traefik.docker.network=lair-network`.
- [ ] Set explicit Traefik priorities so backend paths win over the frontend SPA fallback.
- [ ] Add Loki logging labels/options consistent with `Tinkero` and `GitTinkerer` if Leaflet should appear in the central logs.
- [ ] Decide whether to add Prometheus scrape labels only after Leaflet exposes a real metrics endpoint.

The root `docker-compose.yml` does not need to join `leaflet-network` if Traefik reaches Leaflet through `lair-network`. This follows the GitTinkerer-style shared edge network while keeping the database on a private project network.

### 3. Split backend URL configuration

Current backend code uses `FRONTEND_URL` for several different concerns. Split those concerns before production deployment:

- [x] Add an allowlist for browser origins, for example `ALLOWED_FRONTEND_ORIGINS=https://nntin.xyz,https://leaflet.lair.nntin.xyz`.
- [x] Use that allowlist in CORS instead of a single `FRONTEND_URL` string.
- [x] Use the same origin allowlist as an additional CSRF origin/referer guard, but do not allow origin-only CSRF bypass for cookie-authenticated mutating requests.
- [x] Require a valid `X-CSRF-Token` for session-cookie mutating requests from both frontend origins.
- [x] Keep the existing CSRF bypass only for validated Bearer/API-key requests, because those requests are not cookie-authenticated.
- [x] Update backend CSRF tests so allowed-origin requests without a valid token are rejected, while valid token requests and Bearer/API-key requests still pass.
- [x] Add `GET /s/:code` on the backend and route it to the same redirect behavior as `GET /api/:code`.
- [x] Keep `GET /api/:code` for the API/backward-compatible redirect contract unless there is a separate decision to remove it.
- [x] Add a canonical short-link base, for example `PUBLIC_SHORT_URL_BASE=https://leaflet.lair.nntin.xyz/s`, and use it when returning `shortUrl` as `${PUBLIC_SHORT_URL_BASE}/${code}`.
- [x] Add a public API origin, for example `PUBLIC_API_ORIGIN=https://leaflet.lair.nntin.xyz`, and use it when serving `/api/openapi.json` so the OpenAPI `servers` array points at production instead of localhost.
- [x] Keep or replace `FRONTEND_URL` with a default post-login redirect URL, for example `DEFAULT_FRONTEND_URL=https://nntin.xyz/leaflet`.
- [x] Support an OAuth `returnTo` value when starting login so login started from `nntin.xyz/leaflet/` returns there and login started from `leaflet.lair.nntin.xyz` returns to the subdomain.
- [x] Store the validated `returnTo` value in the session or a signed OAuth `state` value before redirecting to GitHub.
- [x] Validate any OAuth `returnTo` target against the allowed frontend origins and allowed app paths (`/leaflet/` for `nntin.xyz`, `/` for `leaflet.lair.nntin.xyz`) before redirecting.
- [x] Use the validated `returnTo` target for both OAuth success and failure redirects, then clear it after the callback.
- [ ] Configure GitHub OAuth callback URL as `https://leaflet.lair.nntin.xyz/auth/github/callback`.
- [ ] Require production secrets and database credentials in Compose with required variable syntax; do not keep `leaflet`/`leaflet` database credentials or `change-me-in-production` fallbacks in the production path.
- [ ] Set production backend env:

  ```env
  NODE_ENV=production
  PORT=3001
  TRUST_PROXY=1
  LEAFLET_POSTGRES_PASSWORD=<strong database password>
  DATABASE_URL=postgresql://leaflet:<same strong database password>@postgres:5432/leaflet
  SESSION_SECRET=<strong secret>
  GITHUB_CLIENT_ID=<github oauth client id>
  GITHUB_CLIENT_SECRET=<github oauth client secret>
  GITHUB_CALLBACK_URL=https://leaflet.lair.nntin.xyz/auth/github/callback
  ALLOWED_FRONTEND_ORIGINS=https://nntin.xyz,https://leaflet.lair.nntin.xyz
  PUBLIC_SHORT_URL_BASE=https://leaflet.lair.nntin.xyz/s
  PUBLIC_API_ORIGIN=https://leaflet.lair.nntin.xyz
  DEFAULT_FRONTEND_URL=https://nntin.xyz/leaflet
  ADMIN_GITHUB_IDS=<comma-separated github ids>
  ```

### 4. Make the frontend deployable at both base paths

- [x] Add a Vite base path controlled by env, for example `base: process.env.VITE_BASE_PATH ?? "/"`.
- [x] Configure React Router `BrowserRouter` with a basename derived from the Vite base path.
- [x] Add a central frontend URL helper, for example `frontend/src/urls.ts`, for backend URLs and base-path aware app URLs.
- [x] The helper should expose `apiUrl(path)`, `authUrl(path, returnTo?)`, `adminUrl(path)`, `apiDocsUrl()`, and `appUrl(path)` or equivalent helpers.
- [x] Configure backend URL helpers with:

  - `VITE_API_ORIGIN=""` for the Docker/subdomain build so calls stay same-origin.
  - `VITE_API_ORIGIN="https://leaflet.lair.nntin.xyz"` for the GitHub Pages build.

- [x] Replace hard-coded frontend calls to `/api`, `/auth`, `/admin`, and `/api-docs` with that helper in:

  - `frontend/src/api.ts`
  - `frontend/src/components/Navbar.tsx`
  - `frontend/src/pages/HomePage.tsx`
  - `frontend/src/pages/AdminPage.tsx`
  - `frontend/src/pages/DeveloperPage.tsx`
  - `frontend/src/pages/RedirectPage.tsx`

- [x] Update `frontend/src/api.ts` so both the Axios `baseURL` and CSRF token fetch use the helper and `withCredentials: true`.
- [x] Update `frontend/src/components/Navbar.tsx` so GitHub login uses `authUrl('/github', returnTo)` and logout uses the helper instead of a raw `/auth/logout` fetch.
- [x] Update `frontend/src/pages/DeveloperPage.tsx` so the displayed API base and Swagger spec URL use `VITE_API_ORIGIN`/`apiUrl('/openapi.json')` instead of `window.location.origin`.
- [x] Keep `frontend/src/pages/RedirectPage.tsx` only as a compatibility route if desired; if it remains, make it hand off to the backend `/s/:code` URL instead of implementing canonical short-link redirects in the SPA.
- [x] Fix admin table short-code links so they point to the canonical backend short URL, for example `https://leaflet.lair.nntin.xyz/s/<code>`, not the GitHub Pages SPA route.
- [x] Keep the Docker frontend build at base `/` for `https://leaflet.lair.nntin.xyz`.
- [x] Build the GitHub Pages frontend with:

  ```env
  VITE_BASE_PATH=/leaflet/
  VITE_API_ORIGIN=https://leaflet.lair.nntin.xyz
  ```

- [x] Add a GitHub Pages SPA fallback by copying `dist/index.html` to `dist/404.html`, or choose another explicit fallback strategy, so direct visits to `/leaflet/admin` and `/leaflet/developer` load the React app.
- [x] Do not depend on the GitHub Pages SPA fallback for canonical short-link redirects; those must be served by the backend `/s/:code` route.

### 5. Configure GitHub Pages deployment

- [ ] Treat `projects/leaflet` as the `https://github.com/NNTin/leaflet` git submodule; make GitHub Pages workflow changes in the Leaflet repository, not the `lair.nntin.xyz` parent repository.
- [ ] Add or update the GitHub Actions workflow for the Leaflet frontend build in `https://github.com/NNTin/leaflet`.
- [ ] Build from `frontend` in the Leaflet repository.
- [ ] Create a GitHub Actions Pages pipeline that builds the frontend and publishes the Vite `dist` output to an orphaned GitHub Pages branch, for example `gh-pages`.
- [ ] Ensure the Pages branch contains only the generated frontend output and required static files, not source files or secrets.
- [ ] After creating the pipeline and orphaned Pages branch setup, pause implementation and ask for operator input so GitHub Pages can be enabled in GitHub settings.
- [ ] Resume validation only after the operator confirms GitHub Pages has been enabled for the orphaned Pages branch.
- [ ] Confirm the published page resolves at `https://nntin.xyz/leaflet/`.
- [ ] Confirm direct reloads work for:

  - `https://nntin.xyz/leaflet/`
  - `https://nntin.xyz/leaflet/developer`
  - `https://nntin.xyz/leaflet/admin`

### 6. Configure DNS and certificates

- [ ] Keep the Traefik and backend configuration targeted at `leaflet.lair.nntin.xyz`.
- [ ] Do not perform live Traefik/DNS validation in this implementation pass.
- [ ] If Cloudflare-backed DNS/certificate automation is needed for config rendering, read the Cloudflare token from `projects/leaflet/.env` without exposing or committing it.
- [ ] Leave final DNS resolution and Let's Encrypt certificate issuance validation to the operator/deployment environment.
- [ ] Document that no DNS or Traefik change is expected for `nntin.xyz/leaflet/` beyond the existing GitHub Pages CNAME setup.

### 7. Validate deployment

- [ ] Validate Compose rendering:

  ```bash
  docker compose -f projects/leaflet/docker-compose.yml config
  ```

- [ ] Build and start Leaflet:

  ```bash
  docker compose -f projects/leaflet/docker-compose.yml up -d --build
  ```

- [ ] Confirm Postgres has no published host port:

  ```bash
  docker compose -f projects/leaflet/docker-compose.yml ps
  ```

- [ ] Confirm frontend route:

  ```bash
  curl -I https://leaflet.lair.nntin.xyz/
  ```

- [ ] Confirm backend route:

  ```bash
  curl -I https://leaflet.lair.nntin.xyz/api/openapi.json
  ```

- [ ] Confirm GitHub Pages route:

  ```bash
  curl -I https://nntin.xyz/leaflet/
  ```

- [ ] Confirm backend short-link route returns a real redirect:

  ```bash
  curl -I https://leaflet.lair.nntin.xyz/s/<known-code>
  ```

- [ ] From `https://nntin.xyz/leaflet/`, create a short link and confirm the returned URL starts with `https://leaflet.lair.nntin.xyz/s/`.
- [ ] Open the generated short link directly in a fresh browser session and confirm it redirects to the original URL.
- [ ] From `https://leaflet.lair.nntin.xyz`, create a short link and confirm it also returns the canonical `https://leaflet.lair.nntin.xyz/s/` URL.
- [ ] Confirm a non-browser HTTP client receives a redirect without JavaScript:

  ```bash
  curl -I https://leaflet.lair.nntin.xyz/s/<known-code>
  ```

- [ ] Confirm `/api/openapi.json` lists `https://leaflet.lair.nntin.xyz` in its `servers` array.
- [ ] Confirm the Developer page on both frontend deployments loads Swagger from `https://leaflet.lair.nntin.xyz/api/openapi.json`.
- [ ] Test GitHub OAuth from both frontend deployments and confirm each flow returns to the frontend where it started.
- [ ] Test admin pages and logout from both frontend deployments.

### 8. Follow-up hardening

- [ ] Move secrets into environment files or the deployment secret store; do not commit production secrets.
- [ ] Add a backend health endpoint if Traefik, Compose, or external monitoring should perform HTTP health checks.
- [ ] Review session cookie settings after cross-origin testing between `nntin.xyz` and `leaflet.lair.nntin.xyz`.
- [ ] Document the production URLs and CLI server value in the Leaflet README:

  ```bash
  leaflet-cli --server=https://leaflet.lair.nntin.xyz shorten https://example.com
  ```
