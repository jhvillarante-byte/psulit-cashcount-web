exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'POST required' }) };
  }
  try {
    const imageResponse = await fetch('https://psulit-cashcount.netlify.app/.netlify/functions/audit-sample-image');
    if (!imageResponse.ok) throw new Error(`Image render failed (${imageResponse.status})`);
    const bytes = Buffer.from(await imageResponse.arrayBuffer());
    const photoBase64 = bytes.toString('base64');

    const sendResponse = await fetch('https://ivfpgshtknelingsvbfi.supabase.co/functions/v1/psulit-telegram-audit-sender', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        branch: 'Alphaland',
        business_date: '2026-09-28-sample-image',
        text: 'Alphaland Daily Audit — September 28, 2026',
        photo_base64: photoBase64,
        mime_type: 'image/png',
        filename: 'alphaland-daily-audit-2026-09-28.png'
      })
    });
    const result = await sendResponse.json().catch(() => ({}));
    return {
      statusCode: sendResponse.ok ? 200 : 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: error.message || String(error) }) };
  }
};
