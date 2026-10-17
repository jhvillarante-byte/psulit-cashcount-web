// Load open receivables and payables from the live branch cash log.
// Read-only: this function never writes to Google Sheets.
const { verifyToken, json, requirePost, parseBody } = require("./_auth");

const BRANCHES = ["Alphaland", "Solaire"];

async function askBridge(readerUrl, secret, branch, action = "openRecPayables") {
  const separator = readerUrl.includes("?") ? "&" : "?";
  const url = readerUrl + separator + "action=" + encodeURIComponent(action) +
    "&branch=" + encodeURIComponent(branch) + "&secret=" + encodeURIComponent(secret);
  try {
    const response = await fetch(url);
    const text = await response.text();
    let result = {};
    try { result = JSON.parse(text); } catch (_) { result = { raw: text.slice(0, 240) }; }
    return { ok: response.ok && result && result.ok === true, status: response.status, result };
  } catch (error) {
    return { ok: false, status: 0, result: { error: error instanceof Error ? error.message : String(error) } };
  }
}

function errorText(reply) {
  if (reply && reply.result && reply.result.error) return String(reply.result.error);
  if (reply && reply.result && reply.result.raw) return "Non-JSON response: " + String(reply.result.raw).slice(0, 180);
  if (reply && reply.status) return "HTTP " + reply.status;
  return "Reader request failed before returning a response.";
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
  if (!readerUrl || !secret) {
    return json(503, { ok: false, error: "The Audit Reader is not configured (AUDIT_READER_URL / AUDIT_READER_SECRET)." });
  }

  // Prefer the one-read combined action for consistent balances and less load.
  const combined = await askBridge(readerUrl, secret, branch, "openRecPayables");
  if (combined.ok) {
    const result = combined.result;
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

  // The deployed Apps Script version can lag behind code in the editor or may
  // reject the combined action. Always try the two documented read-only actions
  // before failing, rather than relying on the wording of the first error.
  const [rec, pay] = await Promise.all([
    askBridge(readerUrl, secret, branch, "openReceivables"),
    askBridge(readerUrl, secret, branch, "openPayables"),
  ]);

  if (rec.ok && pay.ok) {
    return json(200, {
      ok: true,
      branch,
      receivables: Array.isArray(rec.result.receivables) ? rec.result.receivables : [],
      receivableIssues: Array.isArray(rec.result.receivableIssues)
        ? rec.result.receivableIssues
        : (Array.isArray(rec.result.issues) ? rec.result.issues : []),
      payables: normalizePayables(pay.result.payables),
      payableIssues: Array.isArray(pay.result.payableIssues)
        ? pay.result.payableIssues
        : (Array.isArray(pay.result.issues) ? pay.result.issues : []),
      rowsRead: Math.max(Number(rec.result.rowsRead || 0), Number(pay.result.rowsRead || 0)),
    });
  }

  return json(502, {
    ok: false,
    error: "The live reader did not return both ledgers. Combined: " + errorText(combined) +
      " | Receivables action: " + errorText(rec) + " | Payables action: " + errorText(pay),
    diagnostic: "Check the Apps Script Web App version, script property AUDIT_READ_SECRET, and live sheet access.",
  });
};
