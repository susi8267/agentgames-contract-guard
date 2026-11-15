# Contract Guard

A tiny, read-only **BSC contract risk triage agent**. Give it a contract
address, it answers one question in seconds: *"is this contract obviously
risky, or does it pass the basic sanity checks?"* — with the reasons spelled
out, not just a bare score.

Built for the **Wildcard track of zkVerify Agent Games**. It reuses, as a
standalone public agent, the same read-only triage discipline used to vet
BSC mint/claim contracts before interacting with them.

## Who it helps

Traders and NFT minters who are about to mint, buy, or approve a BSC
contract they found through a link, a group chat, or an announcement — and
want a fast, free, read-only second opinion *before* signing anything.
No wallet connection, no signing, no funds involved: the agent only reads
public chain state and public verification data.

## What it checks (all read-only)

| # | Check | How |
|---|----------|------------------------------------------------------------------|
| 1 | Is it a contract? | `eth_getCode` via BSC RPC (`rpc-bsc.48.club`, fallback `bsc-dataseed.binance.org`) |
| 2 | Source verified? | Sourcify API **v2** — `GET sourcify.dev/server/v2/contract/56/{address}` → `exact_match` = **full**, `match` = **partial**, HTTP 404 = **none** (Sourcify API v1 was removed; this agent uses the current v2 contract endpoint, verified live) |
| 3 | Admin surface | `eth_call owner()` (`0x8da5cb5b`) — a revert/missing function is reported as "not available", never guessed |
| 4 | Paused? | `eth_call paused()` (`0x5c975abb`) — same honest "not available" handling |

## Scoring & verdicts

Start at **100**, then deduct — every deduction is explained in `reasons[]`:

- Source **not** verified on Sourcify: **−40**
- Contract currently **paused**: **−30**
- `owner()` unreadable (admin control unclear): **−10**

| Score | Verdict |
|-------|-------------|
| ≥ 85 | `LOW_RISK` |
| 55–84 | `CAUTION` |
| < 55 | `HIGH_RISK` |
| — (no bytecode) | `NOT_A_CONTRACT` (score 0) |

If Sourcify itself is unreachable, the response says `sourcify: "unknown"`,
applies **no** deduction, and tells you to verify manually — the agent never
fabricates a verification result.

## Run it

Pure Node.js (≥ 20), **zero npm dependencies** — just `node:http` + `fetch`.

```bash
NODE_USE_ENV_PROXY=1 node index.mjs     # listens on :8799 (PORT env to change)
```

`NODE_USE_ENV_PROXY=1` makes Node's `fetch` honour the `http_proxy` /
`https_proxy` environment variables (needed on hosts whose egress goes
through a proxy; harmless elsewhere). Or simply `npm start`.

## API

### `GET /health`

```json
{"status":"ok"}
```

### `POST /check`

Request:

```bash
curl -X POST http://localhost:8799/check \
  -H 'content-type: application/json' \
  -d '{"address":"0xcBe2DBBFF4264Dc67Bf557c64e29997B82439354"}'
```

Real response (from local testing, 2026-11-15 — a Sourcify exact-match
verified NFT contract on BSC):

```json
{
  "address": "0xcBe2DBBFF4264Dc67Bf557c64e29997B82439354",
  "chain": "bsc",
  "isContract": true,
  "sourcify": "full",
  "owner": "0xb3455523cc10061d2e9d5ae67dbcfb4db76727ad",
  "paused": null,
  "score": 100,
  "verdict": "LOW_RISK",
  "reasons": [
    "Source code is fully verified on Sourcify (exact match) — anyone can read exactly what this contract does.",
    "owner() is 0xb3455523cc10061d2e9d5ae67dbcfb4db76727ad — an admin exists who may be able to change contract behaviour.",
    "paused() is not available (function missing or call reverted) — no deduction; many contracts simply have no pause feature."
  ]
}
```

Bad input gets a clean `400`:

```json
{"error":"invalid_address","message":"Field \"address\" must be a 0x-prefixed 40-hex-character EVM address."}
```

## Limitations — read this

- **Triage, not an audit.** Contract Guard checks four surface signals. It
  does **not** read the source code, follow fund flows, inspect holder/LP
  distribution, or detect honeypots, proxies with malicious implementations,
  hidden mint functions, or fee traps. A `LOW_RISK` verdict means "passed
  these basic checks", never "safe".
- **BSC mainnet only** (chain 56), one address per request.
- `paused: null` / `owner: null` mean the function is absent or reverted —
  common and not by itself a red flag.
- Verdicts reflect the chain state at query time; a contract can be paused
  or have ownership change afterwards.
- Depends on public RPC + Sourcify availability; if every BSC RPC is down
  the API returns `502 upstream_unavailable` instead of guessing.

## Files

- `index.mjs` — the whole agent (server + triage logic), no dependencies
- `package.json` — metadata + `npm start`
- `TESTS.md` — local test run summary with real outputs
