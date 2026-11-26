const { verifyToken, json, requirePost, parseBody } = require("./_auth");
const { sendCashCountPhoto } = require("./report-image");

const CASH_COUNT_SPREADSHEET_ID = "1_msQClr0yfx_jTKeEfop6lnfNvBPd-sNNMkgLnBgsrU";
// IMPORTANT: this MUST stay in sync with the CURRENCIES_SHORT list in
// index.html (the Cash Count form's own currency picker) and with
// https://rates.psulit.ph/. A currency present in the form but missing
// here gets silently dropped when a Cash Count report is converted into
// Google Sheet rows (it never reaches the sheet or the audit report),
// which is exactly the bug that previously affected VND and BHD.
// When PSulit starts trading a new currency, add it to BOTH lists.
const FOREX_CODES = new Set([
  "PHP", "USD", "JPY", "KRW", "CNY", "EUR", "GBP", "AUD", "CAD", "CHF",
  "NZD", "SGD", "AED", "SAR", "HKD", "KWD", "BHD", "QAR", "JOD",
  "MYR", "BND", "THB", "TWD", "IDR", "VND"
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
  if (/^night$/i.test(shift) && /^closing$/i.test(countType) && hour < 8) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function parseNamedBalanceLine(line) {
  const match = String(line || "").match(/^(.+?)\s+—\s+(?:(₱)|([A-Z]{3})\s+)([\d,]+(?:\.\d+)?)(?:\s+\((.*?)\))?\s*$/);
  if (!match) return null;
  return { name: match[1].trim(), currency: match[2] ? "PHP" : match[3], amount: numberFrom(match[4]), reason: String(match[5] || "").trim() };
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
    addRow(`FOREX-${fx[1]}`, { category: "Forex Cash", currency: fx[1], fundAccount: "Forex Drawer", amount, phpEquivalent: fx[1] === "PHP" ? amount : "", quantityUnits: "", notes: "" });
  }

  const fundLabels = {
    hive: ["Fund Balance", "Hive", "PHP"],
    juanpay: ["Fund Balance", "JuanPay", "PHP"],
    scratch: ["Fund Balance", "Scratch", "PHP"],
    "lottomatik cash": ["Fund Balance", "LottoMatik Cash", "PHP"],
    "lottomatik wallet": ["Wallet Balance", "LottoMatik Wallet", "PHP"],
  };
  // The generic "Scratch: ₱..." subtotal can differ from the dedicated
  // Scratch Cash on Hand field. For the audit's Scratch fund balance, prefer
  // the explicit cash-on-hand amount when the report includes it.
  const scratchCashOnHand = numberFrom(firstMatch(text, /Cash on Hand:\s*₱?([\d,]+(?:\.\d+)?)/i));
  for (const line of lines) {
    const fund = line.match(/^(?:[^A-Za-z0-9]*)(Hive|JuanPay|Scratch|LottoMatik Cash|LottoMatik Wallet)(?:\s*\(PHP\))?:\s*₱?([\d,]+(?:\.\d+)?)/i);
    if (!fund) continue;
    const meta = fundLabels[fund[1].toLowerCase()];
    let amount = numberFrom(fund[2]);
    if (fund[1].toLowerCase() === "scratch" && scratchCashOnHand !== null) amount = scratchCashOnHand;
    if (!meta || amount === null) continue;
    addRow(`FUND-${slug(meta[1])}-${slug(meta[2])}`, { category: meta[0], currency: meta[2], fundAccount: meta[1], amount, phpEquivalent: amount, quantityUnits: "", notes: "" });
  }

  // Hive is reported as separate currency sections, e.g. "Hive — PHP (Philippine Peso)"
  // followed by "Subtotal: ₱...". Parse each section subtotal so all Hive currencies
  // reach the live sheet, not just the currently selected currency in the header.
  let hiveCurrencySection = "";
  for (const line of lines) {
    const hiveHeader = line.match(/^(?:🐝\s*)?Hive\s+—\s+([A-Z]{3})\s+\([^)]*\)\s*$/i);
    if (hiveHeader) {
      hiveCurrencySection = hiveHeader[1].toUpperCase();
      continue;
    }
    if (hiveCurrencySection) {
      const hiveSubtotal = line.match(/^Subtotal:\s*(.+)$/i);
      if (hiveSubtotal) {
        const amount = numberFrom(hiveSubtotal[1]);
        if (amount !== null) {
          addRow(`FUND-HIVE-${slug(hiveCurrencySection)}`, {
            category: "Fund Balance",
            currency: hiveCurrencySection,
            fundAccount: "Hive",
            amount,
            phpEquivalent: hiveCurrencySection === "PHP" ? amount : "",
            quantityUnits: "",
            notes: ""
          });
        }
        hiveCurrencySection = "";
      }
    }
  }

  // Telegram's submitted report uses a compact Hive summary line, for example:
  // "🐝 HIVE: 🇵🇭 PHP — ₱12,345.00". Parse this too; the detailed
  // per-denomination Hive sections are only present in the separate breakdown.
  for (const line of lines) {
    const hiveSummary = line.match(/^🐝\s*HIVE:\s*.*?\b([A-Z]{3})\s+—\s+(.+)$/i);
    if (!hiveSummary) continue;
    const currency = hiveSummary[1].toUpperCase();
    const amount = numberFrom(hiveSummary[2]);
    const suffix = `FUND-HIVE-${slug(currency)}`;
    if (amount !== null && !rows.some(row => row.syncKey === `${reference}:${suffix}`)) {
      addRow(suffix, {
        category: "Fund Balance",
        currency,
        fundAccount: "Hive",
        amount,
        phpEquivalent: currency === "PHP" ? amount : "",
        quantityUnits: "",
        notes: ""
      });
    }
  }

  // AR Booklets Remaining — save as a separate inventory row so the audit and sheet track it.
  const arBooklets = numberFrom(firstMatch(text, /AR Booklets Remaining:\s*(\d+)/i));
  if (arBooklets !== null) {
    addRow("AR-BOOKLETS-REMAINING", {
      category: "AR Inventory",
      currency: "",
      fundAccount: "AR Booklets",
      amount: "",
      phpEquivalent: "",
      quantityUnits: arBooklets,
      notes: "AR booklets remaining on hand"
    });
  }

  // Keep the reported Scratch winning-card payout as its own audit row.
  // This is a separate figure from the physical Scratch Cash on Hand balance.
  const scratchPayout = numberFrom(firstMatch(text, /Winning Cards\s*\/\s*Payout:\s*₱?([\d,]+(?:\.\d+)?)/i));
  if (scratchPayout !== null) {
    addRow("SCRATCH-WINNING-PAYOUT", {
      category: "Scratch Winning Payout",
      currency: "PHP",
      fundAccount: "Winning Cards / Payout",
      amount: scratchPayout,
      phpEquivalent: scratchPayout,
      quantityUnits: "",
      notes: "reported Scratch winning-card payout"
    });
  }

  const bankProofSent = /Weekly bank proof:\s*✓/i.test(text);
  let section = "";
  for (const line of lines) {
    const thermal = line.match(/^(?:LottoMatik\s+)?(?:Sealed\s+)?Thermal Rolls(?:\s+on Hand)?:\s*(\d+)\s*rolls?/i);
    if (thermal) { addRow("LOTTOMATIK-THERMAL-ROLLS-SEALED", { category: "LottoMatik Thermal Rolls (Sealed)", currency: "", fundAccount: "Thermal Rolls", amount: "", phpEquivalent: "", quantityUnits: Number(thermal[1]), notes: "sealed (unopened) rolls counted" }); continue; }
    if (/Sent after a count check:/i.test(line)) { section = ""; continue; }
    if (/Bank Balances/i.test(line)) { section = "bank"; continue; }
    if (/Receivables\s+—\s+Owed to\s+/i.test(line)) { section = "receivable"; continue; }
    if (/Payables\s+—\s+Owed by\s+/i.test(line)) { section = "payable"; continue; }
    // The form writes "SCRATCH INVENTORY"; older reports used "SCRATCH IT — PHYSICAL COUNT".
    if (/SCRATCH INVENTORY|SCRATCH IT\s+—\s+PHYSICAL COUNT/i.test(line)) { section = "scratchPhysical"; continue; }
    if (/SCRATCH IT\s+—\s+WINNING CARDS COUNT/i.test(line)) { section = "scratchWinning"; continue; }
    if (/^[─-]{5,}$/.test(line)) { section = ""; continue; }
    if (section === "bank" || section === "receivable" || section === "payable") {
      const entry = parseNamedBalanceLine(line);
      if (!entry || entry.amount === null) continue;
      const category = section === "bank" ? "Bank Balance" : section === "receivable" ? "Receivable" : "Payable";
      addRow(`${slug(category)}-${slug(entry.name)}-${entry.currency}`, { category, currency: entry.currency, fundAccount: entry.name, amount: entry.amount, phpEquivalent: entry.currency === "PHP" ? entry.amount : "", quantityUnits: "", notes: entry.reason });
      // Weekly bank proof: a screenshot of this balance was sent to Telegram. Recorded as its own row; never part of any total.
      if (section === "bank" && bankProofSent) addRow(`BANK-PROOF-${slug(entry.name)}-${entry.currency}`, { category: "Bank Proof", currency: entry.currency, fundAccount: entry.name, amount: entry.amount, phpEquivalent: "", quantityUnits: "", notes: "Weekly screenshot proof sent to Telegram (proof only, not totalled)" });
      continue;
    }
    if (section === "scratchWinning") {
      // Winning cards presented today, per game — compared by the audit with the Scratch live sheet's payouts.
      const win = line.match(/^(Super Go Banana|Ruby Riches|Go Banana|Red Hot 7|Go For Gold):\s*(\d+)\s*cards?/i);
      if (!win) continue;
      addRow(`SCRATCH-WINNING-CARDS-${slug(win[1])}`, { category: "Scratch Winning Cards", currency: "", fundAccount: win[1], amount: "", phpEquivalent: "", quantityUnits: Number(win[2]), notes: "winning cards presented today" });
      continue;
    }
    if (section === "scratchPhysical") {
      const scratch = line.match(/^(Super Go Banana|Ruby Riches|Go Banana|Red Hot 7|Go For Gold):\s*(\d+)\s*pcs/i);
      if (!scratch) continue;
      addRow(`SCRATCH-PHYSICAL-${slug(scratch[1])}`, { category: "Scratch Physical Inventory", currency: "", fundAccount: scratch[1], amount: "", phpEquivalent: "", quantityUnits: Number(scratch[2]), notes: "physical cards" });
    }
  }

  const grandTotal = numberFrom(firstMatch(text, /Grand Total:\s*₱?([\d,]+(?:\.\d+)?)/i));
  const phpRow = rows.find(row => row.category === "Forex Cash" && row.currency === "PHP");
  const summaryAmount = grandTotal === null ? (phpRow ? phpRow.amount : "") : grandTotal;
  addRow("SUMMARY-GRAND-TOTAL", { category: "Summary", currency: "PHP", fundAccount: "Grand Total", amount: summaryAmount, phpEquivalent: summaryAmount, quantityUnits: "", notes: cctv ? `CCTV: ${cctv}` : "Submitted & Locked" });
  return rows;
}

