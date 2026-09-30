export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST required" }), {
      status: 405,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  try {
    const body = await req.text();
    const upstream = await fetch(
      "https://ivfpgshtknelingsvbfi.supabase.co/functions/v1/ctr-alert-app",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      },
    );
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { "content-type": "application/json", "cache-control": "no-store" } },
    );
  }
};
