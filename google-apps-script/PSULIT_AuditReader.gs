// PSULIT Audit — READ-ONLY Google Sheets reader
// IMPORTANT: This is a SEPARATE script from the live Cash Count posting script.
// It has NO doPost function and does not post to Telegram or modify any sheet.
//
// Create this as a NEW standalone Google Apps Script project.
// Script Properties:
//   AUDIT_READ_SECRET = the same secret used by the PSULIT Audit backend
//
// Web app GET:
//   ?branch=Alphaland&date=2026-10-04&secret=...&auditRead=all
//
// The audit backend performs the date/sequence filtering itself.

const SPREADSHEET_ID = '1_msQClr0yfx_jTKeEfop6lnfNvBPd-sNNMkgLnBgsrU';

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const expectedSecret =
      PropertiesService.getScriptProperties().getProperty('AUDIT_READ_SECRET');

    if (!expectedSecret) return output_({ ok: false, error: 'AUDIT_READ_SECRET is not configured.' });
    if (!params.secret || params.secret !== expectedSecret) {
      return output_({ ok: false, error: 'Unauthorized.' });
    }

    // Combined fast path for Cash Count Step 7. Read the branch cash log only once,
    // then calculate both ledgers from the same snapshot. The separate actions below
    // remain available for compatibility with older clients.
    if (params.action === 'openRecPayables') {
      const branch = String(params.branch || '').trim();
      if (branch !== 'Alphaland' && branch !== 'Solaire') return output_({ ok: false, error: 'Unknown branch.' });
      const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
      const expense = rcvReadTab_(spreadsheet, branch + ' Expense & Cash Movement');
      if (expense.missing) return output_({ ok: false, error: 'Expense & Cash Movement tab not found for ' + branch + '.' });

      const receivableParties = rcvReadTab_(spreadsheet, RCV_PARTIES_SHEET);
      const payableParties = rcvReadTab_(spreadsheet, PAY_PARTIES_SHEET);
      const receivableResult = computeOpenReceivables_(branch, expense.rows, receivableParties.rows);
      const payableResult = computeOpenPayables_(branch, expense.rows, payableParties.rows);
      if (receivableParties.missing) receivableResult.issues.push('The "' + RCV_PARTIES_SHEET + '" tab was not found.');
      if (payableParties.missing) payableResult.issues.push('The "' + PAY_PARTIES_SHEET + '" tab was not found, opening balances and custom aliases were not applied. Built-in Hive/MB/Moneybees aliases are active.');

      return output_({
        ok: true,
        branch: branch,
        receivables: receivableResult.receivables,
        receivableIssues: receivableResult.issues,
        payables: payableResult.payables,
        payableIssues: payableResult.issues,
        rowsRead: expense.rows.length,
        source: 'Expense & Cash Movement — shared read for receivables and payables'
      });
    }

    // action=openReceivables → return the open receivable balances for the branch.
    // Any other action (or no action param) → existing date-range audit read.
    if (params.action === 'openReceivables') {
      const branch = String(params.branch || '').trim();
      if (branch !== 'Alphaland' && branch !== 'Solaire') return output_({ ok: false, error: 'Unknown branch.' });
      const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
      const expense = rcvReadTab_(spreadsheet, branch + ' Expense & Cash Movement');
      if (expense.missing) return output_({ ok: false, error: 'Expense & Cash Movement tab not found for ' + branch + '.' });
      const parties = rcvReadTab_(spreadsheet, RCV_PARTIES_SHEET);
      const result = computeOpenReceivables_(branch, expense.rows, parties.rows);
      if (parties.missing) result.issues.push('The "' + RCV_PARTIES_SHEET + '" tab was not found.');
      return output_({ ok: true, branch: branch, receivables: result.receivables, issues: result.issues, rowsRead: expense.rows.length });
    }

    // action=openPayables → return what PSulit still owes, per party, for the branch.
    if (params.action === 'openPayables') {
      const branch = String(params.branch || '').trim();
      if (branch !== 'Alphaland' && branch !== 'Solaire') return output_({ ok: false, error: 'Unknown branch.' });
      const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
      const expense = rcvReadTab_(spreadsheet, branch + ' Expense & Cash Movement');
      if (expense.missing) return output_({ ok: false, error: 'Expense & Cash Movement tab not found for ' + branch + '.' });
      const parties = rcvReadTab_(spreadsheet, PAY_PARTIES_SHEET);
      const result = computeOpenPayables_(branch, expense.rows, parties.rows);
      if (parties.missing) result.issues.push('The "' + PAY_PARTIES_SHEET + '" tab was not found, opening balances and custom aliases were not applied. Built-in Hive/MB/Moneybees aliases are active.');
      return output_({ ok: true, branch: branch, payables: result.payables, issues: result.issues, rowsRead: expense.rows.length });
    }

    const branch = String(params.branch || '').trim();
    const date = String(params.date || '').trim();

    if (branch !== 'Alphaland' && branch !== 'Solaire') {
      return output_({ ok: false, error: 'Unknown branch.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return output_({ ok: false, error: 'Invalid date. Use YYYY-MM-DD.' });
    }

    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheetNames = [
      branch + ' Cash Count',
      branch + ' Transactions',
      branch + ' Expense & Cash Movement'
    ];

    const sheets = {};

    sheetNames.forEach(function(sheetName) {
      const sheet = spreadsheet.getSheetByName(sheetName);

      if (!sheet) {
        sheets[sheetName] = { headers: [], rows: [], missing: true };
        return;
      }

      const values = sheet.getDataRange().getDisplayValues();

      if (!values.length) {
        sheets[sheetName] = { headers: [], rows: [] };
        return;
      }

      const headers = values[0].map(function(v) {
        return String(v || '').trim();
      });

      const rows = values.slice(1).map(function(row) {
        const obj = {};
        headers.forEach(function(header, i) {
          if (header) obj[header] = row[i] === undefined ? '' : row[i];
        });
        return obj;
      });

      // Return the complete selected sheets.
      // The audit backend performs business-date and sequence filtering.
      sheets[sheetName] = {
        headers: headers,
        rows: rows
      };
    });

    return output_({
      ok: true,
      source: 'Google Sheets — PSULIT OPERATIONS APP LOG 2026',
      branch: branch,
      requestedDate: date,
      readOnly: true,
      sheets: sheets
    });

  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return output_({
      ok: false,
      error: String(error && error.message ? error.message : error)
    });
  }
}


