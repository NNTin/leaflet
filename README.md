# 🌱 Leaflet

A privacy-first, self-hosted URL shortener with expiring links, admin controls, and a developer-friendly API.

## Features

- 🔗 **URL Shortening** — Create short URLs without an account
- ⏱ **Expiring Links** — TTL options: 5 minutes, 1 hour, 24 hours (indefinite for admins)
- 🔐 **GitHub OAuth** — Optional login for enhanced features
- 👑 **Role-based Access** — Anonymous, Privileged, and Admin roles
- 🛡 **Rate Limiting** — 1 request per minute for anonymous users
- 📱 **QR Codes** — Auto-generated for every short URL
- 🧑‍💻 **Developer API** — Interactive OpenAPI playground
- 📦 **Self-hosted** — Full Docker Compose setup

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
   - Set callback URL to `http://localhost:3001/auth/github/callback`
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

Install and use the CLI tool:

```bash
cd cli
npm install
npm link

# Shorten a URL
leaflet-cli shorten https://example.com --ttl=24h

# With custom alias (requires auth token)
leaflet-cli shorten https://example.com --alias=my-link --api-key=your-api-key

# With custom server
leaflet-cli shorten https://example.com --server=https://your-domain.com
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Backend port | `3001` |
| `DATABASE_URL` | PostgreSQL connection string | - |
| `SESSION_SECRET` | Session encryption secret | - |
| `GITHUB_CLIENT_ID` | GitHub OAuth App Client ID | - |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App Secret | - |
| `GITHUB_CALLBACK_URL` | OAuth callback URL | - |
| `FRONTEND_URL` | Frontend URL for CORS | `http://localhost:5173` |
| `ADMIN_GITHUB_IDS` | Comma-separated GitHub IDs for auto-admin | - |

## API Reference

See the interactive API playground at `/developer` or the OpenAPI spec at `/api/openapi.json`.

### Endpoints

- `POST /api/shorten` — Create a short URL
- `GET /api/:code` — Redirect to original URL
- `GET /auth/github` — Start GitHub OAuth
- `GET /auth/me` — Get current user
- `POST /auth/logout` — Logout
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