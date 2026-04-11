# Contributing To Leaflet 🌱💌

Thanks for contributing to Leaflet.

This guide explains how to run the project locally, test your changes, and submit high-quality pull requests.

## Development Principles

- Keep changes focused and easy to reason about.
- Preserve privacy-first behavior.
- Prefer integration tests for behavior changes.
- Avoid introducing compatibility shortcuts that weaken auth, scope checks, or role checks.

## Repository Layout

- backend: Express + TypeScript + PostgreSQL API
- frontend: React + Vite application
- cli: TypeScript CLI that talks to backend over HTTP

## Prerequisites

- Node.js 18+
- npm 9+
- Docker and Docker Compose (recommended for full-stack local runs)
- A running PostgreSQL instance for backend development outside Docker

## Initial Setup

1. Clone the repository.
2. Install dependencies from the workspace root:

```bash
npm install
```

## Run The Project

You can run Leaflet either with Docker Compose or as separate local services.

### Option 1: Docker Compose (recommended)

From the repository root:

```bash
docker compose up -d --build
```

Check status and logs:

```bash
docker compose ps
docker compose logs --tail=100 backend frontend postgres
```

Default production-like URLs in this repository:

- Frontend: https://nntin.xyz/leaflet/
- Backend: https://leaflet.lair.nntin.xyz

For local browser validation, you may use a compose override that publishes host ports.

### Option 2: Local Services

Run each workspace in separate terminals.

Backend:

```bash
npm run dev --workspace backend
```

Frontend:

```bash
npm run dev --workspace frontend
```

CLI (build once, then run commands):

```bash
npm run build --workspace cli
node cli/dist/index.js --help
```

## Database Migrations

Apply SQL migrations from a shell where PostgreSQL tools are available:

```bash
npm run migrate --workspace backend
```

If you use Docker and the backend container lacks PostgreSQL client tools, run migrations from the host or the Postgres container.

## Quality Checks

Run these before opening a pull request:

```bash
npm run lint
npm run test
npm run build --workspace cli
```

Useful targeted commands:

```bash
npm run test --workspace backend
npm run test --workspace cli
npm run lint --workspace backend
npm run lint --workspace frontend
npm run lint --workspace cli
```

## API And OAuth Notes

- API and endpoint docs are published at https://nntin.xyz/leaflet/developer.
- OAuth 2.0 is integrated for third-party tools.
- GitHub is currently supported as an identity provider.
- Planned providers include Apple, Google, Microsoft, and Discord.

## Privacy And Authentication Expectations

- Authentication is optional for link creation.
- Authenticated users receive less restrictive rate limits.
- The system records who created a URL to reduce abuse.
- URLs are short-lived by default and not intended for permanent retention.
- Never-expiring URLs are admin-only.

## Pull Request Checklist

- Change is fully typed and passes TypeScript checks.
- Tests were added or updated for non-trivial behavior changes.
- Lint and tests pass locally.
- No sensitive data is logged.
- API behavior remains consistent and documented.

## Commit And Review Guidance

- Keep commits small and descriptive.
- Include a clear problem statement in PR descriptions.
- Mention any migration, auth, or role/scope impact explicitly.
