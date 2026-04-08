# Leaflet CLI

A command-line tool for interacting with your [Leaflet](https://github.com/NNTin/leaflet) URL shortener instance.

## Installation

```bash
cd cli
npm install
npm link
```

## Configuration

Copy `.env.example` to `.env` and set your server and optional API key:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|----------|-------------|---------|
| `LEAFLET_SERVER` | URL of your Leaflet backend | `http://localhost:3001` |
| `LEAFLET_API_KEY` | API key for authenticated requests (see below) | *(empty)* |

### Getting an API key

1. Log in to your Leaflet instance via GitHub OAuth in the browser.
2. Visit `http://your-server/auth/api-key` (or use curl with your session cookie):
   ```bash
   curl -b "connect.sid=<your-session>" http://localhost:3001/auth/api-key
   ```
3. Copy the returned `apiKey` value into your `.env` file as `LEAFLET_API_KEY`.

API keys are required for privileged operations (custom aliases) and admin operations (never-expiring links).

## Usage

### Shorten a URL

```bash
leaflet-cli shorten <url> [options]
```

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--ttl <ttl>` | Expiry time: `5m`, `1h`, `24h`, `never` | `24h` |
| `--alias <alias>` | Custom short-code alias (requires privileged/admin API key) | *(none)* |
| `--api-key <key>` | API key for authentication | `$LEAFLET_API_KEY` |
| `--server <url>` | Leaflet server base URL | `$LEAFLET_SERVER` |

### Examples

```bash
# Basic shortening (anonymous, expires in 24 hours)
leaflet-cli shorten https://example.com

# Short expiry
leaflet-cli shorten https://example.com --ttl=5m

# Custom alias (requires privileged or admin API key)
leaflet-cli shorten https://example.com --alias=my-link --api-key=your-key

# Point to a remote server
leaflet-cli shorten https://example.com --server=https://your-domain.com

# Never expire (admin only)
leaflet-cli shorten https://example.com --ttl=never --api-key=your-admin-key
```

### Example output

```
✓ Short URL created!

Short URL:  https://your-domain.com/s/abc123
Expires:    in 24 hours

Copy: https://your-domain.com/s/abc123
```

## Development

```bash
# Run without linking
node index.js shorten https://example.com
```
