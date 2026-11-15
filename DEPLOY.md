# Contract Guard — Vercel deployment

Deployed 2026-11-15 (~08:11–08:19 WIB) as a NEW, separate Vercel project.
Not submitted to the Agent Games dashboard; no GitHub repo created.

## Project

- Project name: `susiidz-contract-guard`
- Project ID: `prj_ONnOOo7hcbNX1mz0YHuICoqI4tci` (org `team_Kf8JTogHtgPgcBKJaDOKk61b`, same account as the Gatekeeper — separate project, Gatekeeper untouched)
- Production URL: **https://susiidz-contract-guard.vercel.app**
- Final deployment: `susiidz-contract-guard-j5lq24o94-susi8267.vercel.app`
- No env vars, no secrets: all checks are public read-only calls made by the
  function itself from Vercel's infra (BSC RPC + Sourcify).

## Layout (in this folder)

- `index.mjs` — refactored: request handler extracted to `handleRequest`,
  exported factory `createContractGuardServer()` (same pattern as the
  Gatekeeper). Standalone mode unchanged: the server only listens when the
  file is executed directly (`node index.mjs`, port `PORT`/8799). Verified
  locally after the refactor (health + both test addresses, identical output).
- `api/[...slug].mjs` — serverless entrypoint; strips query string and the
  `/api` prefix, then dispatches into the shared `node:http` server.
- `vercel.json` — `maxDuration: 60` for the function; rewrites `/health` →
  `/api/health` and `/check` → `/api/check` so the app's bare paths are the
  public surface (`/api/health` and `/api/check` also work natively).
- `public/index.html` — small landing page with a working check form. Added
  because without it Vercel served the raw `index.mjs` source at `/`
  (zero-config index-file behaviour).
- `.vercelignore` — excludes `.env.local` (auto-created by `vercel link`,
  holds a VERCEL_OIDC_TOKEN) and `.vercel`. Verified live: `/.env.local`,
  `/package.json` and `/vercel.json` all return 404 on the deployment.

## Live test results (production URL, from the VM, 2026-11-15)

- `GET /` → 200, landing page (text/html)
- `GET /health` → 200 `{"status":"ok"}` (~0.8 s); `GET /api/health` → 200 same
- `POST /check` (a) `0xcBe2DBBFF4264Dc67Bf557c64e29997B82439354` (BAOracle BAONFT)
  → 200 in ~1.1 s:
  `{"isContract":true,"sourcify":"full","owner":"0xb3455523cc10061d2e9d5ae67dbcfb4db76727ad","paused":null,"score":100,"verdict":"LOW_RISK", …}`
  — matches the expected full / LOW_RISK.
- `POST /check` (b) `0xB811caDb8eDc6115D55D5e9E04292eB6Eea50Dfc` (EOA)
  → 200 in ~0.8 s:
  `{"isContract":false,"sourcify":"none","owner":null,"paused":null,"score":0,"verdict":"NOT_A_CONTRACT", …}`
  — matches the expected NOT_A_CONTRACT.
- `POST /api/check` (a) → 200 (~0.8 s); invalid address → 400 `invalid_address`.
- Outputs are byte-identical in substance to the local run — the function's
  own Sourcify/RPC calls from Vercel infra are the real production path.

## Notes / issues

- The first two `POST /check` attempts (immediately after the first deploy)
  hit the 60 s client timeout from the VM; every subsequent call completes in
  ~1 s. Treated as cold-start + cold outbound connections through the VM
  egress proxy — not reproduced since, but worth knowing if a judge's first
  request feels slow.
- One redeploy was needed: the first attempt after adding `public/` failed
  with a CLI-level `Error: fetch failed` (VM network), the retry succeeded.
