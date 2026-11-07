import { getStore } from "@netlify/blobs";
import { getDatabase } from "@netlify/database";

type Row = Record<string, any>;
const types = new Set(["application/pdf", "image/jpeg", "image/png"]);
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
const env = (key: string) => Netlify.env.get(key);
const route = (req: Request) => new URL(req.url).pathname.replace(/^\/\.netlify\/functions\/api/, "/api").replace(/\/+$/, "");
const value = (form: FormData, key: string) => typeof form.get(key) === "string" ? String(form.get(key)).trim() : "";
const num = (text: string) => text && Number.isFinite(Number(text.replaceAll(",", ""))) ? Number(text.replaceAll(",", "")) : null;


const OPERATIONS_SPREADSHEET_ID = "1_msQClr0yfx_jTKeEfop6lnfNvBPd-sNNMkgLnBgsrU";

async function syncExpenseSheet(row: Row) {
  const webhookUrl = env("EXPENSE_SHEET_WEBHOOK_URL");
  const secret = env("EXPENSE_SHEET_WEBHOOK_SECRET");
  if (!webhookUrl || !secret) return { status: "not_configured" };

  const branch = String(row.branch || "").trim();
  const sheetName = branch.toLowerCase() === "alphaland"
    ? "Alphaland Expense & Cash Movement"
    : branch.toLowerCase() === "solaire"
      ? "Solaire Expense & Cash Movement"
      : "";
  if (!sheetName) return { status: "failed", error: "Unknown branch" };

  const payload = {
    eventType: "EXPENSE_CASH_MOVEMENT_SYNC",
    spreadsheetId: OPERATIONS_SPREADSHEET_ID,
    sheetName,
    secret,
    row: {
      syncKey: String(row.expense_id || ""),
      createdAt: row.created_at || "",
      officialDate: row.expense_date || "",
      branch,
      recordId: row.expense_id || "",
      postedBy: row.posted_by || "",
      category: row.category || "",
      otherCategory: row.other_category || "",
      description: row.description || "",
      amountPhp: Number(row.amount_centavos || 0) > 0 ? Number(row.amount_centavos) / 100 : null,
      fundDrawer: row.fund_drawer_used || "",
      assetType: row.asset_type || "",
      actualCurrency: row.actual_currency || "",
      actualAmount: row.actual_amount ?? "",
      borrowerCompany: row.borrower_company || "",
      valuationRate: row.valuation_rate ?? "",
      destinationFund: row.destination_fund || "",
      transferReference: row.transfer_reference || "",
      receivedAssetType: row.received_asset_type || "",
      receivedCurrency: row.received_currency || "",
      receivedAmount: row.received_amount ?? "",
      sourceBranch: row.source_branch || "",
      destinationBranch: row.destination_branch || "",
      settlementMethod: row.settlement_method || "",
      receivableReference: row.receivable_reference || "",
      settlementType: row.settlement_type || "",
      settlementParentExpenseId: row.settlement_parent_expense_id || "",
      settlementReference: row.settlement_reference || row.receivable_reference || "",
      settlementOriginalAmount: row.settlement_original_amount_centavos == null ? null : Number(row.settlement_original_amount_centavos) / 100,
      settlementPreviousPaid: Number(row.settlement_previous_paid_centavos || 0) / 100,
      settlementRemaining: row.settlement_remaining_centavos == null ? null : Number(row.settlement_remaining_centavos) / 100,
      settlementStatus: row.settlement_status || "",
      hiveTransactionReference: row.hive_transaction_reference || "",
      lottoMovementType: row.lotto_movement_type || "",
      lottoSourceWallet: row.lotto_source_wallet || "",
      lottoTicketNumber: row.lotto_ticket_number || "",
      lottoClaimantName: row.lotto_claimant_name || "",
      supportingDocumentName: row.supporting_document_name || "",
      telegramStatus: row.slack_status || "",
      telegramLink: row.slack_permalink || "",
      sourceApp: "PSulit Expense / Cash Movement App"
    }
  };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    let data: Row = {};
    try { data = JSON.parse(text) as Row; } catch { data = { raw: text.slice(0, 200) }; }
    if (!response.ok || data.ok !== true) throw new Error(String(data.error || `Google Sheets webhook failed (${response.status})`));
    return { status: "synced", action: data.action || "upserted" };
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 500) : "Google Sheets sync failed";
    console.error("Expense Google Sheets sync failed", detail);
    return { status: "failed", error: detail };
  }
}

function today() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function employees(): Record<string, string> | null {
  try {
    // Cash Log historically used EMPLOYEE_PINS (PIN -> employee name).
    // The shared Cash Count login configuration is TELLER_PINS_JSON
    // (PIN -> { name, branches }); accept either format so both entry points
    // use the same existing employee PIN records.
    const raw = env("EMPLOYEE_PINS") || env("TELLER_PINS_JSON") || "null";
    const data = JSON.parse(raw);
    if (!data || Array.isArray(data) || typeof data !== "object") return null;

    const normalized: Record<string, string> = {};
    for (const [pin, entry] of Object.entries(data)) {
      if (!/^\d+$/.test(pin)) return null;
      const name = typeof entry === "string"
        ? entry
        : entry && typeof entry === "object" && "name" in entry
          ? String((entry as Row).name || "")
          : "";
      if (!name.trim()) return null;
      normalized[pin] = name.trim();
    }
    return Object.keys(normalized).length ? normalized : null;
  } catch { return null; }
}

