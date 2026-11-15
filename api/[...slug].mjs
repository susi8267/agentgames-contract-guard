// Vercel entrypoint: reuses the standalone node:http contract-guard server
// (same adaptation pattern as the Gatekeeper deployment).
// The app routes on the bare paths /, /health and /check; Vercel invokes
// this function for /api/* paths (vercel.json rewrites /, /health and
// /check onto them), so normalize the URL before dispatch.
import { createContractGuardServer } from "../index.mjs";

const server = createContractGuardServer();

export default function handler(req, res) {
  if (req.url) {
    let u = req.url;
    const q = u.indexOf("?");
    if (q !== -1) u = u.slice(0, q);
    if (u.startsWith("/api/")) u = u.slice(4) || "/";
    if (u === "/index") u = "/";
    req.url = u;
  }
  server.emit("request", req, res);
}
