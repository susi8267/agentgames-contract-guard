# Contract Guard — local test summary

Date: **2026-11-15** · Node v24.22.1 · server run locally as
`NODE_USE_ENV_PROXY=1 PORT=8799 node index.mjs` · all calls against live BSC
mainnet + live Sourcify API v2. Server stopped after the tests; nothing left
running.

## Ground-truthing before coding

- Sourcify **API v1 is removed**: `GET /server/check-by-addresses` returns
  HTTP 404 with a migration notice pointing to API v2. The agent therefore
  uses `GET https://sourcify.dev/server/v2/contract/{chainId}/{address}`.
- Live v2 responses observed: verified contract → HTTP 200
  `{"match":"exact_match","creationMatch":"exact_match","runtimeMatch":"exact_match",...}`;
  unverified/EOA → HTTP 404 `{"match":null,...}`. Mapping used:
  `exact_match` → `full`, `match` → `partial`, 404/null → `none`.

## Results

### GET /health
→ `200 {"status":"ok"}` ✅

### (a) Verified contract — `0xcBe2DBBFF4264Dc67Bf557c64e29997B82439354` (NFT, Sourcify exact match)
→ HTTP 200

```json
{"address":"0xcBe2DBBFF4264Dc67Bf557c64e29997B82439354","chain":"bsc","isContract":true,"sourcify":"full","owner":"0xb3455523cc10061d2e9d5ae67dbcfb4db76727ad","paused":null,"score":100,"verdict":"LOW_RISK","reasons":["Source code is fully verified on Sourcify (exact match) — anyone can read exactly what this contract does.","owner() is 0xb3455523cc10061d2e9d5ae67dbcfb4db76727ad — an admin exists who may be able to change contract behaviour.","paused() is not available (function missing or call reverted) — no deduction; many contracts simply have no pause feature."]}
```

**Score 100 · LOW_RISK** ✅ (owner readable; contract has no `paused()`.)

### (b) EOA — `0xB811caDb8eDc6115D55D5e9E04292eB6Eea50Dfc`
→ HTTP 200

```json
{"address":"0xB811caDb8eDc6115D55D5e9E04292eB6Eea50Dfc","chain":"bsc","isContract":false,"sourcify":"none","owner":null,"paused":null,"score":0,"verdict":"NOT_A_CONTRACT","reasons":["No contract bytecode at this address on BSC — it is an EOA or an unused address, so there is no contract to triage."]}
```

**Score 0 · NOT_A_CONTRACT** ✅

### (c) Invalid input
- `{"address":"0x123notanaddress"}` → **HTTP 400**
  `{"error":"invalid_address","message":"Field \"address\" must be a 0x-prefixed 40-hex-character EVM address."}` ✅
- Body `not json` → **HTTP 400**
  `{"error":"invalid_json","message":"Request body must be valid JSON."}` ✅

### (d) Extra — unverified contract — `0xCD2401b13d66A37D04a7356d776162154Eb11719`
→ HTTP 200

```json
{"address":"0xCD2401b13d66A37D04a7356d776162154Eb11719","chain":"bsc","isContract":true,"sourcify":"none","owner":null,"paused":null,"score":50,"verdict":"HIGH_RISK","reasons":["Source code is NOT verified on Sourcify (-40) — the bytecode cannot be matched to readable source, so behaviour must be trusted blindly.","owner() could not be read (-10) — the function is missing or the call reverted, so admin control is unclear.","paused() is not available (function missing or call reverted) — no deduction; many contracts simply have no pause feature."]}
```

**Score 50 (100 −40 unverified −10 owner unreadable) · HIGH_RISK** ✅ —
exercises the deduction path end-to-end.

## Notes

- End-to-end latency per `/check` was ~1–4 s wall clock from this VM
  (egress proxy + public RPC), well within any reasonable agent timeout.
- No test exercised `paused=true` (−30) — none of the sampled live contracts
  expose a readable `paused()`; the branch is implemented and unit-shaped
  like the owner branch, but is flagged as **not yet observed live**.
- Partial-match (`sourcify: "partial"`) mapping is implemented from the
  Sourcify v2 schema (`match: "match"`) but no partial-match contract was
  sampled in this run.
