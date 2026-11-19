// Weekly bank-balance proof. The bank accounts belong to Solaire only, so the screenshots always go to the Solaire
// Cash Count Telegram topic, and when the count is done at Alphaland the Bank Balance / Bank Proof rows are written
// to the Solaire Cash Count tab from here (a Solaire count writes them itself through send-report-live).
// Proof only — nothing here is totalled or adjusted. Only the bank uploader (Jazelle) may call this.
const { verifyToken, json, requirePost, parseBody } = require("./_auth");
const { isUploader } = require("./bank-balances");

const CASH_COUNT_SPREADSHEET_ID = "1_msQClr0yfx_jTKeEfop6lnfNvBPd-sNNMkgLnBgsrU";
const MAX_IMAGES = 14;
const MAX_BYTES = 1_800_000;

function peso(n, cur) {
  const sym = cur === "PHP" ? "₱" : `${cur} `;
  return sym + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function slug(v) { return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

async function tgJson(token, method, form) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", body: form });
  const out = await res.json().catch(() => ({}));
  if (!out.ok) throw new Error(out.description || `Telegram rejected the photos (${res.status}).`);
  return out.result;
}

// Sends the screenshots together as one album (Telegram groups 2-10 photos); the caption sits on the first photo.
async function sendAlbum({ token, chatId, threadId, buffers, caption }) {
  let sent = 0;
  for (let start = 0; start < buffers.length; start += 10) {
    const chunk = buffers.slice(start, start + 10);
    const cap = start === 0 ? caption.slice(0, 1024) : "";
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("message_thread_id", String(threadId));
    if (chunk.length === 1) {
      if (cap) form.append("caption", cap);
      form.append("photo", new Blob([chunk[0]], { type: "image/jpeg" }), "bank-proof.jpg");
      await tgJson(token, "sendPhoto", form);
    } else {
      const media = chunk.map((_, i) => ({ type: "photo", media: `attach://p${i}`, ...(i === 0 && cap ? { caption: cap } : {}) }));
      form.append("media", JSON.stringify(media));
      chunk.forEach((b, i) => form.append(`p${i}`, new Blob([b], { type: "image/jpeg" }), `bank-proof-${start + i + 1}.jpg`));
      await tgJson(token, "sendMediaGroup", form);
    }
    sent += chunk.length;
  }
  return sent;
}

async function syncSolaireRows(rows) {
  const webhookUrl = process.env.CASH_COUNT_SHEET_WEBHOOK_URL;
  const secrets = [...new Set([process.env.CASH_COUNT_SHEET_WEBHOOK_SECRET, process.env.CASH_COUNT_WEBHOOK_SECRET].filter(Boolean))];
  if (!webhookUrl || !secrets.length) return { status: "not_configured", error: "Cash Count live-sheet bridge is not configured." };
  let lastError = "Live-sheet sync failed.";
  for (const secret of secrets) {
    try {
      const res = await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventType: "CASH_COUNT_SYNC", spreadsheetId: CASH_COUNT_SPREADSHEET_ID, branch: "Solaire", rows, secret }) });
      const text = await res.text(); let out = {}; try { out = JSON.parse(text); } catch (_) {}
      if (res.ok && out && out.ok === true) return { status: "synced" };
      lastError = String((out && out.error) || `Google Sheets webhook failed (${res.status}).`);
    } catch (e) { lastError = e instanceof Error ? e.message : String(e); }
  }
  return { status: "failed", error: lastError };
}

