# Leaflet

A privacy-first, self-hosted URL shortener with expiring links, admin controls, and a developer-friendly API.

## Features

- **URL Shortening** — Create short URLs without an account
- **Expiring Links** — TTL options: 5 minutes, 1 hour, 24 hours (indefinite for admins)
- **GitHub OAuth** — Optional login for enhanced features
- **Role-based Access** — Anonymous, Privileged, and Admin roles
- **Rate Limiting** — 1 request per minute for anonymous users
- **QR Codes** — Auto-generated for every short URL
- **Developer API** — Interactive OpenAPI playground
- **Self-hosted** — Full Docker Compose setup

## Production URLs

- GitHub Pages frontend: `https://nntin.xyz/leaflet/`
- Self-hosted frontend and API: `https://leaflet.lair.nntin.xyz`
- Canonical short links: `https://leaflet.lair.nntin.xyz/s/<code>`
- `https://nntin.xyz/leaflet/` uses the existing GitHub Pages `nntin.xyz` CNAME; it does not need a Traefik route.
- CLI server example:

  ```bash
  leaflet-cli --server=https://leaflet.lair.nntin.xyz shorten https://example.com
  ```

## Quick Start

### Prerequisites
- Docker & Docker Compose
- GitHub OAuth App credentials

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/NNTin/leaflet
   cd leaflet
   ```

2. **Create GitHub OAuth App**
   - Go to https://github.com/settings/applications/new
   - Set production callback URL to `https://leaflet.lair.nntin.xyz/auth/github/callback`
   - Copy Client ID and Client Secret

3. **Configure environment**
   ```bash
   cp backend/.env.example backend/.env
   # Edit backend/.env with your GitHub credentials
   ```

4. **Start with Docker Compose**
   ```bash
   docker-compose up -d
   ```

5. **Access the app**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:3001
   - API Docs: http://localhost:3001/api-docs

### Development Setup

**Backend:**
```bash
cd backend
npm install
cp .env.example .env
# Edit .env
npm run dev
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

## CLI Tool

Build and link the CLI from source:

```bash
npm install
npm run build --workspace cli
npm link --workspace cli
```

Example usage:

```bash
# Anonymous shortening
leaflet-cli shorten https://example.com --ttl=1h

# Store a token locally
leaflet-cli auth login --token <API_TOKEN>

# Privileged alias
leaflet-cli shorten https://example.com --ttl=24h --alias=my-link

# Inspect auth status in JSON
leaflet-cli auth status --json

# Delete a link by id (admin only)
leaflet-cli delete 42
```

CLI config can come from flags, environment variables, or `~/.leafletrc`.
See [cli/README.md](cli/README.md) for command details and JSON output examples.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Backend port | `3001` |
| `DATABASE_URL` | PostgreSQL connection string | - |
| `DATABASE_SSL` | Enable PostgreSQL SSL for external databases | `false` |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | Verify the PostgreSQL SSL certificate when `DATABASE_SSL` is enabled | `false` |
| `SESSION_SECRET` | Session encryption secret | - |
| `TRUST_PROXY` | Number of trusted reverse proxies in front of the backend | `0` |
| `ALLOWED_FRONTEND_ORIGINS` | Comma-separated browser origins allowed for CORS and CSRF origin checks | `http://localhost:5173` |
| `PUBLIC_SHORT_URL_BASE` | Canonical short-link base URL | `http://localhost:3001/s` |
| `PUBLIC_API_ORIGIN` | Public backend origin used in OpenAPI responses | `http://localhost:3001` |
| `DEFAULT_FRONTEND_URL` | Default OAuth post-login redirect target | `http://localhost:5173` |

### GitHub

| Variable | Description |
|----------|-------------|
| `GITHUB_CLIENT_ID` | GitHub OAuth App Client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App Secret |
| `GITHUB_CALLBACK_URL` | OAuth callback URL (defaults to `PUBLIC_API_ORIGIN/auth/github/callback`) |
| `ADMIN_GITHUB_IDS` | Comma-separated GitHub user IDs to auto-promote to admin role |

### Google

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 Client Secret |
| `GOOGLE_CALLBACK_URL` | OAuth callback URL (defaults to `PUBLIC_API_ORIGIN/auth/google/callback`) |

### Discord

| Variable | Description |
|----------|-------------|
| `DISCORD_CLIENT_ID` | Discord OAuth2 Application Client ID |
| `DISCORD_CLIENT_SECRET` | Discord OAuth2 Application Client Secret |
| `DISCORD_CALLBACK_URL` | OAuth callback URL (defaults to `PUBLIC_API_ORIGIN/auth/discord/callback`) |

### Microsoft

| Variable | Description |
|----------|-------------|
| `MICROSOFT_CLIENT_ID` | Microsoft Entra (Azure AD) Application Client ID |
| `MICROSOFT_CLIENT_SECRET` | Microsoft Entra Application Client Secret |
| `MICROSOFT_CALLBACK_URL` | OAuth callback URL (defaults to `PUBLIC_API_ORIGIN/auth/microsoft/callback`) |

### Apple Sign In

| Variable | Description |
|----------|-------------|
| `APPLE_CLIENT_ID` | Apple Services ID (e.g. `com.example.app`) |
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `APPLE_KEY_ID` | Apple Sign In private key ID |
| `APPLE_PRIVATE_KEY` | PEM-formatted `.p8` private key (newlines escaped as `\n`) |
| `APPLE_CALLBACK_URL` | OAuth callback URL (defaults to `PUBLIC_API_ORIGIN/auth/apple/callback`) |

> **Note:** Providers are optional. If a provider's credentials are not set, its login and linking routes return `503`. The Connected Accounts UI displays all providers unconditionally; attempts to link an unconfigured provider will fail with a `503` response until the required credentials are configured.

## API Reference

See the interactive API playground at `/developer` or the OpenAPI spec at `/api/openapi.json`.

### Auth Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/auth/:provider` | Start OAuth login (`github`, `google`, `discord`, `microsoft`, `apple`) |
| `GET` | `/auth/:provider/link` | Link an additional provider to your account (requires session) |
| `GET` | `/auth/:provider/callback` | OAuth callback for GET-based providers |
| `POST` | `/auth/apple/callback` | Apple Sign In callback (form_post response mode) |
| `GET` | `/auth/me` | Get current user |
| `GET` | `/auth/identities` | List connected providers (requires session) |
| `DELETE` | `/auth/identities/:provider` | Disconnect a provider (requires session; guards last identity) |
| `POST` | `/auth/logout` | Log out |
| `POST` | `/auth/merge/initiate` | Start account merge flow (requires session) |
| `POST` | `/auth/merge/confirm` | Confirm and execute account merge (requires session) |

### Other Endpoints

- `POST /api/shorten` — Create a short URL
- `GET /s/:code` — Canonical redirect to original URL
- `GET /api/:code` — Redirect to original URL
- `GET /admin/users` — List users (admin)
- `PATCH /admin/users/:id/role` — Update user role (admin)
- `DELETE /admin/urls/:id` — Delete URL (admin)

## Architecture

```
leaflet/
├── backend/          # Node.js + Express API
│   ├── migrations/   # PostgreSQL schema
│   └── src/
│       ├── routes/   # API routes
│       ├── middleware/
│       └── ...
├── frontend/         # React + Vite SPA
│   └── src/
│       ├── pages/
│       └── components/
├── cli/              # Node.js CLI tool
└── docker-compose.yml
```

## Privacy

- No ads, no tracking, no analytics
- Only minimal logging for rate limiting and system health
- Self-hosted — you control your data
