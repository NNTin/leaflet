# Contributing to Leaflet

Thank you for contributing! Please read this guide before opening a pull request.

## Development Setup

```bash
git clone https://github.com/NNTin/leaflet
cd leaflet
npm install
```

Start the backend in development mode:

```bash
cd backend
npm run dev
```

## Running Tests

```bash
npm run test --workspace backend
npm run test --workspace cli
```

## Linting

```bash
npm run lint --workspace backend
npm run lint --workspace frontend
npm run lint --workspace cli
```

## Building

```bash
npm run build --workspace backend
npm run build --workspace cli
```

## OpenAPI Specification

The OpenAPI spec is **generated from code**, not hand-edited.

**Source of truth:** `backend/src/openapi.ts`

- Edit `backend/src/openapi.ts` to add, change, or remove API documentation.
- Do **not** edit a hand-written YAML file — `openapi.yaml` has been removed.
- The spec is imported at runtime and also written to `dist/openapi.json` during build.
- Run `npm run build --workspace backend` to regenerate `dist/openapi.json`.
- The `/api/openapi.json` endpoint and `/api-docs` Swagger UI both reflect the generated spec.

When adding a new route, add the corresponding path entry in `openapi.ts` to keep the spec in sync.

## Engineering Standards

See [AGENTS.md](./AGENTS.md) for the full list of non-negotiable engineering standards, including
type safety, testing strategy, API-first design, and error handling conventions.

## Definition of Done

A change is complete only when:

- [ ] Fully typed (no unsafe types, `strict: true`)
- [ ] Integration tests added/updated
- [ ] API contract updated in `backend/src/openapi.ts` if routes changed
- [ ] Errors handled with the standard `{ success, error, hint }` format
- [ ] No impact on privacy guarantees
- [ ] Lint and tests pass
