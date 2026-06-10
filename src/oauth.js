// OAuth lifecycle for the Claude Pro/Max subscription (used when AUTH_MODE=oauth).
//
// nopii owns its OWN OAuth tokens rather than depending on Claude Code forwarding
// them to a custom base URL (which it doesn't do reliably). The user runs the
// browser login once (`pnpm run oauth-login`); we persist the tokens, refresh them, and the
// proxy injects `Authorization: Bearer <token>` on every forwarded request.
//
// Constants below are the well-known public Claude Code OAuth values — there is no
// custom app to register. They are env-overridable for flexibility/testing.
import crypto from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import fs from "node:fs";

const CLIENT_ID = process.env.OAUTH_CLIENT_ID || "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL = process.env.OAUTH_AUTHORIZE_URL || "https://claude.ai/oauth/authorize";
const TOKEN_URL = process.env.OAUTH_TOKEN_URL || "https://api.anthropic.com/v1/oauth/token";
const SCOPES = process.env.OAUTH_SCOPES || "user:inference user:profile";
const CALLBACK_PORT = Number(process.env.OAUTH_CALLBACK_PORT || 54545);
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;
// Refresh proactively when the access token has this little life left.
const REFRESH_LEAD_MS = Number(process.env.OAUTH_REFRESH_LEAD_MS || 5 * 60 * 1000);

const CRED_DIR = (process.env.NOPII_CREDENTIALS_DIR || path.join(homedir(), ".nopii")).replace(
  /^~(?=$|\/)/,
  homedir(),
);
const CRED_FILE = path.join(CRED_DIR, "credentials.json");

// ---------------------------------------------------------------------------
// Token store ( ~/.nopii/credentials.json , mode 0600 )
// ---------------------------------------------------------------------------

let cache = null; // in-memory copy so we don't hit disk on every request

function loadCreds() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(CRED_FILE, "utf8"));
  } catch {
    cache = null;
  }
  return cache;
}

function saveCreds(creds) {
  fs.mkdirSync(CRED_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CRED_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
  // writeFileSync only sets mode on create; enforce it if the file pre-existed.
  fs.chmodSync(CRED_FILE, 0o600);
  cache = creds;
}

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

const b64url = (buf) => buf.toString("base64url");

function makePkce() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

function toStored(tokenResponse) {
  return {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    expiresAt: Date.now() + Number(tokenResponse.expires_in || 0) * 1000,
    scopes: SCOPES.split(/\s+/),
  };
}

async function postToken(body) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`OAuth token endpoint ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Refresh (single-flight: a rotating refresh token must not be spent twice)
// ---------------------------------------------------------------------------

let inFlightRefresh = null;

async function doRefresh() {
  const creds = loadCreds();
  if (!creds?.refreshToken) {
    throw new Error("nopii: no OAuth credentials. Run `pnpm run oauth-login` first.");
  }
  let resp;
  try {
    resp = await postToken({
      grant_type: "refresh_token",
      refresh_token: creds.refreshToken,
      client_id: CLIENT_ID,
    });
  } catch (err) {
    // A 4xx here means the refresh token is dead (expired/reused/revoked).
    if (err.status >= 400 && err.status < 500) {
      throw new Error(
        `nopii: OAuth refresh rejected (${err.status}) — token expired or revoked. Run \`pnpm run oauth-login\` again.`,
      );
    }
    throw err;
  }
  const next = toStored(resp);
  // The refresh token rotates; keep the old one only if the response omitted it.
  if (!next.refreshToken) next.refreshToken = creds.refreshToken;
  saveCreds(next);
  return next;
}

function refresh() {
  if (!inFlightRefresh) {
    inFlightRefresh = doRefresh().finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}

/** Force a refresh regardless of expiry (used by the reactive 401 retry). */
export async function forceRefresh() {
  return (await refresh()).accessToken;
}

/** Return a valid access token, refreshing proactively if it's near expiry. */
export async function getAccessToken() {
  const creds = loadCreds();
  if (!creds?.accessToken) {
    throw new Error("nopii: no OAuth credentials. Run `pnpm run oauth-login` first.");
  }
  if (Date.now() >= creds.expiresAt - REFRESH_LEAD_MS) {
    return (await refresh()).accessToken;
  }
  return creds.accessToken;
}

/** True if credentials exist on disk (used to warn at startup). */
export function hasCredentials() {
  return Boolean(loadCreds()?.refreshToken);
}

// ---------------------------------------------------------------------------
// Interactive browser login (PKCE authorization-code flow)
// ---------------------------------------------------------------------------

function openBrowser(url) {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  const args = process.platform === "win32" ? ["", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
  } catch {
    /* fall back to the printed URL */
  }
}

export async function loginInteractive() {
  const { verifier, challenge } = makePkce();
  const state = b64url(crypto.randomBytes(32));

  const authorizeUrl = new URL(AUTHORIZE_URL);
  authorizeUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  }).toString();

  // Wait for the OAuth provider to redirect back to our localhost callback.
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, REDIRECT_URI);
      if (u.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const params = u.searchParams;
      const finish = (status, msg) => {
        res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
        res.end(`<html><body style="font-family:sans-serif"><h2>${msg}</h2>
<p>You can close this tab and return to the terminal.</p></body></html>`);
        server.close();
      };
      if (params.get("error")) {
        finish(400, `Login failed: ${params.get("error")}`);
        reject(new Error(`OAuth error: ${params.get("error_description") || params.get("error")}`));
        return;
      }
      if (params.get("state") !== state) {
        finish(400, "Login failed: state mismatch");
        reject(new Error("OAuth state mismatch — possible CSRF; aborting."));
        return;
      }
      const c = params.get("code");
      if (!c) {
        finish(400, "Login failed: no authorization code");
        reject(new Error("OAuth callback missing code"));
        return;
      }
      finish(200, "nopii — login successful ✓");
      resolve(c);
    });
    server.on("error", reject);
    server.listen(CALLBACK_PORT, () => {
      console.log(`\nOpening your browser to authorize nopii…`);
      console.log(`If it doesn't open, visit:\n  ${authorizeUrl.toString()}\n`);
      openBrowser(authorizeUrl.toString());
    });
  });

  const resp = await postToken({
    grant_type: "authorization_code",
    code,
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
    state,
  });
  saveCreds(toStored(resp));
  return { credPath: CRED_FILE };
}
