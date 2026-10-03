import type { Config } from "@netlify/functions";

export default async () => {
  const url = process.env.CASH_COUNT_SHEET_WEBHOOK_URL;
  const secret = process.env.CASH_COUNT_WEBHOOK_SECRET;
  if (!url || !secret) return;

  for (const branch of ["Alphaland", "Solaire"]) {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: "CASH_COUNT_SYNC",
        branch,
        rows: [],
        secret,
      }),
    });
  }
};

export const config: Config = {
  schedule: "* * * * *",
};
