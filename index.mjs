// Contract Guard — a tiny read-only BSC contract risk triage agent.
//
// Concept (zkVerify Agent Games, Wildcard track): a trader/investor pastes a
// BSC contract address before a mint/buy and gets back a simple, explained
// risk verdict built ONLY from read-only checks:
//   1. eth_getCode            — is there actually a contract at the address?
//   2. Sourcify verification  — is the source code verified? (API v2, see below)
//   3. eth_call owner()       — is there a readable admin/owner?
//   4. eth_call paused()      — is the contract currently paused?
//
// Pure Node.js: node:http + global fetch. NO npm dependencies.
// Run:  NODE_USE_ENV_PROXY=1 node index.mjs        (PORT env, default 8799)
// (NODE_USE_ENV_PROXY=1 makes Node's fetch honour the http(s)_proxy env vars,
//  which this VM needs for outbound traffic.)
//
// Scoring (explained in `reasons[]`, never a bare number):
//   start 100
//   source NOT verified on Sourcify  -> -40
//   paused() == true                 -> -30
//   owner() unreadable               -> -10
//   verdict: >=85 LOW_RISK | 55-84 CAUTION | <55 HIGH_RISK
//   no bytecode at address           -> verdict NOT_A_CONTRACT (score 0)
// This is a triage heuristic, NOT an audit.

import http from "node:http";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 8799);
const CHAIN_ID = 56; // BSC mainnet
const RPC_URLS = [
  "https://rpc-bsc.48.club",
  "https://bsc-dataseed.binance.org",
];
const SOURCIFY_URL = "https://sourcify.dev/server/v2/contract";
const FETCH_TIMEOUT_MS = 12_000;
const USER_AGENT = "contract-guard/0.1 (+https://github.com/susi8267)";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

let rpcId = 0;
async function rpcCall(method, params) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params });
  let lastError = null;
  for (const url of RPC_URLS) {
    try {
      const res = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": USER_AGENT },
        body,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) {
        // A JSON-RPC error (e.g. execution reverted) is a *result* for our
        // callers, not a transport failure: surface it as a thrown RpcError
        // WITHOUT trying the fallback (the fallback would revert identically).
        const err = new Error(json.error.message || "rpc error");
        err.rpcError = true;
        throw err;
      }
      return json.result;
    } catch (e) {
      if (e.rpcError) throw e;
      lastError = e; // transport failure -> try the next RPC
    }
  }
  throw lastError || new Error("all RPC endpoints failed");
}

// eth_call that never throws: { ok:true, result } | { ok:false }
async function ethCall(address, data) {
  try {
    const result = await rpcCall("eth_call", [{ to: address, data }, "latest"]);
    if (typeof result !== "string" || result === "0x") return { ok: false };
    return { ok: true, result };
  } catch {
    return { ok: false };
  }
}

