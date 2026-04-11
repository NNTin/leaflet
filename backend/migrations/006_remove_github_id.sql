-- Migration 006: Drop the now-superseded users.github_id column.
--
-- This migration must only run after backend code has been fully migrated
-- to use user_identities and no longer reads or writes users.github_id.

ALTER TABLE users
  DROP COLUMN IF EXISTS github_id;
