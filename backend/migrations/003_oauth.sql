-- Migration 003: OAuth 2.0 provider tables

CREATE TABLE IF NOT EXISTS oauth_clients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  client_id     TEXT UNIQUE NOT NULL,
  client_secret TEXT,                        -- SHA-256 hash; NULL for public clients
  is_public     BOOLEAN NOT NULL DEFAULT FALSE,
  redirect_uris TEXT[] NOT NULL,
  scopes        TEXT[] NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_oauth_clients_client_id ON oauth_clients(client_id);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  TEXT UNIQUE NOT NULL,
  client_id             TEXT NOT NULL REFERENCES oauth_clients(client_id),
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri          TEXT NOT NULL,
  scopes                TEXT[] NOT NULL,
  code_challenge        TEXT,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256',
  expires_at            TIMESTAMPTZ NOT NULL,
  used_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_codes_code        ON oauth_authorization_codes(code);
CREATE INDEX IF NOT EXISTS idx_auth_codes_expires_at  ON oauth_authorization_codes(expires_at);

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT UNIQUE NOT NULL,
  client_id  TEXT NOT NULL REFERENCES oauth_clients(client_id),
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scopes     TEXT[] NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_access_tokens_hash       ON oauth_access_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_access_tokens_expires_at ON oauth_access_tokens(expires_at);

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash      TEXT UNIQUE NOT NULL,
  access_token_id UUID REFERENCES oauth_access_tokens(id) ON DELETE SET NULL,
  client_id       TEXT NOT NULL REFERENCES oauth_clients(client_id),
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scopes          TEXT[] NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  rotated_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON oauth_refresh_tokens(token_hash);

CREATE TABLE IF NOT EXISTS oauth_consents (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id  TEXT NOT NULL REFERENCES oauth_clients(client_id),
  scopes     TEXT[] NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  UNIQUE (user_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_consents_user_id ON oauth_consents(user_id);

-- Seed the first-party Leaflet CLI public client.
-- client_id: leaflet-cli  (no secret; PKCE-only public client)
-- Supports localhost redirect URIs for loopback-based native app flows (RFC 8252).
INSERT INTO oauth_clients (name, client_id, client_secret, is_public, redirect_uris, scopes)
VALUES (
  'Leaflet CLI',
  'leaflet-cli',
  NULL,
  TRUE,
  ARRAY['http://localhost'],
  ARRAY['shorten:create', 'shorten:create:never', 'shorten:create:alias',
        'urls:read', 'urls:delete', 'user:read', 'admin:*']
)
ON CONFLICT (client_id) DO NOTHING;
