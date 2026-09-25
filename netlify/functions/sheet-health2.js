const CASH_COUNT_SPREADSHEET_ID = "1_msQClr0yfx_jTKeEfop6lnfNvBPd-sNNMkgLnBgsrU";

exports.handler = async () => {
  const webhookUrl = process.env.CASH_COUNT_SHEET_WEBHOOK_URL;
  const secret = process.env.CASH_COUNT_SHEET_WEBHOOK_SECRET;
  if (!webhookUrl || !secret) {
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: false, status: "not_configured" }) };
  }
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType: "CASH_COUNT_SYNC", spreadsheetId: CASH_COUNT_SPREADSHEET_ID, branch: "Alphaland", rows: [], secret }),
    });
    const text = await response.text();
    let result = {};
    try { result = JSON.parse(text); } catch (_) { result = { ok: false, error: "Non-JSON webhook response" }; }
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: result.ok === true, webhook_status: response.status, result }) };
  } catch (error) {
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: false, error: error.message || "Health check failed" }) };
  }
};
