# Leaflet 🌱💌

Leaflet is a privacy-first URL shortener with short-lived links, optional authentication, and a self-hosted backend.

## Live Deployments

- Frontend (GitHub Pages): https://nntin.xyz/leaflet/
- Backend (self-hosted): https://leaflet.lair.nntin.xyz

## What It Does

- Shorten URLs quickly without requiring an account.
- Keep most links short-lived by design.
- Restrict never-expiring links to admins only.
- Offer CLI and third-party integrations through OAuth 2.0.

## Privacy And Abuse Prevention

- Authentication is optional for creating short links.
- Authenticated users get less restrictive rate limits than anonymous users.
- To combat abuse, Leaflet stores who created each short URL.
- URL records are not intended for permanent storage; links are short-lived by nature.
- Only admins can create URLs that never expire.
- No ads, no analytics, and no tracking scripts.

## OAuth 2.0 Integrations

Leaflet includes an OAuth 2.0 Authorization Server so external tools can connect safely.

- Existing integration example: https://nntin.xyz/leafspots/
- CLI
  - The CLI uses this same OAuth 2.0 integration (Authorization Code + PKCE).
  - This means CLI authentication and third-party app authentication share one unified OAuth server.
  - Authenticated CLI usage benefits from less restrictive rate limits than anonymous traffic.
  - This is useful for chatbot integrations that need per-message or per-campaign links.
  - CLI-based workflows are well-suited for scheduled tasks, bots, and agent-driven automation.
- Current identity provider support: GitHub
- Planned identity provider support: Apple, Google, Microsoft, Discord

## API Documentation

Developer API and endpoint documentation are available at:

- https://nntin.xyz/leaflet/developer

## Contributing

For local setup, development workflow, testing, local CI verification with `act`, and run instructions, see [CONTRIBUTING.md](CONTRIBUTING.md).
