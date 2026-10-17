const { verifyToken, json, requirePost, parseBody } = require("./_auth");

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

exports.handler = async (event) => {
  const wrongMethod = requirePost(event);
  if (wrongMethod) return wrongMethod;

  const session = verifyToken(event.headers.authorization || event.headers.Authorization);
  if (!session) return json(401, { ok: false, error: "Session expired. Please log in again." });
  if (session.teller !== "Jen Villarante") {
    return json(403, { ok: false, error: "Owner access required." });
  }

  const body = parseBody(event);
  if (!body) return json(400, { ok: false, error: "Invalid request." });

  const imageBase64 = String(body.imageBase64 || "").replace(/^data:image\/(?:png|jpeg|jpg);base64,/i, "");
  if (!imageBase64 || !/^[A-Za-z0-9+/=]+$/.test(imageBase64)) {
    return json(400, { ok: false, error: "Choose a valid PNG or JPG image first." });
  }

  let image;
  try { image = Buffer.from(imageBase64, "base64"); }
  catch (_) { return json(400, { ok: false, error: "The image could not be decoded." }); }
  if (!image.length || image.length > MAX_IMAGE_BYTES) {
    return json(413, { ok: false, error: "Image must be smaller than 2 MB." });
  }

  const isPng = image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const isJpeg = image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
  if (!isPng && !isJpeg) return json(400, { ok: false, error: "Only PNG and JPG images are accepted." });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.SOLAIRE_TELEGRAM_CHAT_ID || "-1003922155338";
  const threadId = process.env.SOLAIRE_CASH_COUNT_TOPIC_ID || "13";
  if (!token || !chatId || !threadId) {
    return json(500, { ok: false, error: "Solaire Cash Count Telegram destination is not configured." });
  }

  const mime = isPng ? "image/png" : "image/jpeg";
  const filename = isPng ? "angelica-solaire-cash-count-corrected.png" : "angelica-solaire-cash-count-corrected.jpg";
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("message_thread_id", String(threadId));
  form.append("caption", "Corrected Cash Count — Solaire\nTeller: Angelica Besid\nRef: PSC-MURG045X-6356\nDuplicate GBP row removed. Image only; no cash-count records or Google Sheets changed.");
  form.append("photo", new Blob([image], { type: mime }), filename);

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: "POST",
      body: form,
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      console.error("Corrected Cash Count image send rejected:", result.description || response.status);
      return json(502, { ok: false, error: result.description || "Telegram rejected the image." });
    }
    return json(200, {
      ok: true,
      telegram_sent: true,
      branch: "Solaire",
      topic_id: Number(threadId),
      telegram_message_id: result.result && result.result.message_id,
      sheet_saved: false,
    });
  } catch (error) {
    console.error("Corrected Cash Count image send failed:", error);
    return json(502, { ok: false, error: "Could not reach Telegram. Please retry once." });
  }
};
