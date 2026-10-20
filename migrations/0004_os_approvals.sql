-- One-time Wizard OS install approvals (www.aiwizards.com/os-approve). A box that needs administrator rights once
-- registers a short-lived request with its own RSA public key; the owner's browser encrypts their server password to
-- that key; the box picks the ciphertext up once and the row is deleted. Nothing here can decrypt anything.
--   id          sha256(capability) hex; the capability itself only ever sits in the link's #fragment
--   pickup_hash sha256(pickup secret) hex; only the box knows the pickup secret
--   ct          base64 RSA-OAEP ciphertext (NULL until the owner submits)
CREATE TABLE os_approvals (
  id          TEXT PRIMARY KEY,
  pickup_hash TEXT NOT NULL,
  pubkey      TEXT NOT NULL,
  host        TEXT NOT NULL,
  user        TEXT NOT NULL,
  needs       TEXT NOT NULL DEFAULT '[]',
  attempt     INTEGER NOT NULL DEFAULT 1,
  ct          TEXT,
  -- pending | submitted | picked_up | approved | wrong_password | not_sudoer | failed (sanitized outcome only)
  state       TEXT NOT NULL DEFAULT 'pending',
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX os_approvals_expires ON os_approvals(expires_at);
-- Fixed-window rate limits keyed by sha256(scope|window|ip); raw IPs are never stored. Pruned by the cron.
CREATE TABLE os_approval_rate (
  key    TEXT PRIMARY KEY,
  win    INTEGER NOT NULL,
  count  INTEGER NOT NULL DEFAULT 0
);