function sheetSecrets() {
  return [...new Set([
    process.env.CASH_COUNT_SHEET_WEBHOOK_SECRET,
    process.env.CASH_COUNT_WEBHOOK_SECRET,
  ].filter(Boolean))];
}

async function postSheetSync(webhookUrl, secret, branch, rows) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventType: "CASH_COUNT_SYNC", spreadsheetId: CASH_COUNT_SPREADSHEET_ID, branch, rows, secret }),
  });
  const bodyText = await response.text();
  let result = {};
  try { result = JSON.parse(bodyText); } catch (_) { result = { raw: bodyText.slice(0, 200) }; }
  return { response, result };
}

async function syncRows(branch, rows) {
  const webhookUrl = process.env.CASH_COUNT_SHEET_WEBHOOK_URL;
  const secrets = sheetSecrets();
  if (!webhookUrl || !secrets.length) return { status: "not_configured" };
  let lastError = "Live-sheet sync failed.";
  for (const secret of secrets) {
    try {
      const { response, result } = await postSheetSync(webhookUrl, secret, branch, rows);
      if (response.ok && result && result.ok === true) return { status: "synced", appended: Number(result.appended || 0), duplicates: Number(result.duplicates || 0) };
      lastError = String((result && result.error) || `Google Sheets webhook failed (${response.status}).`);
    } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
  }
  return { status: "failed", error: lastError };
}

