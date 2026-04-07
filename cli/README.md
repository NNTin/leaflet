# Leaflet CLI

A command-line tool for interacting with your [Leaflet](https://github.com/NNTin/leaflet) URL shortener instance.

## Installation

```bash
cd cli
npm install
npm link
```

## Configuration

Copy `.env.example` to `.env` and set your server and optional token:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|----------|-------------|---------|
| `LEAFLET_SERVER` | URL of your Leaflet backend | `http://localhost:3001` |
| `LEAFLET_TOKEN` | Session token for authenticated requests | *(empty)* |

## Usage

### Shorten a URL

```bash
leaflet-cli shorten <url> [options]
```

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--ttl <ttl>` | Expiry time: `5m`, `1h`, `24h`, `never` | `24h` |
| `--alias <alias>` | Custom short-code alias (requires auth token) | *(none)* |
| `--token <token>` | API / session token | `$LEAFLET_TOKEN` |
| `--server <url>` | Leaflet server base URL | `$LEAFLET_SERVER` |

### Examples

```bash
# Basic shortening (expires in 24 hours)
leaflet-cli shorten https://example.com

# Short expiry
leaflet-cli shorten https://example.com --ttl=5m

# Custom alias (requires a valid auth token)
leaflet-cli shorten https://example.com --alias=my-link --token=your-token

# Point to a remote server
leaflet-cli shorten https://example.com --server=https://your-domain.com

# Never expire (admin/privileged only)
leaflet-cli shorten https://example.com --ttl=never --token=your-admin-token
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
