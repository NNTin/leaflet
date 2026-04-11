# Leaflet E2E Integration Tests

End-to-end integration tests that exercise the **backend**, **frontend**, and **CLI** together, including a full OAuth PKCE auth flow — without depending on any live third-party provider.

## Architecture

```
e2e/
├── playwright.config.ts    # Playwright config — starts backend + frontend webServers
├── global-setup.ts         # Creates/seeds the leaflet_e2e PostgreSQL database
├── run.sh                  # Build-and-test orchestration script
├── helpers/
│   ├── auth.ts             # Browser session injection, test reset utilities
│   └── cli.ts              # CLI subprocess runner, PKCE flow driver
└── tests/
    ├── browser.spec.ts     # 16 browser tests (Playwright)
    └── cli.spec.ts         # 7 CLI subprocess tests
```

### How it works

A **test-only provider** strategy is used instead of live OAuth providers:

- The backend starts with `E2E_TEST_MODE=true`, which registers a `POST /e2e/login` endpoint that creates a real user row and establishes a real session — bypassing the normal GitHub/Google/etc. OAuth redirects.
- Browser tests inject this session cookie into the Playwright browser context.
- CLI PKCE tests start the real `leaflet-cli auth login` subprocess, intercept the authorization URL from its output, drive the consent form programmatically via raw HTTP, and redirect the authorization code to the CLI's local callback server.
- All real backend routes, middleware, rate limiting, and CSRF protection are active.
- A dedicated `leaflet_e2e` PostgreSQL database is created fresh for each run.

## Running

```bash
# From the repository root — builds everything then runs Playwright
npm run test:e2e

# From the e2e/ directory (after building):
npx playwright test --config playwright.config.ts

# Debug mode:
npx playwright test --config playwright.config.ts --debug
```

## Prerequisites

- PostgreSQL running locally with a `leaflet` user
- `sudo -n -u postgres psql` available **or** the `leaflet` user must be able to create databases (used to create/recreate `leaflet_e2e`)
- Playwright Chromium: run `npx playwright install chromium` the first time

## Test coverage

### Browser tests (`browser.spec.ts`)

| Test | Description |
|------|-------------|
| App loads | Page renders with Leaflet heading |
| Logged-out navbar | Login button visible |
| Login modal opens | Click Login → dialog appears |
| Login modal empty state | No providers configured → empty state message |
| Modal close (Escape) | Keyboard dismiss |
| Modal close (backdrop) | Click outside to dismiss |
| Modal close (button) | Close button dismisses dialog |
| Injected session shows auth navbar | Username shown when session cookie injected |
| Admin link visible for admin | Admin nav link present for admin role |
| Admin link hidden for regular user | Admin nav link absent for user role |
| Authenticated shorten | Logged-in user can shorten via UI → result page |
| Anonymous shorten | Unauthenticated user can shorten via UI → result page |
| `/auth/me` with session | Returns authenticated user JSON |
| `/auth/me` without session | Returns null |
| `/auth/providers` empty | No providers → empty array |
| Short link redirect | `GET /s/{code}` returns 302 → original URL |

### CLI tests (`cli.spec.ts`)

| Test | Description |
|------|-------------|
| Anonymous shorten | `leaflet-cli shorten` without auth returns short URL |
| PKCE login → status → shorten | Full PKCE flow: login, verify status, authenticated shorten |
| Cross-surface user consistency | Browser session + CLI token refer to the same user row |
| Auth logout | `leaflet-cli auth logout` clears stored credentials |
| Invalid token | `LEAFLET_TOKEN=invalid` causes 401 error |
| Providers empty | `GET /auth/providers` returns `[]` |
| GitHub 503 | Unconfigured provider returns 503 |

## Customization

| Environment variable | Default | Description |
|---------------------|---------|-------------|
| `E2E_DATABASE_URL` | `postgresql://leaflet:leaflet@localhost:5432/leaflet_e2e` | Database URL for the test DB |

The backend port (3099) and frontend port (5099) are defined in `playwright.config.ts`.
