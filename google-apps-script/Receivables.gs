// PSULIT Cash Count -> automatic receivables (add as a NEW file in the SAME Apps Script project as CashCount.gs)
// File name: Receivables.gs. Needs CashCount.gs in the same project (it uses output_ and CASH_COUNT_SPREADSHEET_ID).
// Also add ONE line to doPost in CashCount.gs, directly after the 'Unauthorized.' check:
//     if (payload.eventType === 'OPEN_RECEIVABLES') return openReceivablesResponse_(payload);

// ==== RECEIVABLES LEDGER (begin) ==================================================
// Open receivables per party, worked out from the branch's "Expense & Cash Movement"
// tab. A receivable stays on the Cash Count until a payment is recorded in that log.
// An optional "Receivable Parties" tab gives: the display name, other spellings
// (Aliases), and an opening balance for amounts that have no log entry.
//   Columns: Branch | Party | Aliases | Opening Amount PHP | As Of Date | Notes
// Amounts are PHP (the log's "Amount PHP" is the peso value of the receivable).
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

function computeOpenReceivables_(branch, expenseRows, partyRows) {
  var parties = {}, aliasToKey = {}, issues = [];
  function newParty_() { return { name: '', opening: 0, asOf: '', balance: 0, lastDate: '', casing: {} }; }
  (partyRows || []).forEach(function (p) {
    var pb = String(rcvField_(p, ['Branch'])).trim().toLowerCase();
    if (pb && pb !== 'all' && pb !== String(branch).toLowerCase()) return;
    var name = String(rcvField_(p, ['Party'])).trim();
    if (!name) return;
    var key = rcvKey_(name);
    var rec = parties[key] || (parties[key] = newParty_());
    rec.name = name;
    rec.opening += rcvNum_(rcvField_(p, ['Opening Amount PHP', 'Opening Amount']));
    var asOf = rcvDate_(rcvField_(p, ['As Of Date', 'As Of']));
    if (asOf) rec.asOf = asOf;
    aliasToKey[key] = key;
    String(rcvField_(p, ['Aliases'])).split(/[,;\n]/).forEach(function (a) { var k = rcvKey_(a); if (k) aliasToKey[k] = key; });
  });

  // Pass 1: read every receivable-type entry.
  var entries = [], recordBorrower = {};
  (expenseRows || []).forEach(function (row) {
    var dir = rcvDirection_(row);
    if (!dir) return;
    var amount = rcvNum_(rcvField_(row, ['Amount PHP', 'Amount']));
    if (!(amount > 0)) return;
    var e = {
      dir: dir, amount: amount,
      recordId: String(rcvField_(row, ['Record ID'])).trim(),
      date: rcvDate_(rcvField_(row, ['Official Date', 'Audit Business Date', 'Created At'])),
      borrower: String(rcvField_(row, ['Borrower / Company', 'Borrower'])).trim(),
      reference: String(rcvField_(row, ['Receivable Reference'])).trim(),
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
      if (viaId) { var k1 = rcvKey_(viaId); key = aliasToKey[k1] || k1; display = viaId; }
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

function openReceivablesResponse_(payload) {
  if (payload.spreadsheetId && payload.spreadsheetId !== CASH_COUNT_SPREADSHEET_ID) return output_({ ok: false, error: 'Wrong spreadsheet.' });
  var branch = String(payload.branch || '').trim();
  if (branch !== 'Alphaland' && branch !== 'Solaire') return output_({ ok: false, error: 'Unknown branch.' });
  var spreadsheet = SpreadsheetApp.openById(CASH_COUNT_SPREADSHEET_ID);
  var expense = rcvReadTab_(spreadsheet, branch + ' Expense & Cash Movement');
  if (expense.missing) return output_({ ok: false, error: 'Expense & Cash Movement tab not found for ' + branch + '.' });
  var parties = rcvReadTab_(spreadsheet, RCV_PARTIES_SHEET);
  var result = computeOpenReceivables_(branch, expense.rows, parties.rows);
  if (parties.missing) result.issues.push('The "' + RCV_PARTIES_SHEET + '" tab was not found, so names, aliases and opening balances were not applied.');
  return output_({ ok: true, branch: branch, receivables: result.receivables, issues: result.issues, rowsRead: expense.rows.length });
}
// ==== RECEIVABLES LEDGER (end) ====================================================