var RCV_PARTIES_SHEET = 'Receivable Parties';

function rcvNum_(v) { var x = Number(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isFinite(x) ? x : 0; }
function rcvKey_(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function rcvRound_(x) { return Math.round((Number(x) + 1e-9) * 100) / 100; }
function rcvDate_(v) {
  var s = String(v == null ? '' : v).trim(), m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  return '';
}
function rcvField_(row, names) {
  for (var i = 0; i < names.length; i++) {
    if (row[names[i]] !== undefined) return row[names[i]];
  }
  var keys = Object.keys(row || {});
  for (var j = 0; j < names.length; j++) {
    var want = names[j].toLowerCase();
    for (var k = 0; k < keys.length; k++) { if (keys[k].toLowerCase().trim() === want) return row[keys[k]]; }
  }
  return '';
}

// 'charge' = the party owes more; 'collection' = the party paid some back; null = not a receivable.
// Mirrors the audit's own rules so the Cash Count and the audit always agree.
// Categories used by the cash log app:
//   Receivable            amount owed to PSulit (cash advance)         -> charge (or a payment, by wording, as the audit reads it)
//   Teller Short          a shortage charged to a teller               -> charge
//   Receivable Settlement a payment (Cash Received or Offset/Non-Cash) -> collection
function rcvDirection_(row) {
  var category = String(rcvField_(row, ['Category'])).trim().toLowerCase();
  if (category === 'receivable settlement') return 'collection';
  if (category === 'teller short') return 'charge';
  if (category !== 'receivable') return null;
  var settlement = String(rcvField_(row, ['Settlement Method'])).trim();      // explicit wins
  if (/^(collect|paid|payment|settle|repaid|return|cash received|offset)/i.test(settlement)) return 'collection';
  if (/^(charge|lent|advance|owed|loan)/i.test(settlement)) return 'charge';
  var source = String(rcvField_(row, ['Fund / Drawer', 'Fund / Account', 'Fund'])).trim();
  var description = String(rcvField_(row, ['Description', 'Notes'])).trim();
  var other = String(rcvField_(row, ['Other Category'])).trim();
  if (/external|no psulit fund/i.test(source)) {
    // money from outside PSulit: a payment only if it says so; otherwise it is a bookkeeping charge
    return /payment|paid|collect|repaid|repayment|settle|received|returned/i.test(description + ' ' + other) ? 'collection' : 'charge';
  }
  var cashIn = /cash in|php in|drawer in|inflow|received|collect(?:ion|ed)?|repaid|returned/i.test(description);
  var cashOut = /cash out|php out|drawer out|outflow|paid|borrow(?:ed|ing)?/i.test(description);
  return (cashIn && !cashOut) ? 'collection' : 'charge';
}

// Find which known party a piece of free text names. Whole words only ("mb" does not match "number").
// Returns the party key, '' when none is named, or 'AMBIGUOUS' when more than one is.
function rcvMatchParty_(text, known) {
  var tokens = String(text == null ? '' : text).toLowerCase().split(/[^a-z0-9]+/).filter(function (t) { return t; });
  var found = {}, i, j, acc;
  for (i = 0; i < tokens.length; i++) {
    acc = '';
    for (j = i; j < tokens.length && j < i + 5; j++) { acc += tokens[j]; if (known[acc]) found[known[acc]] = true; }
  }
  var keys = Object.keys(found);
  return keys.length === 1 ? keys[0] : (keys.length ? 'AMBIGUOUS' : '');
}

// Canonical branch names keep the two ledgers attached to the actual PSulit branch,
// rather than displaying the legal/account label "PSULIT SOLAIRE" as a generic party.
function rcvCanonicalParty_(name) {
  var value = String(name == null ? '' : name).trim();
  var key = rcvKey_(value);
  if (['psulitsolaire', 'solaire', 'solairebranch'].indexOf(key) >= 0) return 'Solaire Branch';
  if (['psulitalphaland', 'alphaland', 'alphalandbranch'].indexOf(key) >= 0) return 'Alphaland Branch';
  return value;
}

// Voided legacy rows may remain in the sheet for audit history. They must not
// contribute to either open ledger, even if their Category is still Receivable/Payable.
function rcvIsVoidedRow_(row) {
  var status = String(rcvField_(row, ['Status', 'Record Status', 'Void Status'])).trim();
  var description = String(rcvField_(row, ['Description', 'Notes'])).trim();
  return /^(void|voided|cancelled|canceled)$/i.test(status) || /^\s*\[?VOIDED\b/i.test(description);
}

// Interbranch currency sale has two simultaneous obligations:
//  - PHP equivalent is receivable from the buying branch;
//  - original currency quantity remains payable until physical handover.
// The same row is therefore read by BOTH ledgers, with different units.
function rcvInterbranchCounterparty_(row) {
  var borrower = String(rcvField_(row, ['Borrower / Company', 'Borrower'])).trim();
  if (!borrower) {
    var description = String(rcvField_(row, ['Description', 'Notes']));
    var match = description.match(/\bsold\b.*?\bto\s+(?:PSULIT\s+)?(SOLAIRE|ALPHALAND)\b/i);
    if (match) borrower = 'PSULIT ' + match[1].toUpperCase();
  }
  return rcvCanonicalParty_(borrower);
}

function computeOpenReceivables_(branch, expenseRows, partyRows) {
  var parties = {}, aliasToKey = {}, issues = [];
  function newParty_() { return { name: '', opening: 0, asOf: '', balance: 0, lastDate: '', casing: {} }; }
  (partyRows || []).forEach(function (p) {
    var pb = String(rcvField_(p, ['Branch'])).trim().toLowerCase();
    if (pb && pb !== 'all' && pb !== String(branch).toLowerCase()) return;
    var rawName = String(rcvField_(p, ['Party'])).trim();
    if (!rawName) return;
    var name = rcvCanonicalParty_(rawName);
    var key = rcvKey_(name);
    var rec = parties[key] || (parties[key] = newParty_());
    rec.name = name;
    rec.opening += rcvNum_(rcvField_(p, ['Opening Amount PHP', 'Opening Amount']));
    var asOf = rcvDate_(rcvField_(p, ['As Of Date', 'As Of']));
    if (asOf) rec.asOf = asOf;
    aliasToKey[key] = key;
    aliasToKey[rcvKey_(rawName)] = key;
    String(rcvField_(p, ['Aliases'])).split(/[,;\n]/).forEach(function (a) { var k = rcvKey_(a); if (k) aliasToKey[k] = key; });
  });

  // Built-in interbranch aliases let a later PHP collection identify either branch
  // even when the optional Receivable Parties tab has no custom alias rows.
  aliasToKey['psulitsolaire'] = 'solairebranch';
  aliasToKey['solaire'] = 'solairebranch';
  aliasToKey['solairebranch'] = 'solairebranch';
  aliasToKey['psulitalphaland'] = 'alphalandbranch';
  aliasToKey['alphaland'] = 'alphalandbranch';
  aliasToKey['alphalandbranch'] = 'alphalandbranch';

  // Pass 1: read every receivable-type entry.
  var entries = [], recordBorrower = {};
  (expenseRows || []).forEach(function (row) {
    if (rcvIsVoidedRow_(row)) return;
    var isInterbranchSale = payIsInterbranchCurrencySale_(row);
    var dir = isInterbranchSale ? 'charge' : rcvDirection_(row);
    if (!dir) return;

    var amount = rcvNum_(rcvField_(row, ['Amount PHP', 'Amount']));
    if (isInterbranchSale) {
      // Prefer the original currency x the transaction's captured rate so the
      // PHP receivable remains correct even if Amount PHP was historically wrong.
      var fxAmount = rcvNum_(rcvField_(row, ['Actual Amount']));
      var fxRate = rcvNum_(rcvField_(row, ['Valuation Rate']));
      if (fxAmount > 0 && fxRate > 0) amount = rcvRound_(fxAmount * fxRate);
    }
    if (!(amount > 0)) return;

    var borrower = isInterbranchSale
      ? rcvInterbranchCounterparty_(row)
      : rcvCanonicalParty_(String(rcvField_(row, ['Borrower / Company', 'Borrower'])).trim());
    var e = {
      dir: dir, amount: amount,
      recordId: String(rcvField_(row, ['Record ID'])).trim(),
      date: rcvDate_(rcvField_(row, ['Official Date', 'Audit Business Date', 'Created At'])),
      borrower: borrower,
      reference: String(rcvField_(row, ['Receivable Reference'])).trim(),
      isInterbranchSale: isInterbranchSale,
      text: [rcvField_(row, ['Receivable Reference']), rcvField_(row, ['Description', 'Notes']), rcvField_(row, ['Other Category'])].join(' ')
    };
    if (e.borrower && e.recordId) recordBorrower[e.recordId.toLowerCase()] = e.borrower;
    entries.push(e);
  });

  // Names we can recognise in free text: configured parties, their aliases, and borrowers named on charges.
  var known = {};
  Object.keys(aliasToKey).forEach(function (k) { known[k] = aliasToKey[k]; });
  entries.forEach(function (e) {
    if (e.dir === 'charge' && e.borrower) { var k = rcvKey_(e.borrower); known[k] = aliasToKey[k] || k; }
  });

  // Pass 2: add each entry to its party.
  var raw = {};
  entries.forEach(function (e) {
    var key = '', display = e.borrower;
    if (e.borrower) {
      var k0 = rcvKey_(e.borrower); key = aliasToKey[k0] || k0;
    } else if (e.dir === 'collection') {
      // A payment that names no party (the Receivable Settlement form has no borrower field):
      // 1) its reference may be the Record ID of the original receivable, 2) else a party named in the text.
      var viaId = e.reference && recordBorrower[e.reference.toLowerCase()];
      if (viaId) { viaId = rcvCanonicalParty_(viaId); var k1 = rcvKey_(viaId); key = aliasToKey[k1] || k1; display = viaId; }
      else {
        var m = rcvMatchParty_(e.text, known);
        if (m === 'AMBIGUOUS') { issues.push('Payment ' + e.recordId + ' (₱' + e.amount.toFixed(2) + ') names more than one party — it was NOT applied. Put the one party\'s name in its description.'); return; }
        if (!m) { issues.push('Payment ' + e.recordId + ' (₱' + e.amount.toFixed(2) + ') does not say who paid — it was NOT applied. Put the party\'s name in its reference or description.'); return; }
        key = m;
      }
    } else {
      issues.push('Entry ' + e.recordId + ' is a receivable with no borrower name.');
      display = '(no borrower name)'; key = rcvKey_(display);
    }
    var rec = parties[key] || (parties[key] = newParty_());
    if (key === 'hive' && !rec.name) rec.name = 'Hive';
    if (rec.asOf && e.date && e.date <= rec.asOf) return;               // already inside the opening balance
    rec.balance += (e.dir === 'charge' ? e.amount : -e.amount);
    if (e.date > rec.lastDate) rec.lastDate = e.date;
    if (display) rec.casing[display] = (rec.casing[display] || 0) + 1;
  });

  var out = [];
  Object.keys(parties).forEach(function (key) {
    var rec = parties[key], name = rec.name;
    if (!name) {                                                      // no configured name: most common spelling, mixed case preferred
      var best = '', bestScore = -1;
      Object.keys(rec.casing).forEach(function (c) {
        var score = rec.casing[c] * 10 + (c === c.toUpperCase() ? 0 : 1);
        if (score > bestScore) { best = c; bestScore = score; }
      });
      name = best || key;
    }
    var balance = rcvRound_(rec.opening + rec.balance);
    if (balance > 0.004) out.push({ name: name, amount: balance, currency: 'PHP', lastActivity: rec.lastDate || '' });
    else if (balance < -0.004) issues.push(name + ' has paid ₱' + Math.abs(balance).toFixed(2) + ' MORE than is owed — check the Expense & Cash Movement log.');
  });
  out.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0; });
  return { receivables: out, issues: issues };
}


function rcvReadTab_(spreadsheet, name) {
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) return { missing: true, rows: [] };
  var values = sheet.getDataRange().getDisplayValues();
  if (!values.length) return { rows: [] };
  var headers = values[0].map(function (v) { return String(v || '').trim(); });
  var rows = values.slice(1).map(function (row) {
    var obj = {};
    headers.forEach(function (h, i) { if (h) obj[h] = row[i] === undefined ? '' : row[i]; });
    return obj;
  });
  return { rows: rows };
}


