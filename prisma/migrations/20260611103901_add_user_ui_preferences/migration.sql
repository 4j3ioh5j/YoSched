-- Add User.uiPreferences: per-login UI state persisted server-side so it follows the
-- login across browsers/devices (not localStorage). First consumer is the /users table
-- sort order, stored under { usersTableSort: { column, dir } }. Additive nullable-default
-- JSONB column — no row rewrite, existing rows get '{}'.

ALTER TABLE "users" ADD COLUMN "uiPreferences" JSONB NOT NULL DEFAULT '{}';
