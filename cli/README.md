# Leaflet CLI

`leaflet-cli` is a scriptable HTTP client for the Leaflet backend.

It supports:

- Anonymous shortening with CSRF/session handling
- Token-based authenticated usage
- Human-readable output by default
- Structured JSON output with `--json`

## Build From Source

From the repository root:

```bash
npm install
npm run build --workspace cli
npm link --workspace cli
```

One-line setup:

```bash
npm install && npm run build --workspace cli && npm link --workspace cli
```

## Configuration

The CLI resolves configuration in this order:

1. Command flags
2. Environment variables
3. `~/.leafletrc`
4. Built-in defaults

Stored config path:

```bash
~/.leafletrc
```

Example config:

```json
{
  "server": "http://localhost:3001",
  "token": "your-api-token"
}
```

Supported environment variables:

| Purpose | Preferred | Also supported |
| --- | --- | --- |
| Base URL | `LEAFLET_BASE_URL` | `LEAFLET_API_BASE_URL`, `LEAFLET_SERVER` |
| Token | `LEAFLET_TOKEN` | `LEAFLET_API_TOKEN`, `LEAFLET_API_KEY` |

## Authentication

Store a token locally:

```bash
leaflet-cli auth login --token <API_TOKEN>
```

Remove the stored token:

```bash
leaflet-cli auth logout
```

Inspect the active auth mode:

```bash
leaflet-cli auth status
leaflet-cli auth status --json
```

The CLI verifies tokens against the backend before storing them.

## Commands

### Shorten

```bash
leaflet-cli shorten <url> [options]
```

Options:

- `--ttl <ttl>`: `5m`, `60m`, `24h`, `never`
- `--alias <alias>`: privileged/admin tokens only
- `--server <url>`: override the backend URL
- `--json`: machine-readable output
- `--verbose`: progress logs to stderr
- `--debug`: HTTP request and response logs to stderr

Examples:

```bash
leaflet-cli shorten https://example.com --ttl=60m
leaflet-cli shorten https://example.com --ttl=24h --json
leaflet-cli shorten https://example.com --ttl=24h --alias=my-link
leaflet-cli shorten https://example.com --ttl=never
```

Note:

- `60m` is translated to the backend's current `1h` API value
- `never` requires an admin token

### Delete

```bash
leaflet-cli delete <id>
```

This calls the exposed admin delete endpoint and requires an admin token.

Example:

```bash
leaflet-cli delete 42
leaflet-cli delete 42 --json
```

## Output

Default output is human-readable:

```text
Short URL: http://localhost:5173/s/abc123
Short code: abc123
TTL: 60m
Mode: anonymous
Expires: 2026-04-08T18:00:00.000Z
```

JSON output is stable and machine-readable:

```json
{
  "success": true,
  "shortCode": "abc123",
  "shortUrl": "http://localhost:5173/s/abc123",
  "ttl": "60m",
  "expiresAt": "2026-04-08T18:00:00.000Z",
  "mode": "anonymous"
}
```

Errors are also structured:

```json
{
  "success": false,
  "error": "Invalid TTL value \"10m\".",
  "hint": "Use one of the supported TTL values or run 'leaflet-cli shorten --help'.",
  "usage": "leaflet-cli shorten <url> [options]",
  "example": "leaflet-cli shorten https://example.com --ttl=60m"
}
```

## Help

Each command exposes detailed help:

```bash
leaflet-cli --help
leaflet-cli shorten --help
leaflet-cli auth --help
leaflet-cli delete --help
```
