const crypto = require("crypto");
const { sendCashCountPhoto } = require("./report-image");

// One-off corrected image resend. Does NOT sync or modify Google Sheets.
const KEY_SHA256 = "99776d38cdb6c37ae498f40ccc7996cf8c5a91bc8fdba12157efe4177ab10372";
const REPORT = `📋 PSULIT CASH COUNT REPORT
---------------------
🏦 Branch: Alphaland
🔄 Shift: Mid-Shift (Closing)
👤 Teller: Joan Legaspi
🕐 Timestamp: 10/17/2026, 20:45:43
🔑 Ref Code: PSC-MVCE3P9H-K7CW
---------------------
🇵🇭 PHP: ₱50,274.49
🇺🇸 USD: $1,105
SGD: S$1,259
HKD: HK$840
🇨🇦 CAD: C$125
🇯🇵 JPY: ¥36,000
🇦🇺 AUD: A$190
🇬🇧 GBP: £145
🇪🇺 EUR: €1,020
KRW: ₩73,000
BND: B$10
CNY: ¥152
THB: ฿2,340
TWD: NT$2,000
SAR: SR500
BHD: BD30
MYR: RM50
VND: ₫1,430,000
💵 Grand Total: ₱332,638.99
📊 Rates: exchangerate-api.com
📒 AR Booklets Remaining: 9
---------------------
🐝 Hive: ₱180,542.81
📱 JuanPay: ₱3,570.00
🎰 LottoMatik Cash: ₱5,728.00
📱 LottoMatik Wallet: ₱1,333.77
---------------------
📥 Receivables — Owed to PSulit
Cristina Mirang — ₱133.00
MB 400 SGD — ₱19,780.00
Ms Jazelle Espiritu — ₱1,273.50
Secuna — ₱4,000.00
---------------------
📤 Payables — Owed by PSulit
Hive — ₱50,000.00
---------------------
SCRATCH INVENTORY
Go Banana: 407 pcs
Red Hot 7: 363 pcs
Go For Gold: 0 pcs
Cash on Hand: ₱16,945.00
Thermal Rolls on Hand: 6 rolls
---------------------
SCRATCH IT — WINNING CARDS COUNT
Go Banana: 6 cards
Red Hot 7: 2 cards
Go For Gold: 0 cards
---------------------
✅ Submitted & Locked
⚠️ CCTV footage for Alphaland_Front Desk on record.`;

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return reply(405, { ok: false, error: "GET required." });
  const url = new URL(event.rawUrl || `https://local.invalid${event.path || "/"}`);
  const supplied = url.searchParams.get("key") || "";
  const digest = crypto.createHash("sha256").update(supplied).digest("hex");
  const a = Buffer.from(digest, "hex");
  const b = Buffer.from(KEY_SHA256, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return reply(401, { ok: false, error: "Unauthorized." });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.ALPHALAND_TELEGRAM_CHAT_ID;
  const threadId = process.env.ALPHALAND_CASH_COUNT_TOPIC_ID;
  if (!token || !chatId || !threadId) return reply(500, { ok: false, error: "Alphaland Telegram destination is not configured." });

  try {
    const messageId = await sendCashCountPhoto({ token, chatId, threadId, message: REPORT });
    return reply(200, {
      ok: true,
      telegram_sent: true,
      telegram_message_id: messageId,
      branch: "Alphaland",
      reference: "PSC-MVCE3P9H-K7CW",
      payable: { name: "Hive", amount: 50000, currency: "PHP" },
      cash_log_written: false,
      note: "Image-only corrected resend. The cash log and Cash Count records were not modified.",
    });
  } catch (error) {
    console.error("one-off Cash Count image resend failed:", error && error.message ? error.message : error);
    return reply(502, { ok: false, telegram_sent: false, error: error && error.message ? error.message : "Telegram send failed." });
  }
};