exports.handler = async (event) => {
  const wrong = requirePost(event);
  if (wrong) return wrong;
  const session = verifyToken(event.headers.authorization || event.headers.Authorization);
  if (!session) return json(401, { ok: false, error: "Session expired. Please log in again." });
  if (!isUploader(session.teller)) return json(403, { ok: false, error: "Only the bank-balance uploader can send bank proof." });
  const body = parseBody(event);
  if (!body) return json(400, { ok: false, error: "Bad request." });

  const countBranch = body.branch === "Alphaland" ? "Alphaland" : "Solaire";
  const images = (Array.isArray(body.images) ? body.images : []).slice(0, MAX_IMAGES);
  const banks = (Array.isArray(body.banks) ? body.banks : []).slice(0, 20).filter(b => b && String(b.name || "").trim());
  if (!images.length && !(countBranch === "Alphaland" && banks.length)) return json(400, { ok: false, error: "No screenshots received." });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.SOLAIRE_TELEGRAM_CHAT_ID, threadId = process.env.SOLAIRE_CASH_COUNT_TOPIC_ID;
  if (images.length && (!token || !chatId || !threadId)) return json(500, { ok: false, error: "Telegram is not fully configured for Solaire." });

  const teller = String(body.teller || session.teller || "").slice(0, 60);
  const date = String(body.date || "").slice(0, 10);
  const lines = [`🏦 WEEKLY BANK PROOF — Solaire bank accounts`, `📅 ${date} (start-of-week check)`, `👤 ${teller}${countBranch === "Alphaland" ? " (on duty at Alphaland)" : ""}`, ""]
    .concat(banks.length ? banks.map(b => `${String(b.name || "").slice(0, 40)} — ${peso(b.amt, String(b.cur || "PHP"))}${b.reason ? ` (${String(b.reason).slice(0, 40)})` : ""}`) : ["(no bank balances listed)"])
    .concat(["", "Proof only — not added to any total."]);

  let sent = 0;
  try {
    const buffers = [], labels = [];
    for (let i = 0; i < images.length; i += 1) {
      const item = images[i] && typeof images[i] === "object" ? images[i] : { dataUrl: images[i] };
      const m = String(item.dataUrl || "").match(/^data:image\/jpeg;base64,(.+)$/);
      if (!m) throw new Error("Screenshot format not supported.");
      const buffer = Buffer.from(m[1], "base64");
      if (buffer.length > MAX_BYTES) throw new Error("A screenshot is too large. Please retake it smaller.");
      buffers.push(buffer); labels.push(String(item.label || "").slice(0, 60));
    }
    if (buffers.length) {
      const photoList = labels.some(Boolean) ? "\n\n📎 " + labels.map((l, i) => `${i + 1}) ${l || "screenshot"}`).join("\n📎 ") : "";
      sent = await sendAlbum({ token, chatId, threadId, buffers, caption: lines.join("\n") + photoList });
    }
  } catch (error) {
    return json(502, { ok: false, sent, error: error instanceof Error ? error.message : "Could not reach Telegram." });
  }

  // Alphaland count: record the Solaire bank rows here (a Solaire count records them through its own report).
  let sheet = null;
  if (countBranch === "Alphaland" && banks.length) {
    const now = new Date().toISOString();
    const reference = `BANK-${date}-${Date.now().toString(36).toUpperCase()}`;
    const common = { submittedAt: now, businessDate: date, branch: "Solaire", countType: "", shift: "", teller, reference, sourceApp: "Cash Count App (bank, from Alphaland)" };
    const rows = [];
    banks.forEach(b => {
      const cur = String(b.cur || "PHP").toUpperCase();
      const amount = Number(b.amt) || 0;
      rows.push({ syncKey: `${reference}:BANK-BALANCE-${slug(b.name)}-${cur}`, ...common, category: "Bank Balance", currency: cur, fundAccount: String(b.name).trim(), amount, phpEquivalent: cur === "PHP" ? amount : "", quantityUnits: "", notes: String(b.reason || "") });
      if (images.length) rows.push({ syncKey: `${reference}:BANK-PROOF-${slug(b.name)}-${cur}`, ...common, category: "Bank Proof", currency: cur, fundAccount: String(b.name).trim(), amount, phpEquivalent: "", quantityUnits: "", notes: "Weekly screenshot proof sent to Telegram (proof only, not totalled)" });
    });
    sheet = await syncSolaireRows(rows);
    if (sheet.status !== "synced") return json(502, { ok: false, sent, error: `Screenshots sent, but the sheet was not updated (${sheet.error || sheet.status}). Tell the owner.` });
  }
  return json(200, { ok: true, sent, sheet });
};
