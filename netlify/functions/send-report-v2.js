const { verifyToken, json, requirePost, parseBody } = require("./_auth");
const { sendCashCountPhoto } = require("./report-image");

const CASH_COUNT_SPREADSHEET_ID = "1_msQClr0yfx_jTKeEfop6lnfNvBPd-sNNMkgLnBgsrU";
const FOREX_CODES = new Set([
  "PHP", "USD", "JPY", "KRW", "CNY", "EUR", "GBP", "AUD", "CAD", "CHF",
  "NZD", "SGD", "HKD", "TWD", "THB", "MYR", "IDR", "AED", "SAR", "BND"
]);

function normalizeBranch(value) {
  const branch = String(value || "").trim().toLowerCase();
  if (branch === "alphaland") return "Alphaland";
  if (branch === "solaire") return "Solaire";
  return "";
}

function cleanReport(message) {
  return String(message || "").replace(/\*/g, "").replace(/\r/g, "");
}

function branchFromMessage(message) {
  const match = cleanReport(message).match(/Branch:\s*(Alphaland|Solaire)/i);
  return match ? normalizeBranch(match[1]) : "";
}

function firstMatch(text, regex, fallback = "") {
  const match = text.match(regex);
  return match ? String(match[1] || "").trim() : fallback;
}

function numberFrom(value) {
  const cleaned = String(value || "").replace(/,/g, "").replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function slug(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function businessDateFromTimestamp(timestamp, shift, countType) {
  const dateMatch = String(timestamp || "").match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (!dateMatch) return "";

  const month = Number(dateMatch[1]);
  const day = Number(dateMatch[2]);
  const year = Number(dateMatch[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  const timeMatch = String(timestamp || "").match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i);
  let hour = timeMatch ? Number(timeMatch[1]) : 12;
  if (timeMatch && timeMatch[3]) {
    const meridiem = timeMatch[3].toUpperCase();
    if (meridiem === "PM" && hour < 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
  }

  if (/^night$/i.test(shift) && /^closing$/i.test(countType) && hour < 8) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return date.toISOString().slice(0, 10);
}

function parseNamedBalanceLine(line) {
  const match = String(line || "").match(/^(.+?)\s+—\s+(?:(₱)|([A-Z]{3})\s+)([\d,]+(?:\.\d+)?)(?:\s+\((.*?)\))?\s*$/);
  if (!match) return null;
  return {
    name: match[1].trim(),
    currency: match[2] ? "PHP" : match[3],
    amount: numberFrom(match[4]),
    reason: String(match[5] || "").trim(),
  };
}

function buildCashCountRows(message, branch) {
  const text = cleanReport(message);
  const lines = text.split("\n").map(line => line.trim()).filter(Boolean);

  const shiftMatch = text.match(/Shift:\s*([^\n(]+?)\s*\((Opening|Closing)\)/i);
  const shift = shiftMatch ? shiftMatch[1].trim() : "";
  const countType = shiftMatch ? shiftMatch[2] : "";
  const teller = firstMatch(text, /Teller:\s*([^\n]+)/i);
  const timestamp = firstMatch(text, /Timestamp:\s*([^\n]+)/i, new Date().toISOString());
  const reference = firstMatch(text, /Ref Code:\s*([A-Z0-9-]+)/i) || `CC-${Date.now()}`;
  const businessDate = businessDateFromTimestamp(timestamp, shift, countType);
  const cctv = firstMatch(text, /CCTV footage for\s+(.+?)\s+on record/i);
  const sourceApp = "Cash Count App";

  const common = { submittedAt: timestamp, businessDate, branch, countType, shift, teller, reference, sourceApp };
  const rows = [];
  const addRow = (suffix, fields) => rows.push({ syncKey: `${reference}:${suffix}`, ...common, ...fields });

  for (const line of lines) {
    const fx = line.match(/\b([A-Z]{3}):\s*(.+)$/);
    if (!fx || !FOREX_CODES.has(fx[1])) continue;
    const amount = numberFrom(fx[2]);
    if (amount === null) continue;
    addRow(`FOREX-${fx[1]}`, {
      category: "Forex Cash", currency: fx[1], fundAccount: "Forex Drawer", amount,
      phpEquivalent: fx[1] === "PHP" ? amount : "", quantityUnits: "", notes: ""
    });
  }

  const fundLabels = {
    hive: ["Fund Balance", "Hive", "PHP"],
    juanpay: ["Fund Balance", "JuanPay", "PHP"],
    scratch: ["Fund Balance", "Scratch", "PHP"],
    "lottomatik cash": ["Fund Balance", "LottoMatik Cash", "PHP"],
    "lottomatik wallet": ["Wallet Balance", "LottoMatik Wallet", "PHP"],
  };
  for (const line of lines) {
    const fund = line.match(/^(?:[^A-Za-z0-9]*)(Hive|JuanPay|Scratch|LottoMatik Cash|LottoMatik Wallet):\s*₱?([\d,]+(?:\.\d+)?)/i);
    if (!fund) continue;
    const meta = fundLabels[fund[1].toLowerCase()];
    const amount = numberFrom(fund[2]);
    if (!meta || amount === null) continue;
    addRow(`FUND-${slug(meta[1])}-${slug(meta[2])}`, {
      category: meta[0], currency: meta[2], fundAccount: meta[1], amount,
      phpEquivalent: amount, quantityUnits: "", notes: ""
    });
  }

  let section = "";
  for (const line of lines) {
    if (/Bank Balances/i.test(line)) { section = "bank"; continue; }
    if (/Receivables\s+—\s+Owed to PSulit/i.test(line)) { section = "receivable"; continue; }
    if (/Payables\s+—\s+Owed by PSulit/i.test(line)) { section = "payable"; continue; }
    if (/SCRATCH IT\s+—\s+PHYSICAL COUNT/i.test(line)) { section = "scratchPhysical"; continue; }
    if (/^[─-]{5,}$/.test(line)) { section = ""; continue; }

    if (section === "bank" || section === "receivable" || section === "payable") {
      const entry = parseNamedBalanceLine(line);
      if (!entry || entry.amount === null) continue;
      const category = section === "bank" ? "Bank Balance" : section === "receivable" ? "Receivable" : "Payable";
      addRow(`${slug(category)}-${slug(entry.name)}-${entry.currency}`, {
        category, currency: entry.currency, fundAccount: entry.name, amount: entry.amount,
        phpEquivalent: entry.currency === "PHP" ? entry.amount : "", quantityUnits: "", notes: entry.reason
      });
      continue;
    }

    if (section === "scratchPhysical") {
      const scratch = line.match(/^(Go Banana|Red Hot 7|Go For Gold):\s*(\d+)\s*pcs/i);
      if (!scratch) continue;
      addRow(`SCRATCH-PHYSICAL-${slug(scratch[1])}`, {
        category: "Scratch Physical Inventory", currency: "", fundAccount: scratch[1], amount: "",
        phpEquivalent: "", quantityUnits: Number(scratch[2]), notes: "physical cards"
      });
    }
  }

  const grandTotal = numberFrom(firstMatch(text, /Grand Total:\s*₱?([\d,]+(?:\.\d+)?)/i));
  const phpRow = rows.find(row => row.category === "Forex Cash" && row.currency === "PHP");
  const summaryAmount = grandTotal === null ? (phpRow ? phpRow.amount : "") : grandTotal;
  addRow("SUMMARY-GRAND-TOTAL", {
    category: "Summary", currency: "PHP", fundAccount: "Grand Total", amount: summaryAmount,
    phpEquivalent: summaryAmount, quantityUnits: "", notes: cctv ? `CCTV: ${cctv}` : "Submitted & Locked"
  });

  return rows;
}

async function syncCashCountSheet(message, branch) {
  const webhookUrl = process.env.CASH_COUNT_SHEET_WEBHOOK_URL;
  const secret = process.env.CASH_COUNT_SHEET_WEBHOOK_SECRET;
  if (!webhookUrl || !secret) return { status: "not_configured" };

  const rows = buildCashCountRows(message, branch);
  if (!rows.length) return { status: "no_rows" };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType: "CASH_COUNT_SYNC", spreadsheetId: CASH_COUNT_SPREADSHEET_ID, branch, rows, secret }),
    });
    const bodyText = await response.text();
    let result = {};
    try { result = JSON.parse(bodyText); } catch (_) { result = { raw: bodyText.slice(0, 200) }; }
    if (!response.ok || result.ok !== true) throw new Error(result.error || `Google Sheets webhook failed (${response.status}).`);
    return { status: "synced", appended: Number(result.appended || 0), duplicates: Number(result.duplicates || 0) };
  } catch (error) {
    console.error("Cash Count Google Sheets sync failed:", error.message);
    return { status: "failed", error: error.message };
  }
}