// Sourcify API v2 (v1 was removed; verified live 2026-11-15):
//   GET /v2/contract/{chainId}/{address}
//   verified   -> HTTP 200, body.match = "exact_match" (full) or "match" (partial)
//   unverified -> HTTP 404, body.match = null
// Returns "full" | "partial" | "none" | "unknown" (API unreachable).
async function sourcifyStatus(address) {
  try {
    const res = await fetchWithTimeout(
      `${SOURCIFY_URL}/${CHAIN_ID}/${address}`,
      { headers: { "user-agent": USER_AGENT, accept: "application/json" } }
    );
    if (res.status === 404) return "none";
    if (!res.ok) return "unknown";
    const json = await res.json();
    if (json.match === "exact_match") return "full";
    if (json.match === "match") return "partial";
    if (json.match == null) return "none";
    return "unknown";
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// the triage
// ---------------------------------------------------------------------------

const SELECTOR_OWNER = "0x8da5cb5b"; // owner()
const SELECTOR_PAUSED = "0x5c975abb"; // paused()

async function checkContract(address) {
  const reasons = [];

  // 1. Is it a contract at all?
  const code = await rpcCall("eth_getCode", [address, "latest"]);
  const isContract = typeof code === "string" && code.length > 2;

  if (!isContract) {
    return {
      address,
      chain: "bsc",
      isContract: false,
      sourcify: "none",
      owner: null,
      paused: null,
      score: 0,
      verdict: "NOT_A_CONTRACT",
      reasons: [
        "No contract bytecode at this address on BSC — it is an EOA or an unused address, so there is no contract to triage.",
      ],
    };
  }

  // 2-4. Verification + admin surface, in parallel.
  const [sourcify, ownerCall, pausedCall] = await Promise.all([
    sourcifyStatus(address),
    ethCall(address, SELECTOR_OWNER),
    ethCall(address, SELECTOR_PAUSED),
  ]);

  let score = 100;

  // Sourcify
  if (sourcify === "full") {
    reasons.push("Source code is fully verified on Sourcify (exact match) — anyone can read exactly what this contract does.");
  } else if (sourcify === "partial") {
    reasons.push("Source code is partially verified on Sourcify (bytecode matches, metadata differs) — readable, but treat with mild care.");
  } else if (sourcify === "none") {
    score -= 40;
    reasons.push("Source code is NOT verified on Sourcify (-40) — the bytecode cannot be matched to readable source, so behaviour must be trusted blindly.");
  } else {
    reasons.push("Sourcify check could not be completed (API unreachable) — no deduction applied, verify manually.");
  }

  // owner()
  let owner = null;
  if (ownerCall.ok && /^0x[0-9a-fA-F]{64}$/.test(ownerCall.result)) {
    owner = "0x" + ownerCall.result.slice(26).toLowerCase();
    if (owner === "0x0000000000000000000000000000000000000000") {
      reasons.push("owner() is the zero address — ownership has been renounced, no admin can change the rules.");
    } else {
      reasons.push(`owner() is ${owner} — an admin exists who may be able to change contract behaviour.`);
    }
  } else {
    score -= 10;
    reasons.push("owner() could not be read (-10) — the function is missing or the call reverted, so admin control is unclear.");
  }

  // paused()
  let paused = null;
  if (pausedCall.ok && /^0x[0-9a-fA-F]{64}$/.test(pausedCall.result)) {
    paused = BigInt(pausedCall.result) !== 0n;
    if (paused) {
      score -= 30;
      reasons.push("Contract is currently PAUSED (-30) — transfers/mints may be blocked right now.");
    } else {
      reasons.push("Contract is not paused.");
    }
  } else {
    reasons.push("paused() is not available (function missing or call reverted) — no deduction; many contracts simply have no pause feature.");
  }

  const verdict = score >= 85 ? "LOW_RISK" : score >= 55 ? "CAUTION" : "HIGH_RISK";

  return { address, chain: "bsc", isContract, sourcify, owner, paused, score, verdict, reasons };
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

async function handleRequest(req, res) {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, { status: "ok" });
  }

  if (req.method === "GET" && url.pathname === "/") {
    return sendJson(res, 200, {
      name: "contract-guard",
      description: "Read-only BSC contract risk triage (Sourcify + owner/paused probes).",
      endpoints: { health: "GET /health", check: "POST /check {\"address\":\"0x...\"}" },
    });
  }

  if (req.method === "POST" && url.pathname === "/check") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return sendJson(res, 400, { error: "invalid_json", message: "Request body must be valid JSON." });
      }
      const address = parsed?.address;
      if (typeof address !== "string" || !ADDRESS_RE.test(address)) {
        return sendJson(res, 400, {
          error: "invalid_address",
          message: "Field \"address\" must be a 0x-prefixed 40-hex-character EVM address.",
        });
      }
      try {
        const result = await checkContract(address);
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 502, { error: "upstream_unavailable", message: `BSC RPC unreachable: ${e.message}` });
      }
    });
    return;
  }

  return sendJson(res, 404, { error: "not_found", message: "Use GET /health or POST /check." });
}

// Factory shared by the standalone server below and the Vercel serverless
// entrypoint (api/[...slug].mjs), mirroring the Gatekeeper's pattern.
export function createContractGuardServer() {
  return http.createServer(handleRequest);
}

// Listen only when executed directly (`node index.mjs`); importing this
// module (e.g. from the serverless entrypoint) must not bind a port.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createContractGuardServer().listen(PORT, () => {
    console.log(`contract-guard listening on :${PORT}`);
  });
}