async function telegramRequest(method: string, body: Row) {
  const token = env("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("Telegram is not configured");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json() as Row;
  if (!response.ok || !data.ok) throw new Error(String(data.description || `Telegram ${method} failed`));
  return data.result as Row;
}

function escapeHtml(input: unknown) {
  return String(input ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function displayDateTime(input: unknown) {
  const date = input instanceof Date ? input : new Date(String(input));
  if (Number.isNaN(date.getTime())) return String(input ?? "");
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  }).format(date);
}

async function sendTelegram(row: Row) {
  const branch = String(row.branch).toLowerCase();
  const chatId = branch === "solaire"
    ? env("TELEGRAM_SOLAIRE_CHAT_ID")
    : branch === "alphaland"
      ? env("TELEGRAM_ALPHALAND_CHAT_ID")
      : undefined;
  // Route expense/cash-movement posts only to the dedicated branch expense topics.
  // Telegram topic IDs are stable within each branch supergroup.
  const topicId = branch === "solaire"
    ? "17"
    : branch === "alphaland"
      ? "3"
      : undefined;
  const token = env("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("Telegram is not configured");
  if (!chatId) throw new Error("No Telegram chat is configured for this branch");
  if (!topicId || !/^\d+$/.test(topicId)) throw new Error("No Telegram Expense & Cash Movement topic is configured for this branch");
  if (!row.supporting_document_key) throw new Error("Supporting document not found");

  const document = await getStore("expense-documents").get(String(row.supporting_document_key), { type: "blob" });
  if (!(document instanceof Blob)) throw new Error("Supporting document not found");

  const fmt2 = (n: number) => new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const pesoAmount = Number(row.amount_centavos) / 100;
  // A currency entry (e.g. 7,340 THB) shows its real currency, not "PHP".
  const ccy = String(row.actual_currency || "").trim().toUpperCase();
  const hasActualAmount = !!ccy && row.actual_amount != null && Number.isFinite(Number(row.actual_amount));
  const foreign = hasActualAmount && ccy !== "PHP";
  const unvaluedHive = ["Hive In", "Hive Out", "Hive Commission"].includes(String(row.category || "")) && hasActualAmount;
  const sameUnits = foreign && Math.abs(Number(row.actual_amount) - pesoAmount) < 0.005;   // amount stored in that currency's units
  const amount = (foreign || unvaluedHive) ? `${fmt2(Number(row.actual_amount))} ${ccy}` : `${fmt2(pesoAmount)} PHP`;
  // Who the money is owed by / to.
  const party = String(row.borrower_company || "").trim();
  const partyLabel = ({ "Receivable": "Borrowed by", "Payable": "Payable to", "Receivable Settlement": "Paid by", "Payable Settlement": "Paid to" } as Record<string, string>)[String(row.category)] || "Company";
  const title = String(row.category || "Cash Movement").toUpperCase();
  const lines = [
    `<b>${escapeHtml(title)}</b>`,
    `<b>Record ID:</b> ${escapeHtml(row.expense_id)}`,
    `<b>Category:</b> ${escapeHtml(`${row.category}${row.other_category ? ` — ${row.other_category}` : ""}`)}`,
    `<b>Amount:</b> ${escapeHtml(amount)}`
  ];
  if (foreign && !sameUnits) lines.push(`<b>Peso value:</b> ${escapeHtml(fmt2(pesoAmount))} PHP`);
  if (party) lines.push(`<b>${partyLabel}:</b> ${escapeHtml(party)}`);
  if (row.fund_drawer_used) lines.push(`<b>Fund:</b> ${escapeHtml(row.fund_drawer_used)}`);
  lines.push(`<b>Description:</b> ${escapeHtml(row.description)}`);
  if (row.transfer_reference) lines.push(`<b>Reference:</b> ${escapeHtml(row.transfer_reference)}`);
  if (row.settlement_type) {
    lines.push(`<b>Settlement:</b> ${escapeHtml(row.settlement_type)}`);
    if (row.settlement_reference) lines.push(`<b>Original reference:</b> ${escapeHtml(row.settlement_reference)}`);
    if (row.settlement_remaining_centavos != null) lines.push(`<b>Remaining balance:</b> ${escapeHtml(fmt2(Number(row.settlement_remaining_centavos) / 100))} ${foreign && sameUnits ? ccy : "PHP"}`);
  }
  lines.push(`<b>Posted by:</b> ${escapeHtml(row.posted_by)}`);
  if (row.created_at) lines.push(`<b>Posted at:</b> ${escapeHtml(displayDateTime(row.created_at))}`);
  const caption = lines.join("\n");

  const mime = String(row.supporting_document_type || document.type || "application/octet-stream").toLowerCase();
  const extension = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
  const filename = `${row.expense_id}.${extension}`;
  const method = mime === "application/pdf" ? "sendDocument" : "sendPhoto";
  const field = mime === "application/pdf" ? "document" : "photo";

  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("message_thread_id", topicId);
  form.set("parse_mode", "HTML");
  if (caption.length <= 1000) {
    form.set("caption", caption);
  } else {
    await telegramRequest("sendMessage", { chat_id: chatId, message_thread_id: Number(topicId), text: caption, parse_mode: "HTML" });
    form.set("caption", `Supporting document — ${row.expense_id}`);
  }
  form.set(field, document, filename);

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", body: form });
  const data = await response.json() as Row;
  if (!response.ok || !data.ok) throw new Error(String(data.description || `Telegram ${method} failed`));
  const result = data.result as Row;
  const messageId = String(result.message_id || "");
  const privateChatId = String(chatId).replace(/^-100/, "");
  const permalink = messageId ? `https://t.me/c/${privateChatId}/${topicId}/${messageId}` : null;
  return { channel: chatId, timestamp: messageId, permalink };
}

async function verify(req: Request) {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  let pin: unknown; try { pin = (await req.json() as Row).pin; } catch { return json({ error: "A PIN is required." }, 400); }
  if (typeof pin !== "string" || !/^\d{1,32}$/.test(pin)) return json({ error: "A valid PIN is required." }, 400);
  const list = employees();
  if (!list) return json({ error: "PIN verification is temporarily unavailable." }, 503);
  return list[pin] ? json({ name: list[pin] }) : json({ error: "Invalid PIN." }, 401);
}

async function create(req: Request) {
  const form = await req.formData(), worker = employees()?.[value(form, "pin")];
  if (!worker) return json({ error: "Verify your employee PIN again." }, 401);
  const branch = value(form, "branch"), category = value(form, "category"), description = value(form, "description"), amount = num(value(form, "amount"));
  const unvaluedHive = ["Hive In", "Hive Out", "Hive Commission"].includes(category) && Number(num(value(form, "actualAmount"))) > 0 && /^[A-Z]{3}$/.test(value(form, "actualCurrency"));
  const receipt = form.get("receipt");
  if (!branch || !category || !description || ((!Number.isFinite(amount) || amount <= 0) && !unvaluedHive)) return json({ error: "Required expense details are missing." }, 400);
  const storedAmount = unvaluedHive ? 0 : amount;
  if (!(receipt instanceof File) || !receipt.size || !types.has(receipt.type) || receipt.size > 10_485_760) return json({ error: "Upload a PDF, JPG, or PNG supporting document up to 10 MB." }, 400);
  const settlementCategory = category === "Receivable Settlement" || category === "Payable Settlement";
  const db = getDatabase();
  let settlementParent: Row | null = null;
  let settlementPreviousPaid = 0;
  let settlementRemaining: number | null = null;
  if (settlementCategory) {
    const parentRef = value(form, "settlementParentExpenseId") || value(form, "originalRecordId");
    const enteredReference = value(form, "receivableReference");
    if (!parentRef || !enteredReference) return json({ error: "Enter both the Original Record ID and Reference Number for the original receivable or payable." }, 400);
    const [candidate] = await db.sql`SELECT * FROM expenses WHERE branch=${branch} AND expense_id=${parentRef} LIMIT 1`;
    if (!candidate || !((category === "Receivable Settlement" && candidate.category === "Receivable") || (category === "Payable Settlement" && candidate.category === "Payable"))) return json({ error: "The Original Record ID was not found for this branch and settlement type." }, 400);
    const expectedReference = String(candidate.receivable_reference || candidate.transfer_reference || candidate.expense_id || "").trim();
    if (enteredReference !== expectedReference) return json({ error: "The Reference Number does not match the original receivable/payable record." }, 400);
    settlementParent = candidate;
    const settlementCategoryName = category === "Receivable Settlement" ? "Receivable Settlement" : "Payable Settlement";
    const [paid] = await db.sql`SELECT COALESCE(SUM(amount_centavos),0) AS total FROM expenses WHERE branch=${branch} AND category=${settlementCategoryName} AND (settlement_parent_expense_id=${candidate.expense_id} OR receivable_reference=${candidate.receivable_reference})`;
    settlementPreviousPaid = Number(paid?.total || 0);
    settlementRemaining = Number(candidate.amount_centavos || 0) - settlementPreviousPaid - Math.round(amount * 100);
    if (settlementRemaining < 0) return json({ error: `Settlement exceeds the remaining balance of ${(Math.max(0, Number(candidate.amount_centavos || 0) - settlementPreviousPaid) / 100).toFixed(2)} PHP.` }, 400);
  }
  const date = today(), id = `PS-${date.replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, blobKey = `expenses/${id}`;
  await getStore("expense-documents").set(blobKey, receipt);
  const f = (key: string) => value(form, key) || null;
  const originalAmount = settlementParent ? Number(settlementParent.amount_centavos || 0) : null;
  const settlementStatus = settlementCategory ? (settlementRemaining === 0 ? "SETTLED" : "PARTIALLY_SETTLED") : "OPEN";
  const [row] = await db.sql`INSERT INTO expenses (expense_id,expense_date,branch,posted_by,category,other_category,description,amount_centavos,fund_drawer_used,asset_type,actual_currency,actual_amount,borrower_company,valuation_rate,destination_fund,transfer_reference,received_asset_type,received_currency,received_amount,source_branch,destination_branch,settlement_method,receivable_reference,settlement_type,settlement_parent_expense_id,settlement_reference,settlement_original_amount_centavos,settlement_previous_paid_centavos,settlement_remaining_centavos,settlement_status,hive_transaction_reference,lotto_movement_type,lotto_source_wallet,lotto_ticket_number,lotto_claimant_name,supporting_document_key,supporting_document_name,supporting_document_type)
    VALUES (${id},${date},${branch},${worker},${category},${f("otherCategory")},${description},${Math.round(storedAmount*100)},${f("fundDrawerUsed")},${f("assetType")},${f("actualCurrency")},${num(value(form,"actualAmount"))},${f("borrowerCompany") || settlementParent?.borrower_company || null},${num(value(form,"valuationRate"))},${f("destinationFund")},${f("transferReference")},${f("receivedAssetType")},${f("receivedCurrency")},${num(value(form,"receivedAmount"))},${f("sourceBranch")},${f("destinationBranch")},${f("settlementMethod")},${f("receivableReference")},${settlementCategory ? category : null},${settlementParent?.expense_id || null},${settlementParent ? f("receivableReference") : null},${originalAmount},${settlementPreviousPaid},${settlementRemaining},${settlementStatus},${f("hiveTransactionReference")},${f("lottoMovementType")},${f("lottoSourceWallet")},${f("lottoTicketNumber")},${f("lottoClaimantName")},${blobKey},${receipt.name},${receipt.type}) RETURNING *`;

  let telegramStatus = "Failed";
  let telegramMessage = "Telegram posting failed.";
  try {
    const sent = await sendTelegram(row);
    await db.sql`UPDATE expenses SET slack_status='Posted',slack_channel=${sent.channel},slack_message_ts=${sent.timestamp},slack_permalink=${sent.permalink},slack_error=NULL WHERE expense_id=${id}`;
    telegramStatus = "Posted";
    telegramMessage = "posted to Telegram";
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 500) : "Telegram request failed";
    await db.sql`UPDATE expenses SET slack_status='Failed',slack_error=${detail} WHERE expense_id=${id}`;
  }

  const [savedRow] = await db.sql`SELECT * FROM expenses WHERE expense_id=${id}`;
  const sheetSync = await syncExpenseSheet(savedRow || row);
  const sheetStatus = sheetSync.status === "synced" ? "Posted" : sheetSync.status === "not_configured" ? "Not configured" : "Failed";

  let message = `Record saved; Telegram: ${telegramStatus}; Google Sheets: ${sheetStatus}.`;
  if (telegramStatus === "Failed") message += " Use Retry Telegram Post; do not submit the record again.";
  return json({ expenseId: id, slackStatus: telegramStatus, sheetStatus, sheetSync, message }, 201);
}

function publicRow(row: Row) {
  const out: Row = {};
  for (const [key, val] of Object.entries(row)) out[key.replace(/_([a-z])/g, (_, x) => x.toUpperCase())] = val;
  out.supportingDocumentAvailable = Boolean(row.supporting_document_key); delete out.supportingDocumentKey; delete out.slackError;
  return out;
}

async function list() {
  const rows = await getDatabase().sql`SELECT * FROM expenses ORDER BY created_at DESC LIMIT 250`;
  const totals: Row = { solaire: 0, alphaland: 0, count: rows.length };
  for (const row of rows) { const branch = String(row.branch).toLowerCase(); if (branch === "solaire" || branch === "alphaland") totals[branch] += Number(row.amount_centavos); }
  return json({ date: today(), totals, expenses: rows.map(publicRow) });
}

async function settlements(req: Request) {
  if (req.method !== "GET") return json({ error: "Method not allowed." }, 405);
  const u = new URL(req.url), branch = String(u.searchParams.get("branch") || "").trim();
  const category = String(u.searchParams.get("category") || "Receivable").trim();
  if (!["Alphaland", "Solaire"].includes(branch) || !["Receivable", "Payable"].includes(category)) return json({ error: "A valid branch and category are required." }, 400);
  const db = getDatabase();
  const originals = await db.sql`SELECT * FROM expenses WHERE branch=${branch} AND category=${category} ORDER BY expense_date,created_at`;
  const settlementCategory = category === "Receivable" ? "Receivable Settlement" : "Payable Settlement";
  const records = [];
  for (const original of originals) {
    const [paid] = await db.sql`SELECT COALESCE(SUM(amount_centavos),0) AS total FROM expenses WHERE branch=${branch} AND category=${settlementCategory} AND (settlement_parent_expense_id=${original.expense_id} OR receivable_reference=${original.receivable_reference})`;
    const originalCents = Number(original.amount_centavos || 0), previous = Number(paid?.total || 0), remaining = Math.max(0, originalCents - previous);
    if (remaining > 0) records.push(publicRow({ ...original, settlement_original_amount_centavos: originalCents, settlement_previous_paid_centavos: previous, settlement_remaining_centavos: remaining, settlement_status: previous ? "PARTIALLY_SETTLED" : "OPEN" }));
  }
  return json({ branch, category, records });
}

async function retry(req: Request, id: string) {
  const db = getDatabase(); const [row] = await db.sql`SELECT * FROM expenses WHERE expense_id=${id}`;
  if (!row) return json({ error: "Record not found." }, 404);
  const upload = (await req.formData()).get("receipt");
  if (upload instanceof File && upload.size) {
    if (!types.has(upload.type) || upload.size > 10_485_760) return json({ error: "Use a PDF, JPG, or PNG up to 10 MB." }, 400);
    const key = String(row.supporting_document_key || `expenses/${id}`); await getStore("expense-documents").set(key, upload); row.supporting_document_key = key;
    await db.sql`UPDATE expenses SET supporting_document_key=${key},supporting_document_name=${upload.name},supporting_document_type=${upload.type} WHERE expense_id=${id}`;
  }
  if (!row.supporting_document_key) return json({ error: "Re-upload the supporting document before retrying." }, 400);
  try {
    // If this record was previously delivered to Telegram by this version, remove the old Telegram post before re-posting.
    if (row.slack_channel && row.slack_message_ts && /^-?\d+$/.test(String(row.slack_channel)) && /^\d+$/.test(String(row.slack_message_ts))) {
      try { await telegramRequest("deleteMessage", { chat_id: String(row.slack_channel), message_id: Number(row.slack_message_ts) }); } catch {}
    }
    const sent = await sendTelegram(row);
    await db.sql`UPDATE expenses SET slack_status='Posted',slack_channel=${sent.channel},slack_message_ts=${sent.timestamp},slack_permalink=${sent.permalink},slack_error=NULL WHERE expense_id=${id}`;
    const [savedRow] = await db.sql`SELECT * FROM expenses WHERE expense_id=${id}`;
    const sheetSync = await syncExpenseSheet(savedRow || row);
    const sheetStatus = sheetSync.status === "synced" ? "Posted" : sheetSync.status === "not_configured" ? "Not configured" : "Failed";
    return json({ slackStatus: "Posted", sheetStatus, sheetSync, message: `Posted to Telegram successfully. Google Sheets: ${sheetStatus}.` });
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 500) : "Telegram request failed";
    await db.sql`UPDATE expenses SET slack_status='Failed',slack_error=${detail} WHERE expense_id=${id}`;
    return json({ slackStatus: "Failed", error: "Telegram posting failed. Please try again." }, 502);
  }
}

async function receipt(id: string) {
  const [row] = await getDatabase().sql`SELECT supporting_document_key,supporting_document_name,supporting_document_type FROM expenses WHERE expense_id=${id}`;
  if (!row?.supporting_document_key) return json({ error: "Supporting document not found." }, 404);
  const blob = await getStore("expense-documents").get(String(row.supporting_document_key), { type: "blob" });
  if (!(blob instanceof Blob)) return json({ error: "Supporting document not found." }, 404);
  const name = String(row.supporting_document_name || "document").replace(/["\r\n]/g, "");
  return new Response(blob, { headers: { "content-type": String(row.supporting_document_type || "application/octet-stream"), "content-disposition": `inline; filename="${name}"`, "cache-control": "private, no-store" } });
}

// ───────────────────────── Interbranch currency sale ─────────────────────────
// One branch sells foreign currency to the other. The pesos are paid at the time of the sale (the SELL / BUY
// transactions record that); the currency is handed over later. Until then:
//   seller: one "Payable"    row per currency (the currency is still in its drawer, owed to the buyer)
//   buyer:  one "Receivable" row per currency (paid for, not yet received)
// A handover writes a "Payable Settlement" (seller) and a "Receivable Settlement" (buyer) per currency, stamped with
// the time the currency actually moved, so the daily audit counts it on the right day. Amounts are in the
// currency's own units (amount_centavos = units × 100), which keeps partial handovers exact.
const IB_BRANCHES = ["Alphaland", "Solaire"];
const ibLabel = (branch: string) => `PSULIT ${String(branch).toUpperCase()}`;
const ibQty = (n: number) => new Intl.NumberFormat("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
const ibPeso = (n: number) => "₱" + new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const ibCents = (n: number) => Math.round(n * 100);

function manilaDateOf(when: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(when);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
const ibNewId = (date: string) => `PS-${date.replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

function ibItems(raw: string, needRate: boolean): { items: { currency: string; amount: number; rate: number | null }[]; error?: string } {
  let list: unknown;
  try { list = JSON.parse(raw || "[]"); } catch { return { items: [], error: "The currency list could not be read." }; }
  if (!Array.isArray(list) || !list.length) return { items: [], error: "Add at least one currency." };
  if (list.length > 20) return { items: [], error: "At most 20 currencies per entry." };
  const items: { currency: string; amount: number; rate: number | null }[] = [];
  for (const entry of list as Row[]) {
    const currency = String(entry?.currency || "").trim().toUpperCase();
    const amount = Number(String(entry?.amount ?? "").replaceAll(",", ""));
    const rate = currency === "PHP" ? 1 : (entry?.rate == null || entry.rate === "" ? null : Number(String(entry.rate).replaceAll(",", "")));
    if (!/^[A-Z]{3}$/.test(currency)) return { items: [], error: `"${currency || "?"}" is not a valid currency code (use 3 letters, like SGD).` };
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) return { items: [], error: `Enter a valid amount for ${currency} (at most 2 decimals).` };
    if (needRate && (rate == null || !Number.isFinite(rate) || rate <= 0)) return { items: [], error: `Enter the rate for ${currency}.` };
    if (items.some(i => i.currency === currency)) return { items: [], error: `${currency} is listed twice.` };
    items.push({ currency, amount, rate });
  }
  return { items };
}

async function ibPostTelegram(branch: string, text: string, doc: { key: string; type: string; name: string } | null) {
  const b = branch.toLowerCase();
  const chatId = b === "solaire" ? env("TELEGRAM_SOLAIRE_CHAT_ID") : b === "alphaland" ? env("TELEGRAM_ALPHALAND_CHAT_ID") : undefined;
  const topicId = b === "solaire" ? "17" : b === "alphaland" ? "3" : undefined;
  const token = env("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("Telegram is not configured");
  if (!chatId || !topicId) throw new Error("No Telegram chat is configured for this branch");
  let result: Row;
  const file = doc ? await getStore("expense-documents").get(doc.key, { type: "blob" }) : null;
  if (doc && file instanceof Blob) {
    const pdf = doc.type === "application/pdf";
    const form = new FormData();
    form.set("chat_id", chatId); form.set("message_thread_id", topicId); form.set("parse_mode", "HTML");
    if (text.length <= 1000) form.set("caption", text);
    else { await telegramRequest("sendMessage", { chat_id: chatId, message_thread_id: Number(topicId), text, parse_mode: "HTML" }); form.set("caption", "Supporting document"); }
    form.set(pdf ? "document" : "photo", file, doc.name || (pdf ? "document.pdf" : "photo.jpg"));
    const response = await fetch(`https://api.telegram.org/bot${token}/${pdf ? "sendDocument" : "sendPhoto"}`, { method: "POST", body: form });
    const data = await response.json() as Row;
    if (!response.ok || !data.ok) throw new Error(String(data.description || "Telegram post failed"));
    result = data.result as Row;
  } else {
    result = await telegramRequest("sendMessage", { chat_id: chatId, message_thread_id: Number(topicId), text, parse_mode: "HTML" });
  }
  const messageId = String(result?.message_id || "");
  return { channel: chatId, timestamp: messageId, permalink: messageId ? `https://t.me/c/${String(chatId).replace(/^-100/, "")}/${topicId}/${messageId}` : null };
}

async function ibMarkTelegram(ids: string[], sent: Row | null, error: string | null) {
  const db = getDatabase();
  for (const id of ids) {
    if (sent) await db.sql`UPDATE expenses SET slack_status='Posted',slack_channel=${sent.channel},slack_message_ts=${sent.timestamp},slack_permalink=${sent.permalink},slack_error=NULL WHERE expense_id=${id}`;
    else await db.sql`UPDATE expenses SET slack_status='Failed',slack_error=${error} WHERE expense_id=${id}`;
  }
}

async function ibOpenState(ref: string | null) {
  const db = getDatabase();
  const parents = ref
    ? await db.sql`SELECT * FROM expenses WHERE transfer_reference=${ref} AND category IN ('Payable','Receivable') ORDER BY created_at, expense_id`
    : await db.sql`SELECT * FROM expenses WHERE transfer_reference LIKE 'IBX-%' AND category IN ('Payable','Receivable') ORDER BY created_at, expense_id`;
  const paid = await db.sql`SELECT settlement_parent_expense_id AS parent, COALESCE(SUM(amount_centavos),0) AS total FROM expenses WHERE transfer_reference LIKE 'IBX-%' AND category IN ('Payable Settlement','Receivable Settlement') AND settlement_parent_expense_id IS NOT NULL GROUP BY settlement_parent_expense_id`;
  const paidBy = new Map(paid.map((p: Row) => [String(p.parent), Number(p.total || 0)]));
  const trades = new Map<string, Row>();
  for (const row of parents) {
    const key = String(row.transfer_reference);
    if (!trades.has(key)) trades.set(key, { ref: key, seller: row.source_branch, buyer: row.destination_branch, date: row.expense_date instanceof Date ? row.expense_date.toISOString().slice(0, 10) : String(row.expense_date).slice(0, 10), postedBy: row.posted_by, createdAt: row.created_at, items: new Map() });
    const trade = trades.get(key)!;
    const ccy = String(row.actual_currency);
    if (!trade.items.has(ccy)) trade.items.set(ccy, { currency: ccy, rate: row.valuation_rate == null ? null : Number(row.valuation_rate) });
    const item = trade.items.get(ccy);
    const original = Number(row.amount_centavos || 0), done = paidBy.get(String(row.expense_id)) || 0;
    if (row.category === "Payable") Object.assign(item, { payableId: row.expense_id, original: original / 100, handedOver: done / 100, remaining: Math.max(0, original - done) / 100 });
    else Object.assign(item, { receivableId: row.expense_id, received: done / 100, receivableRemaining: Math.max(0, original - done) / 100 });
  }
  return [...trades.values()].map(t => {
    const items = [...t.items.values()];
    return { ...t, items, open: items.some((i: Row) => Number(i.remaining) > 0 || Number(i.receivableRemaining) > 0) };
  });
}

async function interbranchSale(req: Request) {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const form = await req.formData(), worker = employees()?.[value(form, "pin")];
  if (!worker) return json({ error: "Verify your employee PIN again." }, 401);
  const seller = value(form, "seller"), buyer = value(form, "buyer");
  if (!IB_BRANCHES.includes(seller) || !IB_BRANCHES.includes(buyer) || seller === buyer) return json({ error: "Choose two different branches: the one selling and the one buying." }, 400);
  const { items, error } = ibItems(value(form, "items"), true);
  if (error) return json({ error }, 400);
  const sellerAr = value(form, "sellerAr").replace(/[^0-9A-Za-z-]/g, "").slice(0, 20), buyerAr = value(form, "buyerAr").replace(/[^0-9A-Za-z-]/g, "").slice(0, 20);
  const note = value(form, "note").slice(0, 500);
  const receipt = form.get("receipt");
  if (!(receipt instanceof File) || !receipt.size || !types.has(receipt.type) || receipt.size > 10_485_760) return json({ error: "Upload a photo (JPG/PNG) or PDF of the acknowledgement receipt, up to 10 MB." }, 400);

  const date = today(), ref = `IBX-${date.replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, blobKey = `interbranch/${ref}`;
  await getStore("expense-documents").set(blobKey, receipt);
  const db = getDatabase();
  const made: { id: string; branch: string }[] = [];
  try {
    for (const item of items) {
      const php = Math.round(item.amount * Number(item.rate) * 100) / 100;
      const sides = [
        { branch: seller, category: "Payable", who: ibLabel(buyer), text: `Sold ${ibQty(item.amount)} ${item.currency} to ${ibLabel(buyer)} @ ${item.rate} = ${ibPeso(php)}; not yet handed over${sellerAr ? ` (AR ${sellerAr})` : ""}${note ? ` — ${note}` : ""}` },
        { branch: buyer, category: "Receivable", who: ibLabel(seller), text: `Bought ${ibQty(item.amount)} ${item.currency} from ${ibLabel(seller)} @ ${item.rate} = ${ibPeso(php)}; not yet received${buyerAr ? ` (AR ${buyerAr})` : ""}${note ? ` — ${note}` : ""}` }
      ];
      for (const side of sides) {
        const id = ibNewId(date);
        await db.sql`INSERT INTO expenses (expense_id,expense_date,branch,posted_by,category,other_category,description,amount_centavos,fund_drawer_used,asset_type,actual_currency,actual_amount,borrower_company,valuation_rate,transfer_reference,source_branch,destination_branch,receivable_reference,settlement_status,supporting_document_key,supporting_document_name,supporting_document_type)
          VALUES (${id},${date},${side.branch},${worker},${side.category},${"Interbranch currency sale"},${side.text},${ibCents(item.amount)},${"Forex Drawer"},${"Physical Cash"},${item.currency},${item.amount},${side.who},${item.rate},${ref},${seller},${buyer},${id},${"OPEN"},${blobKey},${receipt.name},${receipt.type})`;
        made.push({ id, branch: side.branch });
      }
    }
  } catch (err) {
    for (const m of made) { try { await db.sql`DELETE FROM expenses WHERE expense_id=${m.id}`; } catch {} }
    console.error("Interbranch sale insert failed", err instanceof Error ? err.message : err);
    return json({ error: "The sale could not be saved. Nothing was recorded; please try again." }, 500);
  }

  const total = items.reduce((t, i) => t + Math.round(i.amount * Number(i.rate) * 100) / 100, 0);
  const lines = items.map(i => `• ${ibQty(i.amount)} ${escapeHtml(i.currency)} @ ${escapeHtml(i.rate)} = ${ibPeso(Math.round(i.amount * Number(i.rate) * 100) / 100)}`);
  const ars = [sellerAr ? `${seller} AR ${escapeHtml(sellerAr)}` : "", buyerAr ? `${buyer} AR ${escapeHtml(buyerAr)}` : ""].filter(Boolean).join(" · ");
  const message = (side: "seller" | "buyer") => [
    `<b>INTERBRANCH CURRENCY ${side === "seller" ? "SALE" : "PURCHASE"}</b>`,
    `<b>Reference:</b> ${ref}`,
    side === "seller" ? `<b>Sold to:</b> ${ibLabel(buyer)}` : `<b>Bought from:</b> ${ibLabel(seller)}`,
    ...(ars ? [`<b>AR:</b> ${ars}`] : []),
    `<b>Currencies:</b>`, ...lines,
    `<b>Total:</b> ${ibPeso(total)}`,
    side === "seller" ? `<b>Status:</b> NOT YET HANDED OVER (recorded as Payable)` : `<b>Status:</b> NOT YET RECEIVED (recorded as Receivable)`,
    ...(note ? [`<b>Note:</b> ${escapeHtml(note)}`] : []),
    `<b>Posted by:</b> ${escapeHtml(worker)}`,
    `<b>Posted at:</b> ${escapeHtml(displayDateTime(new Date()))}`
  ].join("\n");
  const telegram: Row = {};
  for (const [side, branch] of [["seller", seller], ["buyer", buyer]] as const) {
    const ids = made.filter(m => m.branch === branch).map(m => m.id);
    try { const sent = await ibPostTelegram(branch, message(side), { key: blobKey, type: receipt.type, name: receipt.name }); await ibMarkTelegram(ids, sent, null); telegram[branch] = "Posted"; }
    catch (e) { const detail = e instanceof Error ? e.message.slice(0, 300) : "Telegram post failed"; await ibMarkTelegram(ids, null, detail); telegram[branch] = "Failed"; }
  }
  return json({ ref, rows: made.map(m => ({ expenseId: m.id, branch: m.branch })), telegram, message: `Saved ${items.length} currenc${items.length === 1 ? "y" : "ies"} for both branches. Now saving to Google Sheets…` }, 201);
}

async function interbranchHandover(req: Request) {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const form = await req.formData(), worker = employees()?.[value(form, "pin")];
  if (!worker) return json({ error: "Verify your employee PIN again." }, 401);
  const ref = value(form, "ref");
  const [trade] = ref ? await ibOpenState(ref) : [];
  if (!trade) return json({ error: "That interbranch sale was not found." }, 404);
  const { items, error } = ibItems(value(form, "items"), false);
  if (error) return json({ error }, 400);
  const when = new Date(value(form, "handedOverAt") || Date.now());
  if (Number.isNaN(when.getTime())) return json({ error: "Enter when the currency was handed over." }, 400);
  if (when.getTime() > Date.now() + 5 * 60_000) return json({ error: "The handover time cannot be in the future." }, 400);
  if (when.getTime() < Date.now() - 7 * 86_400_000) return json({ error: "The handover time is more than 7 days ago; ask the admin to record it." }, 400);
  const note = value(form, "note").slice(0, 500);
  for (const item of items) {
    const open = trade.items.find((i: Row) => i.currency === item.currency);
    if (!open || !open.payableId || !open.receivableId) return json({ error: `${item.currency} is not part of this sale.` }, 400);
    const left = Math.min(Number(open.remaining), Number(open.receivableRemaining));
    if (ibCents(item.amount) > ibCents(left)) return json({ error: left > 0 ? `${item.currency}: only ${ibQty(left)} is still to be handed over.` : `${item.currency} has already been handed over in full.` }, 400);
  }
  const receipt = form.get("receipt");
  let doc: { key: string; type: string; name: string } | null = null;
  if (receipt instanceof File && receipt.size) {
    if (!types.has(receipt.type) || receipt.size > 10_485_760) return json({ error: "Use a PDF, JPG, or PNG up to 10 MB." }, 400);
    doc = { key: `interbranch/${ref}/handover-${Date.now()}`, type: receipt.type, name: receipt.name };
    await getStore("expense-documents").set(doc.key, receipt);
  }

  const date = manilaDateOf(when), stamp = when.toISOString();
  const db = getDatabase();
  const made: { id: string; branch: string }[] = [];
  try {
    for (const item of items) {
      const open = trade.items.find((i: Row) => i.currency === item.currency);
      const sides = [
        { branch: trade.seller, category: "Payable Settlement", parent: open.payableId, original: Number(open.original), done: Number(open.handedOver), who: ibLabel(trade.buyer), text: `Handed over ${ibQty(item.amount)} ${item.currency} to ${ibLabel(trade.buyer)} (${ref})${note ? ` — ${note}` : ""}` },
        { branch: trade.buyer, category: "Receivable Settlement", parent: open.receivableId, original: Number(open.original), done: Number(open.received), who: ibLabel(trade.seller), text: `Received ${ibQty(item.amount)} ${item.currency} from ${ibLabel(trade.seller)} (${ref})${note ? ` — ${note}` : ""}` }
      ];
      for (const side of sides) {
        const id = ibNewId(date);
        const remaining = ibCents(side.original) - ibCents(side.done) - ibCents(item.amount);
        await db.sql`INSERT INTO expenses (expense_id,expense_date,branch,posted_by,category,other_category,description,amount_centavos,fund_drawer_used,asset_type,actual_currency,actual_amount,borrower_company,valuation_rate,transfer_reference,source_branch,destination_branch,settlement_method,receivable_reference,settlement_type,settlement_parent_expense_id,settlement_reference,settlement_original_amount_centavos,settlement_previous_paid_centavos,settlement_remaining_centavos,settlement_status,supporting_document_key,supporting_document_name,supporting_document_type,created_at)
          VALUES (${id},${date},${side.branch},${worker},${side.category},${"Interbranch currency sale"},${side.text},${ibCents(item.amount)},${"Forex Drawer"},${"Physical Cash"},${item.currency},${item.amount},${side.who},${open.rate},${ref},${trade.seller},${trade.buyer},${"Currency handover"},${side.parent},${side.category},${side.parent},${side.parent},${ibCents(side.original)},${ibCents(side.done)},${remaining},${remaining === 0 ? "SETTLED" : "PARTIALLY_SETTLED"},${doc?.key || null},${doc?.name || null},${doc?.type || null},${stamp})`;
        made.push({ id, branch: side.branch });
      }
    }
  } catch (err) {
    for (const m of made) { try { await db.sql`DELETE FROM expenses WHERE expense_id=${m.id}`; } catch {} }
    console.error("Interbranch handover insert failed", err instanceof Error ? err.message : err);
    return json({ error: "The handover could not be saved. Nothing was recorded; please try again." }, 500);
  }

  const [after] = await ibOpenState(ref);
  const still = (after?.items || []).filter((i: Row) => Number(i.remaining) > 0).map((i: Row) => `${ibQty(Number(i.remaining))} ${i.currency}`);
  const moved = items.map(i => `• ${ibQty(i.amount)} ${escapeHtml(i.currency)}`);
  const message = (side: "seller" | "buyer") => [
    side === "seller" ? `<b>CURRENCY HANDED OVER TO ${ibLabel(trade.buyer)}</b>` : `<b>CURRENCY RECEIVED FROM ${ibLabel(trade.seller)}</b>`,
    `<b>Reference:</b> ${ref}`,
    ...moved,
    `<b>${side === "seller" ? "Handed over" : "Received"} at:</b> ${escapeHtml(displayDateTime(when))}`,
    `<b>Still to hand over:</b> ${still.length ? escapeHtml(still.join(", ")) : "nothing — complete"}`,
    ...(note ? [`<b>Note:</b> ${escapeHtml(note)}`] : []),
    `<b>Recorded by:</b> ${escapeHtml(worker)}`
  ].join("\n");
  const telegram: Row = {};
  for (const [side, branch] of [["seller", trade.seller], ["buyer", trade.buyer]] as const) {
    const ids = made.filter(m => m.branch === branch).map(m => m.id);
    try { const sent = await ibPostTelegram(branch, message(side), doc); await ibMarkTelegram(ids, sent, null); telegram[branch] = "Posted"; }
    catch (e) { const detail = e instanceof Error ? e.message.slice(0, 300) : "Telegram post failed"; await ibMarkTelegram(ids, null, detail); telegram[branch] = "Failed"; }
  }
  return json({ ref, rows: made.map(m => ({ expenseId: m.id, branch: m.branch })), telegram, stillOwed: still }, 201);
}

async function interbranchOpen(req: Request) {
  if (req.method !== "GET") return json({ error: "Method not allowed." }, 405);
  const all = new URL(req.url).searchParams.get("all") === "1";
  const trades = await ibOpenState(null);
  return json({ trades: (all ? trades : trades.filter(t => t.open)).reverse() });
}

async function syncSheetRow(req: Request, id: string) {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  let pin = ""; try { pin = String((await req.json() as Row).pin || ""); } catch {}
  if (!employees()?.[pin]) return json({ error: "Verify your employee PIN again." }, 401);
  const [row] = await getDatabase().sql`SELECT * FROM expenses WHERE expense_id=${id}`;
  if (!row) return json({ error: "Record not found." }, 404);
  const result = await syncExpenseSheet(row);
  return json({ expenseId: id, sheetStatus: result.status === "synced" ? "Posted" : result.status === "not_configured" ? "Not configured" : "Failed", error: (result as Row).error || null }, result.status === "synced" ? 200 : 502);
}

export default async function handler(req: Request) {
  const path = route(req);
  try {
    if (path === "/api/config" && req.method === "GET") return json({ date: today() });
    if (path === "/api/employee/verify") return verify(req);
    if (path === "/api/expenses" && req.method === "POST") return create(req);
    if (path === "/api/expenses" && req.method === "GET") return list();
    if (path === "/api/settlements") return settlements(req);
    if (path === "/api/interbranch/sale") return interbranchSale(req);
    if (path === "/api/interbranch/handover") return interbranchHandover(req);
    if (path === "/api/interbranch/open") return interbranchOpen(req);
    const syncPath = path.match(/^\/api\/expenses\/([^/]+)\/sync-sheet$/); if (syncPath) return syncSheetRow(req, decodeURIComponent(syncPath[1]));
    const retryPath = path.match(/^\/api\/expenses\/([^/]+)\/retry-(?:telegram|slack)$/); if (retryPath && req.method === "POST") return retry(req, decodeURIComponent(retryPath[1]));
    const receiptPath = path.match(/^\/(?:api\/)?receipts\/([^/]+)$/); if (receiptPath && req.method === "GET") return receipt(decodeURIComponent(receiptPath[1]));
    return json({ error: "Not found." }, 404);
  } catch (error) {
    console.error("API request failed", error instanceof Error ? error.message : "Unknown error");
    return json({ error: "The server could not complete this request. Please try again." }, 500);
  }
}
