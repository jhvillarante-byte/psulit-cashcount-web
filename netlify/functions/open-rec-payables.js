// Fetch both open ledgers via the individual read-only Apps Script actions.
// The Audit Reader supports openReceivables and openPayables. The invented combined
// action "openRecPayables" falls through to date-range validation and causes an invalid-date error.
const { verifyToken, json, requirePost, parseBody } = require("./_auth");

const BRANCHES = ["Alphaland", "Solaire"];

async function askBridge(readerUrl, secret, branch, action) {
  const url = readerUrl + "?action=" + encodeURIComponent(action) +
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

function bridgeError(label, result, response) {
  return label + ": " + String((result && result.error) || ("Live-sheet bridge failed (" + response.status + ")."));
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
    const results = await Promise.all([
      askBridge(readerUrl, secret, branch, "openReceivables"),
      askBridge(readerUrl, secret, branch, "openPayables"),
    ]);
    const rec = results[0];
    const pay = results[1];

    if (!rec.response.ok || !rec.result || rec.result.ok !== true) {
      return json(502, { ok: false, error: bridgeError("Receivables reader", rec.result, rec.response) });
    }
    if (!pay.response.ok || !pay.result || pay.result.ok !== true) {
      return json(502, { ok: false, error: bridgeError("Payables reader", pay.result, pay.response) });
    }

    return json(200, {
      ok: true,
      branch,
      receivables: Array.isArray(rec.result.receivables) ? rec.result.receivables : [],
      receivableIssues: Array.isArray(rec.result.issues) ? rec.result.issues : Array.isArray(rec.result.receivableIssues) ? rec.result.receivableIssues : [],
      payables: normalizePayables(pay.result.payables),
      payableIssues: Array.isArray(pay.result.issues) ? pay.result.issues : Array.isArray(pay.result.payableIssues) ? pay.result.payableIssues : [],
      rowsRead: Math.max(Number(rec.result.rowsRead || 0), Number(pay.result.rowsRead || 0)),
    });
  } catch (error) {
    return json(502, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