async function syncCashCountSheet(message, branch) {
  const webhookUrl = process.env.CASH_COUNT_SHEET_WEBHOOK_URL;
  const secrets = sheetSecrets();
  if (!webhookUrl || !secrets.length) return { status: "not_configured", error: "Cash Count live-sheet bridge is not configured." };
  const rows = buildCashCountRows(message, branch);
  if (!rows.length) return { status: "no_rows", error: "Cash Count report could not be converted to live-sheet rows." };

  let lastError = "Live-sheet sync failed.";
  for (const secret of secrets) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const { response, result } = await postSheetSync(webhookUrl, secret, branch, rows);
        if (response.ok && result && result.ok === true) {
          return { status: "synced", appended: Number(result.appended || 0), duplicates: Number(result.duplicates || 0), rowCount: rows.length };
        }
        lastError = String((result && result.error) || `Google Sheets webhook failed (${response.status}).`);
        if (/Unauthorized/i.test(lastError)) break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 600));
    }
  }
  return { status: "failed", error: lastError, rowCount: rows.length };
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


// ---- Handover check (separate from the Cash Count report) ----
// After an Opening is posted, compare it with the branch's last Closing and, if anything differs,
// post a separate "please recount" message in the same topic. Never affects the report or the sheet.
async function postHandoverCheck({ token, chatId, threadId, branch, text, replyTo }) {
  if (!process.env.AUDIT_READER_URL || !process.env.AUDIT_READER_SECRET) return { status: "skipped" };
  const rows = buildCashCountRows(text, branch);
  const head = rows[0];
  if (!head || head.countType !== "Opening") return { status: "skipped" };
  const out = await readerRows(branch, { type: "Closing", excludeRef: head.reference, beforeAt: head.submittedAt });
  if (!out || out.ok !== true || !out.last || !Array.isArray(out.rows)) return { status: "no-closing" };
  const diffs = compareWithClosing(rows.map(r => ({ key: r.syncKey.slice(r.syncKey.indexOf(":") + 1), category: r.category, currency: r.currency, fund: r.fundAccount, amount: r.amount, qty: r.quantityUnits })), out.rows);
  if (!diffs.length) return { status: "matched" };
  const site = process.env.URL || "https://psulit-cashcount.netlify.app";
  const link = `${site}/?recount=${encodeURIComponent(head.reference)}&branch=${encodeURIComponent(branch)}`;
  const msg = [`⚠️ HANDOVER MISMATCH — ${branch.toUpperCase()}`,
    `Closed by ${out.last.teller || "?"} (${out.last.submittedAt || "?"}) → Opened by ${head.teller || "?"} (${head.submittedAt || ""})`,
    `The opening count does not match the last closing:`, ...diffs.map(d => d.line), ``, `${head.teller || "Teller"}, please recount ONLY these now: tap the button below.`].join("\n");
  const res = await tgSend(token, { chat_id: chatId, message_thread_id: Number(threadId), text: msg.slice(0, 4000),
    reply_markup: { inline_keyboard: [[{ text: "🔁 Tap here to recount", url: link }]] },
    ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}) });
  return { status: res.ok ? "posted" : "telegram-failed", items: diffs.length };
}

