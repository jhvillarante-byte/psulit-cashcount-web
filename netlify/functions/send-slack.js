// POST /send-slack — retired compatibility endpoint.
// Cash Count is Telegram-only. Older frontends may still call this route;
// return ok:false so a retired Slack path can never make a failed Telegram
// submission appear successful.

const { verifyToken, json, requirePost, parseBody } = require("./_auth");

exports.handler = async (event) => {
  const wrongMethod = requirePost(event);
  if (wrongMethod) return wrongMethod;

  const session = verifyToken(event.headers.authorization || event.headers.Authorization);
  if (!session) {
    return json(401, { ok: false, error: "Session expired. Please log in again." });
  }

  const body = parseBody(event);
  if (!body) return json(400, { ok: false, error: "Bad request." });

  // Intentionally do not call Slack. `ok:false` is deliberate: legacy
  // frontends compute overall success from Slack OR Telegram, so returning
  // true here could falsely report success when Telegram actually failed.
  return json(200, {
    ok: false,
    disabled: true,
    retired: true,
    destination: "telegram-only",
  });
};
