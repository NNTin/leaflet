-- Migration 004: remove legacy API key storage
DROP INDEX IF EXISTS idx_users_api_key;
ALTER TABLE users DROP COLUMN IF EXISTS api_key;
