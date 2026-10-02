async function sync(webhook, secret, body) {
  const response = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventType: "CASH_COUNT_SYNC", spreadsheetId: "1_msQClr0yfx_jTKeEfop6lnfNvBPd-sNNMkgLnBgsrU", ...body, secret }),
  });
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); } catch { result = { raw: text.slice(0, 500) }; }
  return { status: response.status, ok: response.ok, result };
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const webhook = Netlify.env.get("CASH_COUNT_SHEET_WEBHOOK_URL");
  const secret = Netlify.env.get("CASH_COUNT_SHEET_WEBHOOK_SECRET");
  if (!webhook || !secret) return new Response(JSON.stringify({ ok:false, error:"Missing sheet bridge configuration" }), { status:500, headers:{"content-type":"application/json"} });
  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ok:false,error:"Invalid JSON"}),{status:400,headers:{"content-type":"application/json"}}); }
  if (!body || !Array.isArray(body.rows)) return new Response(JSON.stringify({ok:false,error:"rows required"}),{status:400,headers:{"content-type":"application/json"}});
  const out = await sync(webhook, secret, { branch: String(body.branch || "Alphaland"), rows: body.rows });
  return new Response(JSON.stringify(out.result), { status: out.ok ? 200 : 502, headers:{"content-type":"application/json"} });
};

export const config = { path: "/__psulit-backfill-sheet-20261003-x7k9" };