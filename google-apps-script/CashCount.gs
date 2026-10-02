// PSULIT Cash Count -> Google Sheets bridge
// Bind/deploy this script for the workbook: PSULIT OPERATIONS APP LOG 2026.
// Set Script Property CASH_COUNT_WEBHOOK_SECRET before deploying the web app.

const CASH_COUNT_SPREADSHEET_ID = '1_msQClr0yfx_jTKeEfop6lnfNvBPd-sNNMkgLnBgsrU';
const CASH_COUNT_HEADERS = [
  'Sync Key',
  'Submitted At',
  'Business Date',
  'Branch',
  'Count Type',
  'Shift',
  'Teller',
  'Reference',
  'Category',
  'Currency',
  'Fund / Account',
  'Amount',
  'PHP Equivalent',
  'Quantity / Units',
  'Notes',
  'Source App'
];

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const expectedSecret = PropertiesService.getScriptProperties().getProperty('CASH_COUNT_WEBHOOK_SECRET');

    if (!expectedSecret) return output_({ ok: false, error: 'CASH_COUNT_WEBHOOK_SECRET is not configured.' });
    if (!payload.secret || payload.secret !== expectedSecret) return output_({ ok: false, error: 'Unauthorized.' });
    if (payload.eventType !== 'CASH_COUNT_SYNC') return output_({ ok: false, error: 'Unsupported event type.' });
    if (payload.spreadsheetId && payload.spreadsheetId !== CASH_COUNT_SPREADSHEET_ID) {
      return output_({ ok: false, error: 'Wrong spreadsheet.' });
    }

    const branch = String(payload.branch || '').trim();
    if (branch !== 'Alphaland' && branch !== 'Solaire') return output_({ ok: false, error: 'Unknown branch.' });

    const incoming = Array.isArray(payload.rows) ? payload.rows : [];
    if (!incoming.length) return output_({ ok: true, appended: 0, duplicates: 0 });

    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const spreadsheet = SpreadsheetApp.openById(CASH_COUNT_SPREADSHEET_ID);
      const sheetName = branch + ' Cash Count';
      const sheet = spreadsheet.getSheetByName(sheetName);
      if (!sheet) throw new Error('Missing worksheet: ' + sheetName);

      ensureHeaders_(sheet);

      const lastRow = sheet.getLastRow();
      const existingKeys = new Set();
      if (lastRow >= 2) {
        sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues().forEach(function(row) {
          const key = String(row[0] || '').trim();
          if (key) existingKeys.add(key);
        });
      }

      const rowsToAppend = [];
      let duplicates = 0;
      incoming.forEach(function(row) {
        const syncKey = String(row && row.syncKey || '').trim();
        if (!syncKey) return;
        if (existingKeys.has(syncKey)) {
          duplicates += 1;
          return;
        }
        existingKeys.add(syncKey);
        rowsToAppend.push([
          safe_(row.syncKey),
          safe_(row.submittedAt),
          safe_(row.businessDate),
          safe_(row.branch),
          safe_(row.countType),
          safe_(row.shift),
          safe_(row.teller),
          safe_(row.reference),
          safe_(row.category),
          safe_(row.currency),
          safe_(row.fundAccount),
          numericOrBlank_(row.amount),
          numericOrBlank_(row.phpEquivalent),
          numericOrBlank_(row.quantityUnits),
          safe_(row.notes),
          safe_(row.sourceApp)
        ]);
      });

      if (rowsToAppend.length) {
        sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, CASH_COUNT_HEADERS.length).setValues(rowsToAppend);
      }

      return output_({ ok: true, appended: rowsToAppend.length, duplicates: duplicates, sheet: sheetName });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return output_({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function ensureHeaders_(sheet) {
  const current = sheet.getRange(1, 1, 1, CASH_COUNT_HEADERS.length).getDisplayValues()[0];
  const blank = current.every(function(value) { return !String(value || '').trim(); });
  if (blank) {
    sheet.getRange(1, 1, 1, CASH_COUNT_HEADERS.length).setValues([CASH_COUNT_HEADERS]);
    sheet.setFrozenRows(1);
    return;
  }

  for (let i = 0; i < CASH_COUNT_HEADERS.length; i += 1) {
    if (String(current[i] || '').trim() !== CASH_COUNT_HEADERS[i]) {
      throw new Error('Unexpected header in column ' + (i + 1) + ': expected "' + CASH_COUNT_HEADERS[i] + '".');
    }
  }
}

function numericOrBlank_(value) {
  if (value === '' || value === null || value === undefined) return '';
  const n = Number(value);
  return Number.isFinite(n) ? n : '';
}

function safe_(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function output_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}


/**
 * Read-only audit endpoint for the PSULIT Audit app.
 *
 * GET parameters:
 *   branch=Alphaland|Solaire
 *   date=YYYY-MM-DD
 *
 * Returns rows from the branch Cash Count, Transactions, and Expense & Cash
 * Movement sheets. The response is intentionally generic so the Audit app can
 * map columns by header name without depending on fixed column positions.
 *
 * Authentication uses the existing CASH_COUNT_WEBHOOK_SECRET property:
 *   ?branch=Alphaland&date=2026-10-01&secret=...
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const expectedSecret = PropertiesService.getScriptProperties().getProperty('CASH_COUNT_WEBHOOK_SECRET');

    if (!expectedSecret) return output_({ ok: false, error: 'CASH_COUNT_WEBHOOK_SECRET is not configured.' });
    if (!params.secret || params.secret !== expectedSecret) return output_({ ok: false, error: 'Unauthorized.' });

    const branch = String(params.branch || '').trim();
    const date = String(params.date || '').trim();

    if (branch !== 'Alphaland' && branch !== 'Solaire') {
      return output_({ ok: false, error: 'Unknown branch.' });
    }
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) {
      return output_({ ok: false, error: 'Invalid date. Use YYYY-MM-DD.' });
    }

    const spreadsheet = SpreadsheetApp.openById(CASH_COUNT_SPREADSHEET_ID);
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

      const headers = values[0].map(function(v) { return String(v || '').trim(); });
      const rows = values.slice(1).map(function(row) {
        const obj = {};
        headers.forEach(function(header, i) {
          if (header) obj[header] = row[i] === undefined ? '' : row[i];
        });
        return obj;
      }).filter(function(row) {
        return rowMatchesDate_(row, date);
      });

      sheets[sheetName] = { headers: headers, rows: rows };
    });

    return output_({
      ok: true,
      source: 'Google Sheets — PSULIT OPERATIONS APP LOG 2026',
      branch: branch,
      date: date,
      sheets: sheets
    });
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return output_({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function rowMatchesDate_(row, date) {
  const candidates = [
    'Business Date',
    'Date',
    'Transaction Date',
    'Submitted At',
    'Timestamp',
    'Created At',
    'Official Timestamp'
  ];

  for (let i = 0; i < candidates.length; i += 1) {
    const key = candidates[i];
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
    const raw = String(row[key] || '').trim();
    if (!raw) continue;

    if (/^\\d{4}-\\d{2}-\\d{2}$/.test(raw) && raw === date) return true;

    const parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) {
      const yyyy = Utilities.formatDate(parsed, Session.getScriptTimeZone() || 'Asia/Manila', 'yyyy-MM-dd');
      if (yyyy === date) return true;
    }

    // Handle common Philippine sheet display formats such as 10/01/2026 09:57:07.
    const m = raw.match(/^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})/);
    if (m) {
      const normalized = m[3] + '-' + String(m[1]).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0');
      if (normalized === date) return true;
    }
  }

  return false;
}
