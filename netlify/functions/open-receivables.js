// Open receivables for one branch, read from the live sheet's "Expense & Cash Movement"
// log through the same Apps Script bridge the Cash Count already uses to save counts.
// A receivable stays in the list until a payment for it is recorded in that log.
const { verifyToken, json, requirePost, parseBody } = require("./_auth");

const BRANCHES = ["Alphaland", "Solaire"];

// Uses the PSULIT Audit Reader (doGet, action=openReceivables).
// The Cash Count site needs AUDIT_READER_URL and AUDIT_READER_SECRET in its env vars —
// copy the values from the Audit site's AUDIT_READ_SECRET and its Apps Script web app URL.
async function askBridge(readerUrl, secret, branch) {
  const url = `${readerUrl}?action=openReceivables&branch=${encodeURIComponent(branch)}&secret=${encodeURIComponent(secret)}`;
  const response = await fetch(url);
  const text = await response.text();
  let result = {};
  try { result = JSON.parse(text); } catch (_) { result = { raw: text.slice(0, 200) }; }
  return { response, result };
}

exports.handler = async (event) => {
  const wrongMethod = requirePost(event);
  if (wrongMethod) return wrongMethod;

  const session = verifyToken(event.headers.authorization || event.headers.Authorization);
  if (!session) return json(401, { ok: false, error: "Session expired. Please log in again." });

  const body = parseBody(event);
  if (!body) return json(400, { ok: false, error: "Bad request." });

  const branch = BRANCHES.find(b => b.toLowerCase() === String(body.branch || "").trim().toLowerCase());
  if (!branch) return json(400, { ok: false, error: "Unknown branch." });
  if (Array.isArray(session.branches) && session.branches.length && !session.branches.includes(branch)) {
    return json(403, { ok: false, error: "You are not signed in for this branch." });
  }

  const readerUrl = process.env.AUDIT_READER_URL;
  const secret = process.env.AUDIT_READER_SECRET;
  if (!readerUrl || !secret) return json(503, { ok: false, error: "The Audit Reader is not configured (AUDIT_READER_URL / AUDIT_READER_SECRET)." });

  let lastError = "Could not read receivables from the Audit Reader.";
  for (const _once of [1]) {
    try {
      const { response, result } = await askBridge(readerUrl, secret, branch);
      if (response.ok && result && result.ok === true) {
        return json(200, {
          ok: true,
          branch,
          receivables: Array.isArray(result.receivables) ? result.receivables : [],
          issues: Array.isArray(result.issues) ? result.issues : [],
          rowsRead: Number(result.rowsRead || 0),
        });
      }
      lastError = String((result && result.error) || `Live-sheet bridge failed (${response.status}).`);
      // "Unsupported event type." means the Apps Script has not been updated yet.
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return json(502, { ok: false, error: lastError });
};
