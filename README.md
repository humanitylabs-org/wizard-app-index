# Wizard App Index

Discovery for Wizard apps, live at https://apps.aiwizards.com (Cloudflare Worker + D1, Humanity Labs account).

The app repos are the source of truth. The index is a cache: every listing is re-read from the app's own repo at a pinned commit, so the database can be dropped and rebuilt.

- Search: `GET /v1/search?q=&slot=&type=&publisher=&arch=`
- Publish: `POST /v1/publish {"repo":"owner/name"}`, or a GitHub webhook (push events) to the same URL
- Why a repo isn't listed: `GET /v1/apps/{owner}/{repo}`
- Crawler (every 10 min): GitHub topic `wizard-app` (and `wizard-ai` during the transition), split into created-date slices so no query hits GitHub's 1,000-result cap; listings are re-verified weekly.

To publish an app: public repo, `wizard.md` at the root that passes the checker (spec: humanitylabs-org/wizard-os `spec/WIZARD_MD.md`), topic `wizard-app`, then publish or wait for the crawler. The checker also refuses host-level container access (privileged, host network/PID, runtime socket, host system paths, dangerous capabilities).

Develop: `npm ci && npm test`; `npx wrangler dev`. Deploy: `npm run migrate && npm run deploy`.