const CHECKED = new Set(["Forex Cash", "Fund Balance", "Wallet Balance", "Scratch Physical Inventory"]);
const numOrNull = v => { const s = String(v === undefined || v === null ? "" : v).trim(); if (!s) return null; const x = Number(s.replace(/[^0-9.\-]/g, "")); return Number.isFinite(x) ? x : null; };
const fmtVal = (v, cur, qty) => qty ? `${v} pcs` : (!cur || cur === "PHP") ? "₱" + v.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : `${v.toLocaleString("en-PH", { maximumFractionDigits: 2 })} ${cur}`;
const labelFor = r => r.category === "Forex Cash" ? r.currency : r.category === "Scratch Physical Inventory" ? `${r.fund} cards` : `${r.fund}${r.currency && r.currency !== "PHP" ? " " + r.currency : ""}`;
// mine / closing: [{ key, category, currency, fund, amount, qty }]. Returns the lines that differ (with both amounts, for the Telegram message only).
function compareWithClosing(mine, closing) {
  const prevByKey = new Map((closing || []).filter(r => CHECKED.has(r.category)).map(r => [r.key, r]));
  const out = [];
  for (const row of (mine || []).filter(r => CHECKED.has(r.category))) {
    const prev = prevByKey.get(row.key);
    if (!prev) continue;
    const qty = row.category === "Scratch Physical Inventory";
    const a = numOrNull(qty ? prev.qty : prev.amount), b = numOrNull(qty ? row.qty : row.amount);
    if (a === null || b === null || Math.abs(a - b) <= 0.005) continue;
    const d = Math.round((b - a) * 100) / 100;
    out.push({ key: row.key, label: labelFor(row), line: `• ${labelFor(row)}: ${fmtVal(a, row.currency, qty)} → ${fmtVal(b, row.currency, qty)} (${d > 0 ? "+" : "−"}${fmtVal(Math.abs(d), row.currency, qty)})` });
  }
  return out;
}
async function readerRows(branch, opts) {
  const readerUrl = process.env.AUDIT_READER_URL, secret = process.env.AUDIT_READER_SECRET;
  if (!readerUrl || !secret) return null;
  const q = Object.entries(opts || {}).filter(([, v]) => v).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join("");
  const url = readerUrl + (readerUrl.includes("?") ? "&" : "?") + "action=lastCountRows&branch=" + encodeURIComponent(branch) + q + "&secret=" + encodeURIComponent(secret);
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
  try { return JSON.parse(await (await fetch(url, { signal: ctl.signal })).text()); } finally { clearTimeout(t); }
}
async function tgSend(token, payload) {
  return fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}
