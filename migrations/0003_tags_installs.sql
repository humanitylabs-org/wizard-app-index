-- Purpose tags from wizard.md `tags` (fixed list, max 3; see src/checker.js TAGS). JSON array on apps,
-- plus one row per tag for filtering, like app_slots.
ALTER TABLE apps ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
CREATE TABLE app_tags (
  key TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (tag, key)
);
CREATE INDEX app_tags_key ON app_tags(key);

-- Anonymous install counts per listing. Not part of the rebuildable cache: dropping it resets counts.
CREATE TABLE installs (
  key   TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);
-- Dedupe: one count per (app, client, UTC day). hash = sha256("day|ip|key"); raw IPs are never stored.
-- Pruned to the last 2 days by the cron.
CREATE TABLE install_seen (
  day  TEXT NOT NULL,
  hash TEXT NOT NULL,
  PRIMARY KEY (day, hash)
);
CREATE INDEX apps_first_seen ON apps(listed, first_seen);