// ==== PAYABLES LEDGER (begin) =====================================================
// Open payables (what the selected branch owes) per party, worked out from the branch's
// "Expense & Cash Movement" tab. A payable stays on the Cash Count until it is paid.
//
// Which "Payable" lines count (not every one does):
//   Payable, Fund / Drawer = External / No PSulit Fund  -> NEW DEBT. Someone outside PSulit put
//        their own money in (e.g. "Lottomatik Top-up - Personal funds advanced"), so PSulit owes them.
//   Payable, Fund / Drawer = a PSulit fund (Lottomatik, Forex Drawer, ...) -> PAYMENT. Cash left a
//        PSulit fund, so the debt was paid on the spot. It reduces the party's balance if a party can
//        be identified; otherwise it is simply not posted.
//   Payable Settlement                                    -> PAYMENT.
//   A Settlement Method of "Paid…/Offset…" or "Owed…/Borrowed…" overrides the fund rule.
//   A Payable that is a teller covering their own shortage ("short"/"shortage" in the description)
//        is never posted — it is settled, PSulit owes nothing back.
//
// Who is owed, in order: Borrower / Company -> "funded by X" / "advanced by X" in the description
//   -> the person who posted it (Posted By).
// Payments find their party the same way, or via the payable's Record ID in Receivable Reference.
// Optional "Payable Parties" tab: Branch | Party | Aliases | Opening Amount PHP | As Of Date | Notes
var PAY_PARTIES_SHEET = 'Payable Parties';
var PAY_PARTY_FIELDS = ['Borrower / Company', 'Payee / Creditor', 'Creditor', 'Borrower'];
var PAY_REFERENCE_FIELDS = ['Payable Reference', 'Receivable Reference'];

