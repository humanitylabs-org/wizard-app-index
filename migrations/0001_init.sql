-- Wizard App Index: a rebuildable discovery cache. The app repos are the source of truth.
-- One row per source repo (key = "github:owner/repo"). wizard.md ids are NOT globally unique
-- (anyone can publish), so the repo is the identity and the wizard id is the install name.
CREATE TABLE apps (
  key            TEXT PRIMARY KEY,          -- github:owner/repo (lowercased)
  host           TEXT NOT NULL,             -- github (later: other git hosts, nostr)
  owner          TEXT NOT NULL,             -- publisher account on the host
  repo           TEXT NOT NULL,
  repo_url       TEXT NOT NULL,
  commit_sha     TEXT NOT NULL,             -- the exact commit that passed; installs pin to it
  ref            TEXT,                      -- branch the commit came from
  app_id         TEXT NOT NULL,             -- wizard.md id (install name on a box)
  name           TEXT NOT NULL,
  summary        TEXT NOT NULL,
  type           TEXT NOT NULL,
  version        TEXT NOT NULL,
  license        TEXT,
  publisher_npub TEXT,
  provides       TEXT NOT NULL DEFAULT '[]', -- JSON arrays
  uses           TEXT NOT NULL DEFAULT '[]',
  needs          TEXT NOT NULL DEFAULT '[]',
  architectures  TEXT NOT NULL DEFAULT '[]',
  manifest       TEXT NOT NULL,             -- full wizard.md front matter as JSON
  found_via      TEXT NOT NULL,             -- publish | crawl
  first_seen     INTEGER NOT NULL,
  checked_at     INTEGER NOT NULL,
  listed         INTEGER NOT NULL DEFAULT 1 -- 0 = last check failed or repo gone (kept for history)
);
CREATE INDEX apps_listed_app_id ON apps(listed, app_id);
CREATE INDEX apps_owner ON apps(owner);
CREATE INDEX apps_checked ON apps(checked_at);

CREATE TABLE app_slots (
  key  TEXT NOT NULL,
  slot TEXT NOT NULL,
  PRIMARY KEY (slot, key)
);

CREATE VIRTUAL TABLE apps_fts USING fts5(key UNINDEXED, name, summary, body, provides, owner, tokenize = 'porter unicode61');

-- Last check result for every repo we were told about, pass or fail, so publishers can see why.
CREATE TABLE checks (
  key        TEXT PRIMARY KEY,
  commit_sha TEXT,
  ok         INTEGER NOT NULL,
  failures   TEXT NOT NULL DEFAULT '[]',
  checked_at INTEGER NOT NULL
);

-- Repos waiting to be (re)checked: found by the crawler, or stale listings.
CREATE TABLE queue (
  key      TEXT PRIMARY KEY,                -- github:owner/repo (lowercased)
  full     TEXT NOT NULL,                   -- Owner/Repo as GitHub spells it
  reason   TEXT NOT NULL,
  added_at INTEGER NOT NULL
);

CREATE TABLE crawl_state (
  name  TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
