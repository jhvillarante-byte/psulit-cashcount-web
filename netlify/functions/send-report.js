// POST /send-report — send the cash count report to the correct PSULIT Operations topic.
// Production routing: PSulit Operations forum, branch-specific Cash Count topics.

const { verifyToken, json, requirePost, parseBody } = require("./_auth");

function normalizeBranch(value) {
  const branch = String(value || "").trim().toLowerCase();
  if (branch === "alphaland") return "Alphaland";
  if (branch === "solaire") return "Solaire";
  return "";
}

function branchFromMessage(message) {
  const match = String(message || "").match(/Branch:\s*(Alphaland|Solaire)/i);
  return match ? normalizeBranch(match[1]) : "";
}

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

  const text = String(body.message || "").slice(0, 4096);
  if (!text) return json(400, { ok: false, error: "Nothing to send." });

  // Newer frontends can send branch explicitly. Older deployed versions are
  // still supported by reading the branch from the report text.
  const branch = normalizeBranch(body.branch) || branchFromMessage(text);
  if (!branch) {
    return json(400, { ok: false, error: "Could not determine Cash Count branch." });
  }

  const threadId = branch === "Alphaland"
    ? process.env.ALPHALAND_CASH_COUNT_TOPIC_ID
    : process.env.SOLAIRE_CASH_COUNT_TOPIC_ID;

  if (!threadId) {
    console.error(`Telegram topic ID is not configured for ${branch}.`);
    return json(500, { ok: false, error: `Telegram topic is not configured for ${branch}.` });
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_thread_id: Number(threadId),
        text,
      }),
    });
    const data = await res.json();

    if (!data.ok) {
      console.error("Telegram rejected the message:", data.description);
      if (data.parameters && data.parameters.migrate_to_chat_id) {
        return json(502, {
          ok: false,
          error: `Telegram chat ID changed to ${data.parameters.migrate_to_chat_id}. Update TELEGRAM_CHAT_ID.`,
        });
      }
      return json(502, { ok: false, error: `Telegram: ${data.description}` });
    }

    return json(200, {
      ok: true,
      branch,
      message_thread_id: Number(threadId),
      telegram_message_id: data.result && data.result.message_id,
    });
  } catch (e) {
    console.error("send-report failed:", e.message);
    return json(502, { ok: false, error: "Could not reach Telegram." });
  }
};
