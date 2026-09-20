// POST /auth/session  — exchange a teller PIN for a signed session token.
//
// PINs live in the TELLER_PINS_JSON environment variable, never in the repo
// and never in the page the tellers load.

const { issueToken, json, requirePost, parseBody } = require("./_auth");

function loadPins() {
  try {
    return JSON.parse(process.env.TELLER_PINS_JSON || "{}");
  } catch (e) {
    console.error("TELLER_PINS_JSON is not valid JSON — all logins will fail.");
    return {};
  }
}

exports.handler = async (event) => {
  const wrongMethod = requirePost(event);
  if (wrongMethod) return wrongMethod;

  const body = parseBody(event);
  if (!body) return json(400, { ok: false, error: "Bad request." });

  const pin = String(body.pin || "").trim();
  if (!/^\d{4}$/.test(pin)) {
    return json(400, { ok: false, error: "Valid 4-digit PIN required." });
  }

  if (!process.env.SESSION_SECRET) {
    console.error("SESSION_SECRET is not set.");
    return json(500, { ok: false, error: "Login is not configured on the server." });
  }

  const pins = loadPins();
  if (!Object.keys(pins).length) {
    return json(500, { ok: false, error: "Teller PINs are not configured on the server." });
  }

  const teller = pins[pin];
  if (!teller) {
    return json(401, { ok: false, error: "Incorrect PIN." });
  }

  const token = issueToken(teller.name, teller.branches);
  if (!token) {
    return json(500, { ok: false, error: "Login is not configured on the server." });
  }

  return json(200, {
    ok: true,
    token,
    teller: teller.name,
    branches: teller.branches || [],
  });
};
