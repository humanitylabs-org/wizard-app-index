-- Store-shelf grouping from wizard.md `category` (agent | interface | app | system). Optional in wizard.md;
-- when absent the index derives it: type agent -> agent, everything else -> app.
ALTER TABLE apps ADD COLUMN category TEXT NOT NULL DEFAULT 'app';
ALTER TABLE apps ADD COLUMN logo TEXT;
CREATE INDEX apps_listed_category ON apps(listed, category);
