# Leaflet Agent Notes

This repo is a small monorepo with shared auth behavior across backend, frontend, and CLI. Read this before changing auth, OAuth, or local dev tooling.

## Repo Map

- Root uses npm workspaces.
- `backend`: Express + TypeScript + PostgreSQL. Handles session auth, GitHub login, OAuth app/token flows, and SQL migrations.
- `frontend`: React + Vite.
- `cli`: TypeScript CLI that talks to the backend over HTTP and uses OAuth PKCE for login.

Useful workspace commands:

```bash
npm run lint --workspace backend
npm run lint --workspace frontend
npm run lint --workspace cli
npm run test --workspace backend
npm run test --workspace cli
npm run build --workspace cli
```

## Auth Invariants

The current auth model is intentional. Do not reintroduce removed legacy behavior.

- Browser/UI flows still use session auth.
- Bearer auth means OAuth access tokens only.
- API key auth is fully removed.
- Session-authenticated browser requests do not need OAuth scopes.
- Bearer OAuth requests must satisfy required scopes.
- Bearer OAuth requests must also satisfy role checks where the route is privileged.
- CSRF still applies to session/browser mutation flows and stays exempt for token-based machine flows where designed.

Standard auth outcomes:

- `401`: unauthenticated, invalid token, expired token, or revoked token
- `403`: insufficient scope or insufficient role
- Insufficient-scope responses should include a helpful `hint`

## Scope And Role Matrix

These are the important route rules currently wired into the backend:

- `GET /auth/me`: scope `user:read`
- `POST /api/shorten`: scope `shorten:create`
- `POST /api/shorten` with `alias`: scopes `shorten:create` + `shorten:create:alias`, role `privileged` or `admin`
- `POST /api/shorten` with `ttl=never`: scopes `shorten:create` + `shorten:create:never`, role `admin`
- `GET /api/urls`: scope `urls:read`, role `admin`
- `GET /admin/urls`: scope `urls:read`, role `admin`
- `DELETE /api/urls/:id`: scope `urls:delete`, role `admin`
- `DELETE /admin/urls/:id`: scope `urls:delete`, role `admin`
- `GET /admin/users`: scope `users:read`, role `admin`
- `PATCH /admin/users/:id/role`: scope `users:write`, role `admin`
- `GET /oauth/apps`: scope `oauth:apps:read`
- `POST /oauth/apps`: scope `oauth:apps:write`
- `DELETE /oauth/apps/:clientId`: scope `oauth:apps:write`, plus owner-or-admin check

For session-authenticated browser requests, keep the existing role and ownership checks and do not require OAuth scopes.

## Backend Notes

- The Bearer fallback to `users.api_key` is gone. Do not add it back.
- API-key-specific auth state and code paths were removed.
- The API key issuance endpoint was removed from both runtime behavior and OpenAPI.
- Scope middleware exists in the codebase and is now used on real routes. Prefer reusing it instead of open-coding scope checks.

Helpful files:

- `backend/src/middleware/auth.ts`
- `backend/src/oauth/scopes.ts`
- `backend/src/oauth/tokens.ts`
- `backend/src/routes/auth.ts`
- `backend/src/routes/urls.ts`
- `backend/src/routes/admin.ts`
- `backend/src/routes/oauth.ts`

## Database And Migration Notes

- `backend/migrations/004_remove_api_key.sql` removes `users.api_key` and `idx_users_api_key`.
- Fresh-db bootstrap is acceptable. Data preservation is not a goal for this migration line.
- `backend/package.json` contains a `migrate` script that loops over SQL files with `psql`.

Important Docker caveat:

- The backend container does not include `psql`.
- `docker compose exec backend npm run migrate` fails inside that container.
- Run migrations from the host or from the Postgres container instead.
- If a Compose Postgres volume already exists, new init scripts are not replayed automatically. Apply migrations manually when reusing volumes.

## CLI Notes

- OAuth PKCE is the primary login path.
- Manual/headless fallback still exists and should keep working.
- Legacy CLI token login mode was removed.
- Stored config should only persist `oauth`.
- Legacy env aliases tied to API key behavior were removed. Do not revive them.
- `LEAFLET_TOKEN` still works as a direct Bearer token override.
- `LEAFLET_SERVER` is supported and is the easiest way to point the CLI at a local or Docker backend.
- `auth status` calls `/auth/me` and reports granted scopes.

Helpful files:

- `cli/src/cli.ts`
- `cli/src/config.ts`
- `cli/src/http.ts`
- `cli/src/__tests__/cli.test.ts`

## Testing Notes

Known-good verification commands:

