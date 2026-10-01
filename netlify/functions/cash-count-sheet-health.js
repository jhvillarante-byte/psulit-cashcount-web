// Read-only health check for the Cash Count -> Google Sheets bridge.
// Sends an empty CASH_COUNT_SYNC payload, so it never appends audit rows.
exports.handler = async () => {
  try {
    const webhookUrl = process.env.CASH_COUNT_SHEET_WEBHOOK_URL;
    const secret = process.env.CASH_COUNT_SHEET_WEBHOOK_SECRET;
    if (!webhookUrl || !secret) {
      return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: false, stage: "config", error: "Cash Count sheet webhook is not configured." }) };
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: "CASH_COUNT_SYNC",
        spreadsheetId: "1_msQClr0yfx_jTKeEfop6lnfNvBPd-sNNMkgLnBgsrU",
        branch: "Solaire",
        rows: [],
        secret,
      }),
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { data = { raw: text.slice(0, 300) }; }

    return {
      statusCode: response.ok && data && data.ok === true ? 200 : 502,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ ok: response.ok && data && data.ok === true, stage: "google_sheet_bridge", responseStatus: response.status, bridge: data }),
    };
  } catch (error) {
    return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: false, stage: "request", error: error instanceof Error ? error.message : String(error) }) };
  }
};