function payIsExternal_(row) {
  return /external|no psulit fund/i.test(String(rcvField_(row, ['Fund / Drawer', 'Fund / Account', 'Fund'])));
}

// MB, Moneybees and MB Hive refer to the same creditor shown in Cash Count as Hive.
function payCanonicalParty_(name) {
  var value = String(name == null ? '' : name).trim();
  var key = rcvKey_(value);
  if (['hive', 'mb', 'moneybees', 'mbhive'].indexOf(key) >= 0) return 'Hive';
  return rcvCanonicalParty_(value);
}

// Interbranch currency sales create a currency handover obligation, not a PHP debt.
// The Amount PHP column is only the valuation equivalent; Actual Currency/Actual Amount
// are the quantities that must be delivered to the buying branch.
function payIsInterbranchCurrencySale_(row) {
  var category = String(rcvField_(row, ['Category'])).trim().toLowerCase();
  var other = String(rcvField_(row, ['Other Category'])).trim();
  var currency = String(rcvField_(row, ['Actual Currency'])).trim().toUpperCase();
  var description = String(rcvField_(row, ['Description', 'Notes'])).trim();
  return category === 'payable' && currency && currency !== 'PHP' &&
    (/interbranch\s+currency\s+sale/i.test(other) || /\bsold\b.+\bto\s+psulit\s+solaire\b/i.test(description));
}

