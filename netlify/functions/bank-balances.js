// Current bank balances for a branch (read-only), plus whether this teller may change them.
// Only the bank-uploader (default: Jazelle) edits bank balances; every other teller's count carries them forward automatically.
const crypto = require("crypto");
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

function addDays(ymd, n) { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function todayPH() { return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); }
// The weekly bank proof is due on a RANDOM weekday each week (Mon-Fri; Jazelle is off on weekends), picked from a secret so nobody can predict it.
// It then shows on the uploader's next count (that day or later) until the proof is posted. If a whole week passed
// with no proof, it is due immediately.
function proofDueDay(weekStart) {
  const key = process.env.SESSION_SECRET || "psulit";
  const h = crypto.createHmac("sha256", key).update("bank-proof-day:" + weekStart).digest();
  return addDays(weekStart, h[0] % 5); // Mon..Fri only
}
function proofIsDue(weekStart, lastProof) {
  const last = String(lastProof || "");
  if (last && last >= weekStart) return false;                 // already posted this week
  const prevStart = addDays(weekStart, -7);
  if (!last || last < prevStart) return true;                  // nothing posted last week either: due now
  return todayPH() >= proofDueDay(weekStart);                  // otherwise only from this week's random day
}

exports.isUploader = isUploader;
exports.handler = async (event) => {
  const wrong = requirePost(event);
  if (wrong) return wrong;
  const session = verifyToken(event.headers.authorization || event.headers.Authorization);
  if (!session) return json(401, { ok: false, error: "Session expired. Please log in again." });
  const body = parseBody(event);
  if (!body) return json(400, { ok: false, error: "Bad request." });
  // The bank accounts belong to Solaire only, whichever branch the count is for.
  const branch = "Solaire";

  const canEdit = isUploader(session.teller);
  const weekStart = weekStartPH();
  const readerUrl = process.env.AUDIT_READER_URL, secret = process.env.AUDIT_READER_SECRET;
  if (!readerUrl || !secret) return json(200, { ok: true, canEdit, bankBranch: branch, weekStart, proofDone: false, balances: [], source: "none", warning: "Audit Reader not configured." });
  try {
    const url = readerUrl + (readerUrl.includes("?") ? "&" : "?") + "action=bankBalances&branch=" + encodeURIComponent(branch) + "&secret=" + encodeURIComponent(secret);
    const res = await fetch(url);
    const text = await res.text();
    let out = {}; try { out = JSON.parse(text); } catch (_) {}
    if (res.ok && out && out.ok === true && Array.isArray(out.balances)) return json(200, { ok: true, canEdit, bankBranch: branch, weekStart, proofDone: !proofIsDue(weekStart, out.lastProof), balances: out.balances, source: "sheet" });
    return json(200, { ok: true, canEdit, bankBranch: branch, weekStart, proofDone: false, balances: [], source: "none", warning: String((out && out.error) || "Reader did not return bank balances.") });
  } catch (error) {
    return json(200, { ok: true, canEdit, bankBranch: branch, weekStart, proofDone: false, balances: [], source: "none", warning: error instanceof Error ? error.message : String(error) });
  }
};
