// Compares an Opening count (the report text the app is about to submit) with the branch's last Closing count.
// Never returns the closing amounts: the teller only learns WHICH items differ, so a recount is a real recount.
const { verifyToken, json, requirePost, parseBody } = require("./_auth");

const CHECKED = new Set(["Forex Cash", "Fund Balance", "Wallet Balance", "Scratch Physical Inventory"]);
const labelOf = (row) => {
  if (row.category === "Forex Cash") return `Forex ${row.currency || ""}`.trim();
  if (row.category === "Fund Balance") return `${row.fundAccount || row.fund} ${row.currency || ""}`.trim();
  if (row.category === "Wallet Balance") return String(row.fundAccount || row.fund || "Wallet");
  if (row.category === "Scratch Physical Inventory") return `${row.fundAccount || row.fund} cards`;
  return String(row.fundAccount || row.fund || row.category);
};
const num = (v) => { const n = Number(String(v === undefined || v === null ? "" : v).replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) && String(v).trim() !== "" ? n : null; };

exports.handler = async (event) => {
  const wrong = requirePost(event);
  if (wrong) return wrong;
  if (!verifyToken(event.headers.authorization || event.headers.Authorization)) return json(401, { ok: false, error: "Session expired. Please log in again." });
  const body = parseBody(event) || {};
  const branch = body.branch === "Alphaland" ? "Alphaland" : body.branch === "Solaire" ? "Solaire" : "";
  if (!branch || !body.report) return json(400, { ok: false, error: "Missing branch or report." });
  const readerUrl = process.env.AUDIT_READER_URL, secret = process.env.AUDIT_READER_SECRET;
  if (!readerUrl || !secret) return json(200, { ok: true, checked: false, mismatches: [] });
  try {
    const url = readerUrl + (readerUrl.includes("?") ? "&" : "?") + "action=lastCountRows&branch=" + encodeURIComponent(branch) + "&secret=" + encodeURIComponent(secret);
    const out = JSON.parse(await (await fetch(url)).text());
    if (!out || out.ok !== true || !out.last || out.last.countType !== "Closing" || !Array.isArray(out.rows)) return json(200, { ok: true, checked: false, mismatches: [] });
    const { buildCashCountRows } = require("./send-report-live");   // loaded only when needed; any failure lets the teller through
    const mine = buildCashCountRows(String(body.report), branch).filter(r => CHECKED.has(r.category));
    const theirs = new Map(out.rows.filter(r => CHECKED.has(r.category)).map(r => [r.key, r]));
    const mismatches = [];
    for (const row of mine) {
      const prev = theirs.get(row.syncKey.split(":").slice(1).join(":"));
      if (!prev) continue;   // not counted last time (or a different set of items): nothing to compare
      const isQty = row.category === "Scratch Physical Inventory";
      const a = num(isQty ? row.quantityUnits : row.amount), b = num(isQty ? prev.qty : prev.amount);
      if (a === null || b === null) continue;
      if (Math.abs(a - b) > 0.005) mismatches.push(labelOf(row));
    }
    return json(200, { ok: true, checked: true, mismatches: [...new Set(mismatches)], closedBy: out.last.teller, closedAt: out.last.submittedAt });
  } catch (e) {
    return json(200, { ok: true, checked: false, mismatches: [], warning: e instanceof Error ? e.message : String(e) });
  }
};
