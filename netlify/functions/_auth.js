// Shared authentication helpers for PSulit Cash Count.

import crypto from "node:crypto";

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) return null;
  return secret;
}

function sign(payloadB64, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(payloadB64)
    .digest("hex");
}

export function issueToken(teller, branches) {
  const secret = getSecret();
  if (!secret) return null;

  const payload = {
    teller,
    branches: branches || [],
    exp: Date.now() + TOKEN_TTL_MS,
  };

  const payloadB64 = Buffer
    .from(JSON.stringify(payload))
    .toString("base64url");

  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

export function verifyToken(authHeader) {
  const secret = getSecret();
  if (!secret) return null;

  const raw = (authHeader || "").startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (!raw || !raw.includes(".")) return null;

  const [payloadB64, providedSig] = raw.split(".");
  if (!payloadB64 || !providedSig) return null;

  const expectedSig = sign(payloadB64, secret);
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);

  if (a.length !== b.length ||
      !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8")
    );
  } catch {
    return null;
  }

  if (!payload.exp || payload.exp < Date.now()) return null;

  return payload;
}

export function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function requirePost(event) {
  if (event.httpMethod !== "POST") {
    return json(405, {
      ok: false,
      error: "Method not allowed.",
    });
  }
  return null;
}

export function parseBody(event) {
  try {
    return JSON.parse(event.body || "{}");
  } catch {
    return null;
  }
}