exports.buildCashCountRows = buildCashCountRows;
exports.postHandoverCheck = postHandoverCheck;
Object.assign(exports, { compareWithClosing, readerRows, tgSend, syncRows, fmtVal, labelFor, numOrNull, CHECKED });
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

  // Start the live-sheet sync immediately and run it in parallel with Telegram.
  // The response still succeeds based on Telegram delivery, but we wait for the
  // live sheet result so the exact accepted Cash Count is reliably recorded.
  const sheetSyncPromise = syncCashCountSheet(fullText, branch);

  try {
    let telegramMessageId;
    let delivery = "image";
    let imageError = "";

    try {
      telegramMessageId = await sendCashCountPhoto({ token, chatId, threadId, message: fullText });
    } catch (error) {
      imageError = error instanceof Error ? error.message : String(error);
      delivery = "text_fallback";
      telegramMessageId = await sendTextFallback({ token, chatId, threadId, text: fullText });
    }

    const sheetSync = await sheetSyncPromise;
    const handover = await postHandoverCheck({ token, chatId, threadId, branch, text: fullText, replyTo: telegramMessageId })
      .catch(e => ({ status: "error", error: e instanceof Error ? e.message : String(e) }));
    return json(200, {
      handover_check: handover,
      ok: true,
      telegram_sent: true,
      sheet_saved: sheetSync.status === "synced",
      branch,
      delivery,
      image_error: imageError || undefined,
      chat_id: chatId,
      message_thread_id: Number(threadId),
      telegram_message_id: telegramMessageId,
      sheet_sync: sheetSync,
      warning: sheetSync.status === "synced" ? undefined : `Telegram sent; Cash Count sheet sync is ${sheetSync.status}.`,
    });
  } catch (error) {
    const sheetSync = await sheetSyncPromise.catch(sheetError => ({
      status: "failed",
      error: sheetError instanceof Error ? sheetError.message : String(sheetError),
    }));
    return json(502, {
      ok: false,
      telegram_sent: false,
      sheet_saved: sheetSync.status === "synced",
      sheet_sync: sheetSync,
      error: error instanceof Error ? error.message : "Could not reach Telegram.",
    });
  }
};
