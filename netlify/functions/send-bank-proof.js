// Weekly (Monday) bank-balance proof: posts the teller's screenshots to the branch's Cash Count Telegram topic.
// Proof only — nothing here is totalled or adjusted. The matching "Bank Proof" sheet rows are written by send-report-live.
const { verifyToken, json, requirePost, parseBody } = require("./_auth");
const { isUploader } = require("./bank-balances");

const MAX_IMAGES = 8;
const MAX_BYTES = 1_800_000;

function peso(n, cur) {
  const sym = cur === "PHP" ? "₱" : `${cur} `;
  return sym + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function sendPhoto({ token, chatId, threadId, buffer, caption }) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("message_thread_id", String(threadId));
  if (caption) form.append("caption", caption.slice(0, 1000));
  form.append("photo", new Blob([buffer], { type: "image/jpeg" }), "bank-proof.jpg");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form });
  const out = await res.json().catch(() => ({}));
  if (!out.ok) throw new Error(out.description || `Telegram rejected the photo (${res.status}).`);
  return out.result && out.result.message_id;
}

exports.handler = async (event) => {
  const wrong = requirePost(event);
  if (wrong) return wrong;
  const session = verifyToken(event.headers.authorization || event.headers.Authorization);
  if (!session) return json(401, { ok: false, error: "Session expired. Please log in again." });
  if (!isUploader(session.teller)) return json(403, { ok: false, error: "Only the bank-balance uploader can send bank proof." });
  const body = parseBody(event);
  if (!body) return json(400, { ok: false, error: "Bad request." });

  const branch = body.branch === "Alphaland" || body.branch === "Solaire" ? body.branch : "";
  if (!branch) return json(400, { ok: false, error: "Branch is required." });
  const images = (Array.isArray(body.images) ? body.images : []).slice(0, MAX_IMAGES);
  if (!images.length) return json(400, { ok: false, error: "No screenshots received." });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = branch === "Alphaland" ? process.env.ALPHALAND_TELEGRAM_CHAT_ID : process.env.SOLAIRE_TELEGRAM_CHAT_ID;
  const threadId = branch === "Alphaland" ? process.env.ALPHALAND_CASH_COUNT_TOPIC_ID : process.env.SOLAIRE_CASH_COUNT_TOPIC_ID;
  if (!token || !chatId || !threadId) return json(500, { ok: false, error: `Telegram is not fully configured for ${branch}.` });

  const banks = (Array.isArray(body.banks) ? body.banks : []).slice(0, 20);
  const teller = String(body.teller || session.teller || "").slice(0, 60);
  const date = String(body.date || "").slice(0, 10);
  const lines = [`🏦 WEEKLY BANK PROOF — ${branch}`, `📅 ${date} (start-of-week check)`, `👤 ${teller}`, ""]
    .concat(banks.length ? banks.map(b => `${String(b.name || "").slice(0, 40)} — ${peso(b.amt, String(b.cur || "PHP"))}${b.reason ? ` (${String(b.reason).slice(0, 40)})` : ""}`) : ["(no bank balances listed)"])
    .concat(["", "Proof only — not added to any total."]);

  let sent = 0;
  try {
    for (let i = 0; i < images.length; i += 1) {
      const m = String(images[i] || "").match(/^data:image\/jpeg;base64,(.+)$/);
      if (!m) throw new Error("Screenshot format not supported.");
      const buffer = Buffer.from(m[1], "base64");
      if (buffer.length > MAX_BYTES) throw new Error("A screenshot is too large. Please retake it smaller.");
      await sendPhoto({ token, chatId, threadId, buffer, caption: i === 0 ? lines.join("\n") : `Bank proof ${i + 1}/${images.length}` });
      sent += 1;
    }
  } catch (error) {
    return json(502, { ok: false, sent, error: error instanceof Error ? error.message : "Could not reach Telegram." });
  }
  return json(200, { ok: true, sent });
};