async function sendTextFallback({ token, chatId, threadId, text }) {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_thread_id: Number(threadId), text: text.slice(0, 4096) }),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.description || "Telegram rejected the fallback message.");
  return result.result && result.result.message_id;
}

exports.handler = async (event) => {
  const wrongMethod = requirePost(event);
  if (wrongMethod) return wrongMethod;

  const session = verifyToken(event.headers.authorization || event.headers.Authorization);
  if (!session) return json(401, { ok: false, error: "Session expired. Please log in again." });

  const body = parseBody(event);
  if (!body) return json(400, { ok: false, error: "Bad request." });

  const fullText = String(body.message || "");
  if (!fullText.trim()) return json(400, { ok: false, error: "Nothing to send." });

  const branch = normalizeBranch(body.branch) || branchFromMessage(fullText);
  if (!branch) return json(400, { ok: false, error: "Could not determine Cash Count branch." });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = branch === "Alphaland" ? process.env.ALPHALAND_TELEGRAM_CHAT_ID : process.env.SOLAIRE_TELEGRAM_CHAT_ID;
  const threadId = branch === "Alphaland" ? process.env.ALPHALAND_CASH_COUNT_TOPIC_ID : process.env.SOLAIRE_CASH_COUNT_TOPIC_ID;

  if (!token || !chatId || !threadId) {
    return json(500, { ok: false, error: `Telegram is not fully configured for ${branch}.` });
  }

  let telegramMessageId;
  let delivery = "image";
  let imageError = "";

  try {
    try {
      telegramMessageId = await sendCashCountPhoto({ token, chatId, threadId, message: fullText });
    } catch (error) {
      imageError = error.message;
      delivery = "text_fallback";
      console.error("Styled Telegram image failed; using text fallback:", error.message);
      telegramMessageId = await sendTextFallback({ token, chatId, threadId, text: fullText });
    }

    const sheetSync = await syncCashCountSheet(fullText, branch);

    return json(200, {
      ok: true,
      branch,
      delivery,
      image_error: imageError || undefined,
      chat_id: chatId,
      message_thread_id: Number(threadId),
      telegram_message_id: telegramMessageId,
      sheet_sync: sheetSync,
    });
  } catch (error) {
    console.error("send-report-v2 failed:", error.message);
    return json(502, { ok: false, error: error.message || "Could not reach Telegram." });
  }
};
