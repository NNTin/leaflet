# Contributing To Leaflet 🌱💌

Thanks for contributing to Leaflet.

This guide explains how to run the project locally, verify changes, and submit pull requests without regressing auth, OAuth, or CI behavior.

## Development Principles

- Keep changes focused and easy to reason about.
- Preserve privacy-first behavior.
- Prefer integration tests for behavior changes.
- Avoid introducing compatibility shortcuts that weaken auth, scope checks, role checks, or CSRF behavior.
- Update API docs from `backend/src/openapi.ts` instead of editing generated output.

## Repository Layout

- `backend`: Express + TypeScript + PostgreSQL API
- `frontend`: React + Vite application
- `cli`: TypeScript CLI that talks to the backend over HTTP
- `e2e`: Playwright end-to-end suite covering backend, frontend, and CLI together

## Prerequisites

- Node.js 20 recommended
- npm
- Docker
- PostgreSQL with `psql` available if you run backend migrations or e2e outside Docker
- `act` optional for local GitHub Actions verification

## Initial Setup

1. Clone the repository.
2. Install dependencies from the workspace root:

```bash
npm install
```

## Run The Project

### Option 1: Local Services

This is the easiest setup for normal development.

Backend:

```bash
npm run dev --workspace backend
```

Frontend:

```bash
npm run dev --workspace frontend
```

CLI:

```bash
npm run build --workspace cli
node cli/dist/index.js --help
```

### Option 2: Docker Compose

The checked-in Compose setup is production-shaped, not local-dev-shaped.

- It expects a root `.env` with required variables.
- It expects the external Docker network `lair-network` to already exist.
- It uses `expose` instead of `ports`, so host ports are not published by default.

Start it from the repository root:

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 backend frontend postgres
```

If you need host-accessible ports for browser work, use a temporary Compose override that adds `ports`.

## Database Migrations

Apply SQL migrations from a shell where PostgreSQL tools are available:

```bash
npm run migrate --workspace backend
```

Notes:

- The backend container does not include `psql`.
- If you use Docker, run migrations from the host or the Postgres container instead.
- Reused Postgres volumes do not replay init scripts automatically.

## Quality Checks

Run these before opening a pull request:

```bash
npm run lint --workspace backend
npm run lint --workspace frontend
npm run lint --workspace cli
npm run build --workspace backend
npm run test --workspace backend
npm run test --workspace cli
npm run build --workspace cli
```

## End-To-End Tests

Run the full stack suite from the repository root:

```bash
npm run test:e2e
```

Local e2e notes:

- The e2e suite builds backend, frontend, and CLI before running Playwright.
- It expects PostgreSQL to be reachable locally for the `leaflet` user.
- On a fresh machine, install Playwright Chromium once:

```bash
cd e2e
npx playwright install chromium
```

## CI And `act`

GitHub Actions CI is defined in `.github/workflows/ci.yml`.

It validates:

- backend build and tests
- frontend typecheck and build
- CLI build and tests
- Playwright e2e with PostgreSQL

To run the same CI job locally with `act`:

```bash
act pull_request -W .github/workflows/ci.yml -j build-test
```

Repository-local `act` notes:

- `.actrc` is checked in and pins the recommended `ubuntu-latest` image.
- `.github/act.env` is checked in as an intentionally minimal env file.
- That empty env file prevents your root `.env` from leaking production-like secrets or provider credentials into the local CI simulation.
- `act` requires Docker.
- `act` may print cache warnings from `actions/setup-node`; those warnings are expected because GitHub's cache service is not available locally.

## OpenAPI

The OpenAPI spec is generated from code.

- Source of truth: `backend/src/openapi.ts`
- Generated output: `backend/dist/openapi.json`
- Regenerate it with:

```bash
npm run build --workspace backend
```

## Pull Request Checklist

- Change is fully typed and passes TypeScript checks.
- Tests were added or updated for non-trivial behavior changes.
- Browser-session and OAuth Bearer auth paths were both verified when auth-related code changed.
- Lint, tests, and required builds pass locally.
- No sensitive data is logged.
- API behavior remains documented when routes or payloads change.

## Commit And Review Guidance

- Keep commits small and descriptive.
- Include a clear problem statement in the pull request description.
- Mention any migration, auth, scope, role, or CI impact explicitly.
