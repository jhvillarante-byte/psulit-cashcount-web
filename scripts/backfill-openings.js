const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN is not available to the Netlify build.");
}

if (process.env.CONTEXT && process.env.CONTEXT !== "production") {
  console.log("Skipping opening Cash Count backfill outside production.");
  process.exit(0);
}

const posts = [
  {
    branch: "Alphaland",
    chatId: "-1004316052145",
    threadId: 2,
    text: `📋 PSULIT CASH COUNT REPORT
---------------------
🏦 Branch: Alphaland
🔄 Shift: Morning (Opening)
👤 Teller: Jazelle Espiritu
🕐 Timestamp: 09/23/2026, 09:20:20
🔑 Ref Code: PSC-MUDF1UF7-DKTQ
---------------------
🇵🇭 PHP: ₱171,185.00
🇺🇸 USD: $1,007.00
🇮🇩 IDR: Rp1,200,000
🇯🇵 JPY: ¥10,000
🇨🇦 CAD: C$100
🇬🇧 GBP: £10
🇪🇺 EUR: €50
🇸🇦 SAR: SR2,500
🇹🇼 TWD: NT$400
💵 Grand Total: ₱293,674.42
---------------------
🐝 Hive: ₱130,035.25
📱 JuanPay: ₱3,570.00
🎫 Scratch: ₱14,278.00
🎰 LottoMatik Cash: ₱3,218.00
📱 LottoMatik Wallet: ₱1,963.04
---------------------
📥 Receivables — Owed to PSulit
MB — ₱19,780.00
---------------------
🎟️ SCRATCH IT — PHYSICAL COUNT
Go Banana: 546 pcs
Red Hot 7: 445 pcs
Go For Gold: 0 pcs
---------------------
✅ Submitted & Locked
⚠️ CCTV footage for Alphaland_Front Desk on record.
↩️ Backfilled to the new Telegram topic from this morning's submitted Cash Count.`
  },
  {
    branch: "Solaire",
    chatId: "-1003922155338",
    threadId: 13,
    text: `📋 PSULIT CASH COUNT REPORT
---------------------
🏦 Branch: Solaire
🔄 Shift: Morning (Opening)
👤 Teller: Irene Maligat
🕐 Timestamp: 09/23/2026, 10:49:06
🔑 Ref Code: PSC-MUDI7ZNG-VN9A
---------------------
🇵🇭 PHP: ₱324,307.59
🇺🇸 USD: $14,255.00
🇯🇵 JPY: ¥90,000
🇪🇺 EUR: €100
🇦🇺 AUD: A$100
🇨🇭 CHF: Fr30
🇹🇼 TWD: NT$35,300
💵 Grand Total: ₱1,334,599.60
---------------------
🐝 Hive: ₱96,172.10
---------------------
🏦 Bank Balances
BDO — ₱50,000.00
BDO — USD 500.00
---------------------
📥 Receivables — Owed to PSulit
8VENTURES — ₱1,000,000.00
---------------------
✅ Submitted & Locked
⚠️ CCTV footage for SolaireCam01 on record.
↩️ Backfilled to the new Telegram topic from this morning's submitted Cash Count.`
  }
];

async function send(post) {
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: post.chatId,
      message_thread_id: post.threadId,
      text: post.text
    })
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(`${post.branch} backfill failed: ${result.description || response.status}`);
  }
  console.log(`${post.branch} opening Cash Count backfilled to Telegram message ${result.result.message_id}.`);
}

(async () => {
  for (const post of posts) await send(post);
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