```bash
npm run test --workspace backend
npm run test --workspace cli
npm run build --workspace cli
```

Backend auth test patterns:

- Session-authenticated browser tests use the exported `sessionStore` from `backend/src/app.ts`.
- The common session flow in tests is:
  1. Hit `/auth/csrf-token`
  2. Find the created session in `sessionStore`
  3. Inject `passport.user`
- OAuth bearer tests use `issueAccessToken(...)`.

When changing auth behavior, cover at least:

- valid Bearer token acceptance
- invalid, expired, and revoked Bearer rejection with `401`
- missing-scope rejection with `403`
- role-plus-scope cases for privileged endpoints
- session browser behavior without OAuth scope requirements
- CSRF enforcement on session mutation routes

## Docker And Local Browser Notes

The checked-in Docker setup is production-shaped, not local-dev-shaped.

- `docker-compose.yml` expects a root `.env` with the required variables.
- It also expects the external Docker network `lair-network` to already exist.
- The checked-in compose file uses `expose`, not `ports`, for the app containers.
- Do not assume host access to `3001` or `4173` after a normal rebuild.
- If containers currently show published host ports, they were likely started with an override file and a plain `docker compose up -d --build` will remove that host mapping.

Standard rebuild flow:

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=80 backend frontend postgres
```

For Docker-only smoke tests, run from inside the Docker network instead of relying on host ports.

- From inside `leaflet-backend-1`, the backend is `http://localhost:3001`.
- From inside `leaflet-backend-1`, the frontend is reachable as `http://leaflet-frontend-1/` over `lair-network`.
- If you need host-accessible ports for manual browser work, use a temporary override file that adds `ports`.

Important production-cookie caveat:

- The backend container runs with `NODE_ENV=production`.
- Session cookies are `Secure`, so container-local requests to `/auth/csrf-token` will not receive a session cookie unless the request includes `X-Forwarded-Proto: https`.
- This matters for any Docker smoke test that exercises session-backed browser flows.

Known-good Docker smoke sequence after `docker compose up -d --build`:

- `GET http://leaflet-frontend-1/` from inside `leaflet-backend-1` and confirm the HTML contains the React root.
- Fetch one referenced frontend asset from `/assets/...` and expect `200`.
- `GET http://localhost:3001/auth/csrf-token` with `X-Forwarded-Proto: https`.
- `POST http://localhost:3001/api/shorten` with the returned session cookie and CSRF token.
- `GET http://localhost:3001/s/<shortCode>` with `redirect: manual` and expect a `302` to the original URL.

A working result from that exact smoke flow was:

- frontend HTML: `200`
- frontend asset: `200`
- CSRF token: `200`
- anonymous shorten: `201`
- short redirect: `302`

CLI against Docker backend:

```bash
LEAFLET_SERVER=http://localhost:3001
HOME=/tmp/leaflet-cli-home node cli/dist/index.js auth login --verbose --json
HOME=/tmp/leaflet-cli-home node cli/dist/index.js auth status --json
HOME=/tmp/leaflet-cli-home node cli/dist/index.js shorten https://example.com/test --ttl 24h --json
```

Frontend/browser caveats:

- The Compose frontend is static nginx and is not automatically wired for local backend auth and CORS experiments.
- For local browser validation, previewing a built frontend is safer than using Vite dev.
- A working local flow was:

```bash
cd frontend
VITE_API_ORIGIN=http://localhost:3001 npm run build
npm run preview -- --host 127.0.0.1 --port 4174
```

- For session-browser validation, the backend may need `ALLOWED_FRONTEND_ORIGINS` updated to include local preview origins.
- `frontend/vite.config.ts` currently proxies `'/s'` to the backend. That collides with `/src/*` in dev mode and can break `vite dev`. If frontend assets start 404ing in dev, check that proxy rule first.

## Playwright Notes

Recent local browser validation covered:

- app load
- authenticated UI state using a backend session cookie
- successful shorten flow
- non-admin denial on admin UI routes

The deployed site at `https://nntin.xyz/leaflet/` was smoke-checked as a baseline only. If you need to validate a new change there, commit and push first, then wait for GitHub Pages propagation.

## Documentation Caveat

- Do not assume docs are the source of truth for current auth behavior.

## Practical Guidance

- Keep changes focused. This repo is small enough that auth regressions usually come from "helpful" compatibility fallbacks.
- If you touch auth, test both session/browser and Bearer OAuth paths.
- If you touch CLI auth, verify `auth login`, `auth status`, token refresh, and at least one real command such as `shorten`.
- If you touch migrations, validate both a fresh database and an existing Docker volume workflow.
