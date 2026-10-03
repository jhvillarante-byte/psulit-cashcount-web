export default async (req: Request) => {
  const url = process.env.CASH_COUNT_SHEET_WEBHOOK_URL;
  const secret = process.env.CASH_COUNT_WEBHOOK_SECRET;
  const provided = new URL(req.url).searchParams.get("secret");

  if (!url || !secret) {
    return new Response("Bridge is not configured.", { status: 500 });
  }
  if (!provided || provided !== secret) {
    return new Response("Unauthorized.", { status: 401 });
  }

  const results = {};
  for (const branch of ["Alphaland", "Solaire"]) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: "CASH_COUNT_SYNC",
        branch,
        rows: [],
        secret,
      }),
    });
    const body = await response.text();
    results[branch] = { status: response.status, body };
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { "Content-Type": "application/json" },
  });
};

export const config = { path: "/__recolor-cashcount" };