// 'owed' = branch owes more; 'paid' = branch handed over/settled; null = not a payable.
function payDirection_(row) {
  var category = String(rcvField_(row, ['Category'])).trim().toLowerCase();
  if (category === 'payable settlement' || category === 'payable payment') return 'paid';
  if (category !== 'payable') return null;
  if (payIsInterbranchCurrencySale_(row)) return 'owed';
  var settlement = String(rcvField_(row, ['Settlement Method'])).trim();      // explicit wins
  if (/^(paid|payment|settle|repaid|return|cash paid|offset)/i.test(settlement)) return 'paid';
  if (/^(owed|borrow|credit|loan|charge|unpaid|advance)/i.test(settlement)) return 'owed';
  // A teller covering their own shortage (e.g. "VND Shortage … funded by Tina") is already settled:
  // PSulit does not owe the money back, so it is not a payable.
  var text = String(rcvField_(row, ['Description', 'Notes'])) + ' ' + String(rcvField_(row, ['Other Category']));
  if (/\bshort(?:age|ages)?\b/i.test(text)) return null;
  // An explicit creditor phrase wins over Fund / Drawer. Example: Category=Payable,
  // Fund / Drawer=Hive, Description="Payable to MB" means PSulit still owes Hive.
  if (/\b(?:payable|owed|due)\s+to\b|\bpsulit\s+owes?\b/i.test(text)) return 'owed';
  return payIsExternal_(row) ? 'owed' : 'paid';
}

