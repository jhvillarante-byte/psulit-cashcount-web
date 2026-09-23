const { verifyToken, json, requirePost } = require("./_auth");
const { sendCashCountPhoto } = require("./report-image");

const REPORTS = {
  Alphaland: `💰 CASH COUNT — OPENING\nBranch: Alphaland\nShift: Morning (Opening)\nTeller: Jazelle Espiritu\nTimestamp: 09/23/2026 09:20:20\nRef Code: PSC-MUDF1UF7-DKTQ\n\nFOREX CASH\nPHP: ₱171,185.00\nUSD: 1,007\nIDR: 1,200,000\nJPY: 10,000\nCAD: 100\nGBP: 10\nEUR: 50\nSAR: 2,500\nTWD: 400\n\nOTHER BALANCES\nHive: ₱130,035.25\nJuanPay: ₱3,570.00\nScratch: ₱14,278.00\nLottoMatik Cash: ₱3,218.00\nLottoMatik Wallet: ₱1,963.04\n\nRECEIVABLES — OWED TO PSULIT\nMB — ₱19,780.00\n\nSCRATCH IT — PHYSICAL COUNT\nGo Banana: 546 pcs\nRed Hot 7: 445 pcs\nGo For Gold: 0 pcs\n\nGrand Total: ₱293,674.42\n⚠️ CCTV footage for Alphaland_Front Desk on record.\n\nBACKFILL: Original morning opening count for 09/23/2026.`,

  Solaire: `💰 CASH COUNT — OPENING\nBranch: Solaire\nShift: Morning (Opening)\nTeller: Irene Maligat\nTimestamp: 09/23/2026 10:49:06\nRef Code: PSC-MUDI7ZNG-VN9A\n\nFOREX CASH\nPHP: ₱324,307.59\nUSD: 14,255\nJPY: 90,000\nEUR: 100\nAUD: 100\nCHF: 30\nTWD: 35,300\n\nOTHER BALANCES\nHive: ₱96,172.10\n\nBANK BALANCES\nBDO — ₱50,000.00\nBDO — USD 500\n\nRECEIVABLES — OWED TO PSULIT\n8VENTURES — ₱1,000,000.00\n\nGrand Total: ₱1,334,599.60\n⚠️ CCTV footage for SolaireCam01 on record.\n\nBACKFILL: Original morning opening count for 09/23/2026.`
};

function telegramTarget(branch) {
  if (branch === "Alphaland") {
    return {
      chatId: process.env.ALPHALAND_TELEGRAM_CHAT_ID,
      threadId: process.env.ALPHALAND_CASH_COUNT_TOPIC_ID,
    };
  }
  return {
    chatId: process.env.SOLAIRE_TELEGRAM_CHAT_ID,
    threadId: process.env.SOLAIRE_CASH_COUNT_TOPIC_ID,
  };
}

async function sendTelegram(branch, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const { chatId, threadId } = telegramTarget(branch);
  if (!token || !chatId || !threadId) throw new Error(`${branch} Telegram target is not configured.`);
  return sendCashCountPhoto({ token, chatId, threadId, message: text });
}

exports.handler = async (event) => {
  const wrongMethod = requirePost(event);
  if (wrongMethod) return wrongMethod;

  const session = verifyToken(event.headers.authorization || event.headers.Authorization);
  if (!session) return json(401, { ok: false, error: "Session expired. Please log in again." });

  if (session.teller !== "Jen Villarante") {
    return json(403, { ok: false, error: "Owner access required." });
  }

  try {
    const alphalandMessageId = await sendTelegram("Alphaland", REPORTS.Alphaland);
    const solaireMessageId = await sendTelegram("Solaire", REPORTS.Solaire);

    return json(200, {
      ok: true,
      delivery: "image",
      posted: {
        Alphaland: alphalandMessageId,
        Solaire: solaireMessageId,
      },
    });
  } catch (error) {
    console.error("Styled opening Cash Count backfill failed:", error);
    return json(502, {
      ok: false,
      error: `Styled image post failed: ${error.message || "Unknown error"}`,
    });
  }
};
