// Shared auth helpers for the Psulit Cash Count functions.
//
// Netlify Functions are stateless — each request may run in a fresh container,
// so there is nowhere to keep a session map. Instead we issue a signed token
// that carries its own payload. The signature proves we issued it; the expiry
// inside it proves it is still current. Nothing needs to be stored anywhere.

const crypto = require("crypto");

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // one shift

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) return null;
  return secret;
}

function sign(payloadB64, secret) {
  return crypto.createHmac("sha256", secret).update(payloadB64).digest("hex");
}

// Build a token for a teller who has just presented a valid PIN.
function issueToken(teller, branches) {
  const secret = getSecret();
  if (!secret) return null;
  const payload = {
    teller,
    branches: branches || [],
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

// Verify a token from an Authorization header. Returns the payload or null.
function verifyToken(authHeader) {
  const secret = getSecret();
  if (!secret) return null;

  const raw = (authHeader || "").startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!raw || !raw.includes(".")) return null;

  const [payloadB64, providedSig] = raw.split(".");
  if (!payloadB64 || !providedSig) return null;

  const expectedSig = sign(payloadB64, secret);

  // Constant-time compare so a wrong signature cannot be guessed by timing.
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch (e) {
    return null;
  }

  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// Reject anything that is not a POST, so a stray GET cannot trigger a send.
function requirePost(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method not allowed." });
  }
  return null;
}

function parseBody(event) {
  try {
    return JSON.parse(event.body || "{}");
  } catch (e) {
    return null;
  }
}

module.exports = { issueToken, verifyToken, json, requirePost, parseBody };
