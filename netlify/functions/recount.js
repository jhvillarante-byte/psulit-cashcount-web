// Handover RECOUNT: opened from the "Tap here to recount" button of a HANDOVER MISMATCH message.
// action "info":   which items of the Opening differ from the last Closing (names only, never amounts).
// action "submit": saves the recounted figures as extra lines of the same Opening ("<ref>:RECOUNT-<line>", which the
//                  audit uses in place of the first count), posts "CASH COUNT – OPENING (RECOUNT)" and the result.
// Only one recount per Opening, and only by the teller who submitted that Opening.
const { verifyToken, json, requirePost, parseBody } = require("./_auth");
const L = require("./send-report-live");

const phNow = () => {
  const d = new Date(Date.now() + 8 * 3600e3), p = x => String(x).padStart(2, "0");
  return { stamp: `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}/${d.getUTCFullYear()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`,
           short: `${d.getUTCHours() % 12 || 12}:${p(d.getUTCMinutes())} ${d.getUTCHours() < 12 ? "AM" : "PM"}`, ymd: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` };
};
const ymdOf = (v, fallback) => {
  const s = String(v || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const d = new Date(s); if (!isNaN(d)) { const x = new Date(d.getTime() + 8 * 3600e3); return x.toISOString().slice(0, 10); }
  return fallback;
};

async function load(branch, ref, teller) {
  const orig = await L.readerRows(branch, { ref });
  if (!orig || orig.ok !== true || !orig.last || !Array.isArray(orig.rows) || !orig.rows.length) return { error: "That count could not be found. Please try again in a minute." };
  if (orig.last.countType !== "Opening") return { error: "Only an Opening count can be recounted here." };
  if (String(orig.last.teller || "").trim().toLowerCase() !== String(teller || "").trim().toLowerCase()) return { error: `Only ${orig.last.teller || "the teller who submitted this Opening"} can recount it.` };
  if (orig.rows.some(r => /^RECOUNT-/i.test(String(r.key || "")))) return { error: "This Opening was already recounted. No second recount." };
  const closing = await L.readerRows(branch, { type: "Closing", excludeRef: ref, beforeAt: orig.last.submittedAt });
  if (!closing || closing.ok !== true || !closing.last || !Array.isArray(closing.rows)) return { error: "The last Closing could not be read. Please try again in a minute." };
  const diffs = L.compareWithClosing(orig.rows, closing.rows);
  const items = diffs.map(d => { const r = orig.rows.find(x => x.key === d.key) || {}; return { key: d.key, label: d.label, category: r.category, currency: r.currency, fund: r.fund }; });
  return { orig, closing, items };
}

exports.handler = async (event) => {
  const wrong = requirePost(event);
  if (wrong) return wrong;
  const session = verifyToken(event.headers.authorization || event.headers.Authorization);
  if (!session) return json(401, { ok: false, error: "Session expired. Please log in again." });
  const body = parseBody(event) || {};
  const branch = body.branch === "Alphaland" ? "Alphaland" : body.branch === "Solaire" ? "Solaire" : "";
  const ref = String(body.ref || "").trim();
  if (!branch || !/^[A-Z0-9-]{6,40}$/i.test(ref)) return json(400, { ok: false, error: "This recount link is not valid." });
  try {
    const st = await load(branch, ref, session.teller);
    if (st.error) return json(200, { ok: false, error: st.error });
    if (!st.items.length) return json(200, { ok: false, error: "This Opening already matches the last Closing. Nothing to recount." });
    if (body.action !== "submit") return json(200, { ok: true, teller: st.orig.last.teller, submittedAt: st.orig.last.submittedAt, items: st.items });

    // ---- submit ----
    const values = body.values && typeof body.values === "object" ? body.values : {};
    const now = phNow(), info = st.orig.last;
    const sheetRows = [], mine = [], shown = [];
    for (const it of st.items) {
      const v = L.numOrNull(values[it.key]);
      if (v === null || v < 0) return json(200, { ok: false, error: `Enter the recount for ${it.label}.` });
      const qty = it.category === "Scratch Physical Inventory";
      const first = st.orig.rows.find(r => r.key === it.key) || {};
      const firstVal = L.numOrNull(qty ? first.qty : first.amount);
      sheetRows.push({
        syncKey: `${ref}:RECOUNT-${it.key}`, submittedAt: info.submittedAt, businessDate: ymdOf(info.businessDate, now.ymd), branch,
        countType: "Opening", shift: info.shift, teller: info.teller, reference: ref, sourceApp: "Cash Count App (Recount)",
        category: it.category, currency: it.currency || "", fundAccount: it.fund || "",
        amount: qty ? "" : v, phpEquivalent: qty ? "" : ((it.currency || "PHP") === "PHP" ? v : ""), quantityUnits: qty ? v : "",
        notes: `Handover recount ${now.stamp}${firstVal !== null ? `; first count ${L.fmtVal(firstVal, it.currency, qty)}` : ""}`,
      });
      mine.push({ key: it.key, category: it.category, currency: it.currency, fund: it.fund, amount: qty ? "" : v, qty: qty ? v : "" });
      shown.push(`${it.label}: ${L.fmtVal(v, it.currency, qty)}`);
    }
    const sync = await L.syncRows(branch, sheetRows);
    if (sync.status !== "synced") return json(200, { ok: false, error: "The recount could not be saved to the live sheet. Please try again." });

    const still = L.compareWithClosing(mine, st.closing.rows);
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = branch === "Alphaland" ? process.env.ALPHALAND_TELEGRAM_CHAT_ID : process.env.SOLAIRE_TELEGRAM_CHAT_ID;
    const threadId = branch === "Alphaland" ? process.env.ALPHALAND_CASH_COUNT_TOPIC_ID : process.env.SOLAIRE_CASH_COUNT_TOPIC_ID;
    const msg = [`🔁 CASH COUNT – OPENING (RECOUNT) — ${branch.toUpperCase()}`,
      `Teller: ${info.teller} · Ref: ${ref}`, `Recounted at ${now.short}`, ``, ...shown, ``,
      still.length ? [`⚠️ Still does not match the last closing after the recount:`, ...still.map(d => d.line), ``, `${st.closing.last.teller || "Closing teller"} (closing) and ${info.teller} (opening), please both explain.`].join("\n")
                   : `✅ Handover OK after the recount.`].join("\n");
    if (token && chatId && threadId) await L.tgSend(token, { chat_id: chatId, message_thread_id: Number(threadId), text: msg.slice(0, 4000) }).catch(() => null);
    return json(200, { ok: true, matched: !still.length, still: still.map(d => d.label) });
  } catch (e) {
    return json(200, { ok: false, error: "Could not reach the server. Please try again." });
  }
};
