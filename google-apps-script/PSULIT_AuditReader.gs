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

function output_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
