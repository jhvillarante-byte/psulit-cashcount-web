// Current bank balances for a branch (read-only), plus whether this teller may change them.
// Only the bank-uploader (default: Jazelle) edits bank balances; every other teller's count carries them forward automatically.
const { verifyToken, json, requirePost, parseBody } = require("./_auth");

const BRANCHES = ["Alphaland", "Solaire"];

function uploaderNames() {
  return String(process.env.BANK_UPLOADER_NAMES || "jazelle").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
}
function isUploader(name) {
  const n = String(name || "").toLowerCase();
  return uploaderNames().some(u => n.includes(u));
}

// Monday of the current week in Philippine time (YYYY-MM-DD). The weekly bank proof is due on Jazelle's first count of each week.
function weekStartPH() {
  const ph = new Date(Date.now() + 8 * 3600 * 1000); // shift to UTC+8, then read UTC fields
  const dow = (ph.getUTCDay() + 6) % 7; // Mon=0
  const mon = new Date(Date.UTC(ph.getUTCFullYear(), ph.getUTCMonth(), ph.getUTCDate() - dow));
  return mon.toISOString().slice(0, 10);
}

exports.isUploader = isUploader;
exports.handler = async (event) => {
  const wrong = requirePost(event);
  if (wrong) return wrong;
  const session = verifyToken(event.headers.authorization || event.headers.Authorization);
  if (!session) return json(401, { ok: false, error: "Session expired. Please log in again." });
  const body = parseBody(event);
  if (!body) return json(400, { ok: false, error: "Bad request." });
  const branch = BRANCHES.find(b => b.toLowerCase() === String(body.branch || "").trim().toLowerCase());
  if (!branch) return json(400, { ok: false, error: "Unknown branch." });

  const canEdit = isUploader(session.teller);
  const weekStart = weekStartPH();
  const readerUrl = process.env.AUDIT_READER_URL, secret = process.env.AUDIT_READER_SECRET;
  if (!readerUrl || !secret) return json(200, { ok: true, canEdit, weekStart, proofDone: false, balances: [], source: "none", warning: "Audit Reader not configured." });
  try {
    const url = readerUrl + (readerUrl.includes("?") ? "&" : "?") + "action=bankBalances&branch=" + encodeURIComponent(branch) + "&secret=" + encodeURIComponent(secret);
    const res = await fetch(url);
    const text = await res.text();
    let out = {}; try { out = JSON.parse(text); } catch (_) {}
    if (res.ok && out && out.ok === true && Array.isArray(out.balances)) return json(200, { ok: true, canEdit, weekStart, lastProof: out.lastProof || "", proofDone: !!out.lastProof && String(out.lastProof) >= weekStart, balances: out.balances, source: "sheet" });
    return json(200, { ok: true, canEdit, weekStart, proofDone: false, balances: [], source: "none", warning: String((out && out.error) || "Reader did not return bank balances.") });
  } catch (error) {
    return json(200, { ok: true, canEdit, weekStart, proofDone: false, balances: [], source: "none", warning: error instanceof Error ? error.message : String(error) });
  }
};
