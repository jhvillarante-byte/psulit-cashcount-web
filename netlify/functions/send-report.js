// POST /send-report — send the cash count report to the PSULIT Team group.

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

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    console.error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set.");
    return json(500, { ok: false, error: "Telegram is not configured on the server." });
  }

  // Telegram rejects anything over 4096 characters.
  const text = String(body.message || "").slice(0, 4096);
  if (!text) return json(400, { ok: false, error: "Nothing to send." });

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const data = await res.json();

    if (!data.ok) {
      console.error("Telegram rejected the message:", data.description);
      // A supergroup upgrade changes the chat ID — surface that clearly,
      // because it looks like a generic failure otherwise.
      if (data.parameters && data.parameters.migrate_to_chat_id) {
        return json(502, {
          ok: false,
          error: `Telegram chat ID changed to ${data.parameters.migrate_to_chat_id}. Update TELEGRAM_CHAT_ID.`,
        });
      }
      return json(502, { ok: false, error: `Telegram: ${data.description}` });
    }

    return json(200, { ok: true });
  } catch (e) {
    console.error("send-report failed:", e.message);
    return json(502, { ok: false, error: "Could not reach Telegram." });
  }
};
