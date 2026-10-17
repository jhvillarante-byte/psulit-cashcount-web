// Combined open receivables + payables fetch. The read-only Apps Script reader
// supports the fast action "openRecPayables", which scans the branch cash log once
// and calculates both balances from the same sheet snapshot.
const { verifyToken, json, requirePost, parseBody } = require("./_auth");

const BRANCHES = ["Alphaland", "Solaire"];

async function askBridge(readerUrl, secret, branch) {
  const url = readerUrl + "?action=openRecPayables" +
    "&branch=" + encodeURIComponent(branch) + "&secret=" + encodeURIComponent(secret);
  const response = await fetch(url);
  const text = await response.text();
  let result = {};
  try { result = JSON.parse(text); } catch (_) { result = { raw: text.slice(0, 200) }; }
  return { response, result };
}

function normalizePayables(items) {
  const normalized = new Map();
  const canonicalParty = (value) => {
    const key = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    if (["hive", "mb", "moneybees", "mbhive"].includes(key)) return "Hive";
    return String(value || "").trim();
  };
  for (const item of (Array.isArray(items) ? items : [])) {
    const name = canonicalParty(item && item.name);
    if (!name) continue;
    const key = name.toLowerCase();
    const existing = normalized.get(key);
    if (existing) {
      existing.amount = Number(existing.amount || 0) + Number(item.amount || 0);
      existing.lastActivity = [existing.lastActivity, item.lastActivity].filter(Boolean).sort().pop() || "";
    } else {
      normalized.set(key, { ...item, name, amount: Number(item.amount || 0) });
    }
  }
  return Array.from(normalized.values()).sort((a, b) => a.name.localeCompare(b.name));
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

  try {
    const { response, result } = await askBridge(readerUrl, secret, branch);
    if (response.ok && result && result.ok === true) {
      return json(200, {
        ok: true,
        branch,
        receivables: Array.isArray(result.receivables) ? result.receivables : [],
        receivableIssues: Array.isArray(result.receivableIssues) ? result.receivableIssues : [],
        payables: normalizePayables(result.payables),
        payableIssues: Array.isArray(result.payableIssues) ? result.payableIssues : [],
        rowsRead: Number(result.rowsRead || 0),
      });
    }
    const detail = String((result && result.error) || ("Live-sheet bridge failed (" + response.status + ")."));
    return json(502, {
      ok: false,
      error: detail,
      diagnostic: "The Apps Script /exec deployment must recognize action=openRecPayables. Publish the combined Audit Reader as a new Web App version.",
    });
  } catch (error) {
    return json(502, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
