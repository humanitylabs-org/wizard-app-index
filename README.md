# Wizard App Index

Discovery for Wizard apps, live at https://apps.aiwizards.com (Cloudflare Worker + D1, Humanity Labs account).

The app repos are the source of truth. The index is a cache: every listing is re-read from the app's own repo at a pinned commit, so the database can be dropped and rebuilt.

- Search: `GET /v1/search?q=&category=&tag=&slot=&type=&publisher=&arch=&id=&sort=&limit=&offset=` → `{apps, next_offset}`. Every app has `tags` and `installs`. `sort=popular` (installs), `new` (first seen), `name` (default; with `q` the default is relevance).
- Purpose tags in use: `GET /v1/tags` → `{tags:[{id, count}]}`. wizard.md `tags:` is optional, max 3, from: video, audio, photos, writing, research, finance, productivity, communication, developer, automation, security, data, home, learning.
- Anonymous install count: `POST /v1/installs {"id":"app-id","repo":"owner/name"}` (repo optional) → `{ok, installs}`. Counted once per app, client and UTC day; only a SHA-256 of day|IP|app is kept (never the IP), for 2 days.
- Publish: `POST /v1/publish {"repo":"owner/name"}`, or a GitHub webhook (push events) to the same URL
- Why a repo isn't listed: `GET /v1/apps/{owner}/{repo}`
- Crawler (every 10 min): GitHub topic `wizard-app` (and `wizard-ai` during the transition), split into created-date slices so no query hits GitHub's 1,000-result cap; listings are re-verified weekly.

To publish an app: public repo, `wizard.md` at the root that passes the checker (spec: humanitylabs-org/wizard-os `spec/WIZARD_MD.md`), topic `wizard-app`, then publish or wait for the crawler. The checker also refuses host-level container access (privileged, host network/PID, runtime socket, host system paths, dangerous capabilities).

Develop: `npm ci && npm test`; `npx wrangler dev`. Deploy: `npm run migrate && npm run deploy`.
