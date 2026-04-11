-- Migration 005: Introduce unified identity model for multi-provider login.
--
-- Creates user_identities table and backfills existing GitHub users so that
-- downstream code can migrate off users.github_id without data loss.
-- users.github_id is made nullable here; it will be dropped in migration 006
-- once no code depends on it.

CREATE TABLE IF NOT EXISTS user_identities (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL,               -- 'github', 'google', 'discord', 'microsoft', 'apple'
  provider_user_id    TEXT NOT NULL,               -- opaque string ID from the provider
  display_name        TEXT,                        -- display name / username from provider (nullable)
  email               TEXT,                        -- email from provider (nullable; advisory only)
  email_verified      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_user_id),             -- one identity per (provider, external ID)
  UNIQUE (user_id, provider)                       -- one provider per user
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user_id  ON user_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_user_identities_provider ON user_identities(provider, provider_user_id);

-- Backfill GitHub identities from existing users rows.
-- ON CONFLICT is a safety net for re-entrant migrations.
INSERT INTO user_identities (user_id, provider, provider_user_id, display_name, email_verified)
SELECT id, 'github', github_id, username, FALSE
FROM users
WHERE github_id IS NOT NULL
ON CONFLICT (provider, provider_user_id) DO NOTHING;

-- Allow github_id to be null now that identities hold the canonical link.
-- We keep the column so that migration 006 can drop it cleanly after code
-- is fully off it.
ALTER TABLE users
  ALTER COLUMN github_id DROP NOT NULL;

-- Merge audit log for account consolidations.
CREATE TABLE IF NOT EXISTS account_merge_log (
  id            SERIAL PRIMARY KEY,
  surviving_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merged_user_id    INTEGER NOT NULL,               -- kept after user row deleted
  merged_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  initiated_by      INTEGER REFERENCES users(id) ON DELETE SET NULL
);
