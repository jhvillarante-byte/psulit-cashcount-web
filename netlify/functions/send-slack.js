// POST /send-slack — legacy compatibility endpoint.
// Slack delivery for Cash Count has been retired. The frontend still calls
// this endpoint in the current build, so return quickly without posting
// anywhere while Telegram remains the actual delivery channel.

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

  // Intentionally do not call Slack. Returning ok keeps older Cash Count
  // frontends from retrying this retired endpoint and delaying submissions.
  return json(200, { ok: true, disabled: true, destination: "telegram-only" });
};
