// Expected foreign-currency amounts for the count being entered: the branch's latest Cash Count (from the sheet, via the
// Audit Reader) plus the BUY/SELL transactions posted since. The app compares these with what the teller entered and
// asks them to check before sending when a currency does not match (e.g. a typed 6581 instead of 1 in one bill box).
// PHP is not checked here (expenses and transfers also move pesos). Read only; fails open (no warning) on any error.
const { verifyToken, json, requirePost, parseBody } = require("./_auth");

const num = (v) => { const x = Number(String(v == null ? "" : v).replace(/[^0-9.\-]/g, "")); return Number.isFinite(x) ? x : 0; };
// "11/25/2026, 19:02:11" | "11/25/2026 19:09:26" | "2026-11-25 19:02:11" -> "2026-11-25 19:02:11" (Manila time as written)
function stamp(v) {
  const s = String(v == null ? "" : v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")} ${m[4].padStart(2, "0")}:${m[5]}:${(m[6] || "00")}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4].padStart(2, "0")}:${m[5]}:${(m[6] || "00")}`;
  return "";
}
const field = (row, ...names) => { for (const n of names) if (row[n] !== undefined) return row[n]; return ""; };

exports.handler = async (event) => {
  const wrong = requirePost(event);
  if (wrong) return wrong;
  if (!verifyToken(event.headers.authorization || event.headers.Authorization)) return json(401, { ok: false, error: "Session expired. Please log in again." });
  const body = parseBody(event) || {};
  const branch = body.branch === "Alphaland" ? "Alphaland" : body.branch === "Solaire" ? "Solaire" : "";
  if (!branch) return json(400, { ok: false, error: "Unknown branch." });
  const readerUrl = process.env.AUDIT_READER_URL, secret = process.env.AUDIT_READER_SECRET;
  if (!readerUrl || !secret) return json(200, { ok: true, expected: null, warning: "Audit Reader not configured." });
  try {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
    const url = readerUrl + (readerUrl.includes("?") ? "&" : "?") + "branch=" + encodeURIComponent(branch) + "&date=" + today + "&auditRead=all&secret=" + encodeURIComponent(secret);
    const out = JSON.parse(await (await fetch(url, { signal: AbortSignal.timeout(20000) })).text());
    if (!out || out.ok !== true || !out.sheets) return json(200, { ok: true, expected: null, warning: String((out && out.error) || "No answer from reader.") });
    const counts = (out.sheets[branch + " Cash Count"] || {}).rows || [];
    const txs = (out.sheets[branch + " Transactions"] || {}).rows || [];
    // latest count = the reference with the latest Submitted At
    let last = null;
    for (const r of counts) {
      const at = stamp(field(r, "Submitted At")), ref = String(field(r, "Reference") || "").trim();
      if (!at || !ref) continue;
      if (!last || at > last.at) last = { at, ref, teller: String(field(r, "Teller") || ""), type: String(field(r, "Count Type") || ""), shift: String(field(r, "Shift") || "") };
    }
    if (!last) return json(200, { ok: true, expected: null, warning: "No earlier count found." });
    const base = {};
    for (const r of counts) {
      if (String(field(r, "Reference")).trim() !== last.ref) continue;
      if (String(field(r, "Category")).trim() !== "Forex Cash") continue;
      const cur = String(field(r, "Currency")).trim().toUpperCase();
      if (!cur || cur === "PHP") continue;
      base[cur] = (base[cur] || 0) + num(field(r, "Amount"));
    }
    const expected = { ...base }, moved = {};
    for (const t of txs) {
      const at = stamp(field(t, "Official Timestamp"));
      if (!at || at <= last.at) continue;
      if (/void/i.test(String(field(t, "Status") || ""))) continue;
      const cur = String(field(t, "Currency")).trim().toUpperCase(), type = String(field(t, "Transaction Type")).trim().toUpperCase();
      if (!cur || cur === "PHP") continue;
      const amt = num(field(t, "Foreign Amount")), sign = type === "BUY" ? 1 : type === "SELL" ? -1 : 0;
      if (!sign) continue;
      expected[cur] = (expected[cur] || 0) + sign * amt;
      moved[cur] = (moved[cur] || 0) + sign * amt;
    }
    return json(200, { ok: true, last, base, moved, expected });
  } catch (e) {
    return json(200, { ok: true, expected: null, warning: e instanceof Error ? e.message : String(e) });
  }
};