// "payable to MB" / "owed to Moneybees" -> named creditor.
function payCreditorFromText_(text) {
  var m = String(text || '').match(/\b(?:payable|owed|due)\s+to\s+([A-Za-z][A-Za-z0-9&.'\- ]{0,40}?)(?=\s*(?:[,.;:()\-–]|\r|\n|$|\s+(?:for|on|from|to|dated|last|with)\b))/i);
  return m ? m[1].trim() : '';
}

// "funded by Tina", "advanced by Sir Jay" -> "Tina", "Sir Jay"
function payFundedBy_(text) {
  var m = String(text || '').match(/\b(?:funded|advanced|shouldered|fronted|lent)\s+by\s+([A-Za-z][A-Za-z.'\- ]{0,40}?)(?=\s*(?:[,.;:()\-–]|\r|\n|$|\s+(?:for|on|from|to|dated|last|with)\b))/i);
  return m ? m[1].trim() : '';
}

function computeOpenPayables_(branch, expenseRows, partyRows) {
  var parties = {}, aliasToKey = {}, issues = [];
  function newParty_() {
    return { name: '', opening: 0, asOf: '', balance: 0, lastDate: '', casing: {}, currencies: {} };
  }
  (partyRows || []).forEach(function (p) {
    var pb = String(rcvField_(p, ['Branch'])).trim().toLowerCase();
    if (pb && pb !== 'all' && pb !== String(branch).toLowerCase()) return;
    var rawName = String(rcvField_(p, ['Party'])).trim();
    if (!rawName) return;
    var name = payCanonicalParty_(rawName);
    var key = rcvKey_(name);
    var rec = parties[key] || (parties[key] = newParty_());
    rec.name = name;
    // Existing opening balances are PHP obligations.
    rec.opening += rcvNum_(rcvField_(p, ['Opening Amount PHP', 'Opening Amount']));
    var asOf = rcvDate_(rcvField_(p, ['As Of Date', 'As Of']));
    if (asOf) rec.asOf = asOf;
    aliasToKey[key] = key;
    aliasToKey[rcvKey_(rawName)] = key;
    String(rcvField_(p, ['Aliases'])).split(/[,;\n]/).forEach(function (a) { var k = rcvKey_(a); if (k) aliasToKey[k] = key; });
  });

  // System aliases work even if the optional Payable Parties tab does not exist.
  ['hive', 'mb', 'moneybees', 'mbhive'].forEach(function (alias) { aliasToKey[alias] = 'hive'; });

  // Pass 1: capture payable charges and settlements, retaining both PHP valuation
  // and the original currency quantity. A linked settlement can inherit the
  // original currency when its own currency fields are blank.
  var entries = [], recordParty = {}, recordCurrency = {};
  (expenseRows || []).forEach(function (row) {
    if (rcvIsVoidedRow_(row)) return;
    var dir = payDirection_(row);
    if (!dir) return;

    var category = String(rcvField_(row, ['Category'])).trim().toLowerCase();
    var description = String(rcvField_(row, ['Description', 'Notes']));
    var rawParty = String(rcvField_(row, PAY_PARTY_FIELDS)).trim() || payCreditorFromText_(description) || payFundedBy_(description);
    var currency = String(rcvField_(row, ['Actual Currency'])).trim().toUpperCase();
    var actualAmount = rcvNum_(rcvField_(row, ['Actual Amount']));
    var receivedCurrency = String(rcvField_(row, ['Received Currency'])).trim().toUpperCase();
    var receivedAmount = rcvNum_(rcvField_(row, ['Received Amount']));
    var isCurrencySale = payIsInterbranchCurrencySale_(row);

    // Foreign-currency Payable entries for an interbranch sale are tracked in
    // their original currency. The PHP equivalent is retained only as valuation.
    var eventCurrency = 'PHP';
    var eventAmount = rcvNum_(rcvField_(row, ['Amount PHP', 'Amount']));
    var phpEquivalent = eventAmount;
    if (isCurrencySale) {
      eventCurrency = currency;
      eventAmount = actualAmount;
      var rate = rcvNum_(rcvField_(row, ['Valuation Rate']));
      phpEquivalent = eventAmount > 0 && rate > 0 ? rcvRound_(eventAmount * rate) : 0;
    } else if (dir === 'paid') {
      // Payable settlements are reduced in the currency actually handed over.
      // Use actual currency/amount first; received currency is a legacy fallback.
      if (currency && currency !== 'PHP' && actualAmount > 0) {
        eventCurrency = currency;
        eventAmount = actualAmount;
        var paidRate = rcvNum_(rcvField_(row, ['Valuation Rate']));
        phpEquivalent = paidRate > 0 ? rcvRound_(eventAmount * paidRate) : 0;
      } else if (receivedCurrency && receivedCurrency !== 'PHP' && receivedAmount > 0) {
        eventCurrency = receivedCurrency;
        eventAmount = receivedAmount;
        phpEquivalent = 0;
      }
    }
    if (!(eventAmount > 0)) return;

    var e = {
      dir: dir,
      amount: eventAmount,
      currency: eventCurrency || 'PHP',
      phpEquivalent: phpEquivalent,
      isCurrencySale: isCurrencySale,
      recordId: String(rcvField_(row, ['Record ID'])).trim(),
      date: rcvDate_(rcvField_(row, ['Official Date', 'Audit Business Date', 'Created At'])),
      party: payCanonicalParty_(rawParty),
      postedBy: String(rcvField_(row, ['Posted By'])).trim(),
      reference: String(rcvField_(row, PAY_REFERENCE_FIELDS)).trim(),
      text: [rcvField_(row, PAY_REFERENCE_FIELDS), description, rcvField_(row, ['Other Category'])].join(' ')
    };
    if (e.dir === 'owed' && !e.party) e.party = e.postedBy; // legacy personal-funds payable rule
    if (e.party && e.recordId) {
      recordParty[e.recordId.toLowerCase()] = e.party;
      if (e.currency !== 'PHP') recordCurrency[e.recordId.toLowerCase()] = e.currency;
    }
    entries.push(e);
  });

  var known = {};
  Object.keys(aliasToKey).forEach(function (k) { known[k] = aliasToKey[k]; });
  entries.forEach(function (e) {
    if (e.dir === 'owed' && e.party) { var k = rcvKey_(e.party); known[k] = aliasToKey[k] || k; }
  });

  // Pass 2: apply each entry to a PHP balance or a specific foreign-currency balance.
  entries.forEach(function (e) {
    var key = '', display = e.party;
    if (e.party) {
      var k0 = rcvKey_(e.party); key = aliasToKey[k0] || k0;
    } else {
      var viaId = e.reference && recordParty[e.reference.toLowerCase()];
      if (viaId) {
        var k1 = rcvKey_(viaId); key = aliasToKey[k1] || k1; display = viaId;
        // If a linked settlement omitted its currency, apply it to the original currency.
        if (e.currency === 'PHP' && recordCurrency[e.reference.toLowerCase()]) {
          e.currency = recordCurrency[e.reference.toLowerCase()];
        }
      } else {
        var m = rcvMatchParty_(e.text, known);
        if (m === 'AMBIGUOUS') { issues.push('Payable settlement ' + e.recordId + ' names more than one party — it was NOT applied.'); return; }
        if (!m) return; // payment from a PSulit fund with no named payable party
        key = m;
      }
    }

    var rec = parties[key] || (parties[key] = newParty_());
    if (key === 'hive' && !rec.name) rec.name = 'Hive';
    if (rec.asOf && e.date && e.date <= rec.asOf) return;

    if (e.currency && e.currency !== 'PHP') {
      var ccy = e.currency.toUpperCase();
      var bucket = rec.currencies[ccy] || (rec.currencies[ccy] = { amount: 0, phpEquivalent: 0, lastDate: '' });
      // A foreign-currency obligation must be settled in the same currency.
      // Do not let a PHP cash settlement silently erase a currency handover.
      var delta = (e.dir === 'owed' ? 1 : -1) * e.amount;
      bucket.amount += delta;
      if (e.dir === 'owed') {
        bucket.phpEquivalent += Math.max(0, e.phpEquivalent || 0);
      } else if (e.phpEquivalent > 0) {
        bucket.phpEquivalent -= e.phpEquivalent;
      } else if (bucket.amount + e.amount > 0.000001 && bucket.phpEquivalent > 0) {
        // No settlement rate was supplied: reduce the valuation proportionally.
        var priorQty = bucket.amount + e.amount;
        bucket.phpEquivalent -= bucket.phpEquivalent * Math.min(1, e.amount / priorQty);
      }
      if (bucket.amount < -0.004) {
        issues.push('Currency settlement ' + e.recordId + ' exceeds the outstanding ' + ccy + ' payable for ' + (rec.name || display || key) + '. Check the handover log.');
      }
      if (e.date > bucket.lastDate) bucket.lastDate = e.date;
    } else {
      rec.balance += (e.dir === 'owed' ? e.amount : -e.amount);
    }
    if (e.date > rec.lastDate) rec.lastDate = e.date;
    if (display) rec.casing[display] = (rec.casing[display] || 0) + 1;
  });

  var out = [];
  Object.keys(parties).forEach(function (key) {
    var rec = parties[key], name = rec.name;
    if (!name) {
      var best = '', bestScore = -1;
      Object.keys(rec.casing).forEach(function (c) {
        var score = rec.casing[c] * 10 + (c === c.toUpperCase() ? 0 : 1);
        if (score > bestScore) { best = c; bestScore = score; }
      });
      name = best || key;
    }

    // Ordinary payables/opening balances remain PHP balances.
    var phpBalance = rcvRound_(rec.opening + rec.balance);
    if (phpBalance > 0.004) out.push({ name: name, amount: phpBalance, currency: 'PHP', lastActivity: rec.lastDate || '' });
    else if (phpBalance < -0.004) issues.push('PSulit has paid ' + name + ' ₱' + Math.abs(phpBalance).toFixed(2) + ' MORE than was owed — check the Expense & Cash Movement log.');

    // Interbranch currency handovers remain quantities, never PHP liabilities.
    Object.keys(rec.currencies || {}).forEach(function (ccy) {
      var bucket = rec.currencies[ccy];
      var qty = rcvRound_(bucket.amount);
      if (qty > 0.004) {
        out.push({
          name: name + ' — ' + ccy,
          partyName: name,
          amount: qty,
          currency: ccy,
          phpEquivalent: rcvRound_(Math.max(0, bucket.phpEquivalent)),
          lastActivity: bucket.lastDate || rec.lastDate || '',
          payableType: 'currency_handover'
        });
      } else if (qty < -0.004) {
        issues.push(name + ' has been handed over ' + Math.abs(qty).toLocaleString() + ' ' + ccy + ' MORE than was owed — check the Expense & Cash Movement log.');
      }
    });
  });
  out.sort(function (a, b) {
    var n = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    return n || String(a.currency || 'PHP').localeCompare(String(b.currency || 'PHP'));
  });
  return { payables: out, issues: issues };
}
// ==== PAYABLES LEDGER (end) =======================================================

function output_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}