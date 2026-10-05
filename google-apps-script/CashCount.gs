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

      sortCashCountSheet_(sheet);
      recolorOperationalSheetsByBusinessDate_(spreadsheet, branch);

      return output_({ ok: true, appended: rowsToAppend.length, duplicates: duplicates, sheet: sheetName, sorted: true });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return output_({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

const BUSINESS_DATE_COLORS = [
  '#EAF2FF', // soft blue
  '#EAF8EE', // soft green
  '#FFF6D9', // soft yellow
  '#F0E8FF', // soft lavender
  '#FFEBDD', // soft peach
  '#FDEAF3', // soft pink
  '#E7F7F7', // soft aqua
  '#F3F0E8', // soft sand
  '#EAF0F8', // soft slate
  '#F2EAF8', // soft lilac
  '#EAF7E8', // soft lime
  '#FFF0E8'  // soft apricot
];

function sortCashCountSheet_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = CASH_COUNT_HEADERS.length;
  if (lastRow < 3) return;

  // Business Date is the primary audit order.
  // Submitted At is the secondary order within each business date.
  // Solaire's 4–5 AM closing remains under the prior business date because
  // the row's Business Date is the prior operating day.
  sheet.getRange(2, 1, lastRow - 1, lastColumn).sort([
    { column: 3, ascending: true },
    { column: 2, ascending: true }
  ]);
}

function recolorAllBusinessDateSheets() {
  const spreadsheet = SpreadsheetApp.openById(CASH_COUNT_SPREADSHEET_ID);
  ['Alphaland', 'Solaire'].forEach(function(branch) {
    recolorOperationalSheetsByBusinessDate_(spreadsheet, branch);
  });
}

function recolorOperationalSheetsByBusinessDate_(spreadsheet, branch) {
  [
    branch + ' Cash Count',
    branch + ' Transactions'
  ].forEach(function(sheetName) {
    const sheet = spreadsheet.getSheetByName(sheetName);
    if (sheet) recolorSheetByBusinessDate_(sheet, branch);
  });
}

function recolorSheetByBusinessDate_(sheet, branch) {
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return;

  const headers = values[0].map(function(value) {
    return String(value || '').trim();
  });

  const lastColumn = Math.max(sheet.getLastColumn(), headers.length);
  const rowAddressesByColor = {};
  const dataStartRow = 2;

  for (let i = 1; i < values.length; i += 1) {
    const businessDate = businessDateFromSheetRow_(headers, values[i], branch);
    if (!businessDate) continue;

    const color = colorForBusinessDate_(businessDate);
    if (!rowAddressesByColor[color]) rowAddressesByColor[color] = [];

    rowAddressesByColor[color].push(
      sheet.getRange(dataStartRow + i - 1, 1, 1, lastColumn).getA1Notation()
    );
  }

  Object.keys(rowAddressesByColor).forEach(function(color) {
    sheet.getRangeList(rowAddressesByColor[color]).setBackground(color);
  });
}

function businessDateFromSheetRow_(headers, row, branch) {
  const directDateHeaders = [
    'Business Date',
    'Date',
    'Transaction Date'
  ];

  for (let i = 0; i < directDateHeaders.length; i += 1) {
    const index = headers.indexOf(directDateHeaders[i]);
    if (index === -1) continue;
    const direct = normalizeBusinessDate_(row[index]);
    if (direct) return direct;
  }

  const timestampHeaders = [
    'Official Timestamp',
    'Submitted At',
    'Timestamp',
    'Created At'
  ];

  for (let i = 0; i < timestampHeaders.length; i += 1) {
    const index = headers.indexOf(timestampHeaders[i]);
    if (index === -1) continue;

    const raw = String(row[index] || '').trim();
    if (!raw) continue;

    const parsed = parseSheetDateTime_(raw);
    if (!parsed) continue;

    if (branch === 'Solaire' && parsed.getHours() < 5) {
      parsed.setDate(parsed.getDate() - 1);
    }

    return Utilities.formatDate(
      parsed,
      Session.getScriptTimeZone() || 'Asia/Manila',
      'yyyy-MM-dd'
    );
  }

  return '';
}

function parseSheetDateTime_(raw) {
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) return parsed;

  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;

  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  const hour = Number(m[4] || 0);
  const minute = Number(m[5] || 0);
  const second = Number(m[6] || 0);

  return new Date(year, month - 1, day, hour, minute, second);
}

function normalizeBusinessDate_(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    return m[3] + '-' + String(m[1]).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0');
  }

  return '';
}

function colorForBusinessDate_(businessDate) {
  const parts = businessDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some(function(value) { return !Number.isFinite(value); })) {
    return BUSINESS_DATE_COLORS[0];
  }

  // Keep the same date -> color mapping across Cash Count and Transactions.
  // Sept 23, 2026 starts the cycle at soft blue.
  const epochDay = Math.floor(Date.UTC(2026, 8, 23) / 86400000);
  const utcDay = Math.floor(Date.UTC(parts[0], parts[1] - 1, parts[2]) / 86400000);
  const index = (((utcDay - epochDay) % BUSINESS_DATE_COLORS.length) + BUSINESS_DATE_COLORS.length) % BUSINESS_DATE_COLORS.length;
  return BUSINESS_DATE_COLORS[index];
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
