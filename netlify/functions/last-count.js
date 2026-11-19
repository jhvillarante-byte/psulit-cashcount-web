// Latest Opening/Closing count for a branch (read from the sheet via the Audit Reader). Used to stop a second Opening in a row.
const { verifyToken, json, requirePost, parseBody } = require("./_auth");
exports.handler = async (event) => {
  const wrong = requirePost(event);
  if (wrong) return wrong;
  if (!verifyToken(event.headers.authorization || event.headers.Authorization)) return json(401, { ok: false, error: "Session expired. Please log in again." });
  const body = parseBody(event) || {};
  const branch = body.branch === "Alphaland" ? "Alphaland" : body.branch === "Solaire" ? "Solaire" : "";
  if (!branch) return json(400, { ok: false, error: "Unknown branch." });
  const readerUrl = process.env.AUDIT_READER_URL, secret = process.env.AUDIT_READER_SECRET;
  if (!readerUrl || !secret) return json(200, { ok: true, last: null, warning: "Audit Reader not configured." });
  try {
    const url = readerUrl + (readerUrl.includes("?") ? "&" : "?") + "action=lastCount&branch=" + encodeURIComponent(branch) + "&secret=" + encodeURIComponent(secret);
    const res = await fetch(url);
    const out = JSON.parse(await res.text());
    if (out && out.ok === true) return json(200, { ok: true, last: out.last || null });
    return json(200, { ok: true, last: null, warning: String((out && out.error) || "No answer from reader.") });
  } catch (e) {
    return json(200, { ok: true, last: null, warning: e instanceof Error ? e.message : String(e) });
  }
};
