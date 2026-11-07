const EXPECTED_EVENT = 'EXPENSE_CASH_MOVEMENT_SYNC';
const SECRET_PROPERTY = 'EXPENSE_SHEET_WEBHOOK_SECRET';
const ALLOWED_SPREADSHEET_ID = '1_msQClr0yfx_jTKeEfop6lnfNvBPd-sNNMkgLnBgsrU';
const ALLOWED_SHEETS = new Set([
  'Alphaland Expense & Cash Movement',
  'Solaire Expense & Cash Movement'
]);

const HEADERS = [
  'Sync Key','Created At','Official Date','Branch','Record ID','Posted By','Category','Other Category','Description','Amount PHP',
  'Fund / Drawer','Asset Type','Actual Currency','Actual Amount','Borrower / Company','Valuation Rate','Destination Fund','Transfer Reference',
  'Received Asset Type','Received Currency','Received Amount','Source Branch','Destination Branch','Settlement Method','Receivable Reference',
  'Hive Transaction Reference','Lotto Movement Type','Lotto Source Wallet','Lotto Ticket Number','Lotto Claimant Name','Supporting Document Name',
  'Telegram Status','Telegram Link','Source App','Settlement Type','Settlement Parent Expense ID','Settlement Reference',
  'Settlement Original Amount','Settlement Previous Paid','Settlement Remaining','Settlement Status'
];

function reply_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function rowValues_(r) {
  return [
    r.syncKey || '', r.createdAt || '', r.officialDate || '', r.branch || '', r.recordId || '', r.postedBy || '', r.category || '',
    r.otherCategory || '', r.description || '', r.amountPhp === '' || r.amountPhp == null ? '' : Number(r.amountPhp), r.fundDrawer || '', r.assetType || '', r.actualCurrency || '',
    r.actualAmount === '' || r.actualAmount == null ? '' : Number(r.actualAmount), r.borrowerCompany || '',
    r.valuationRate === '' || r.valuationRate == null ? '' : Number(r.valuationRate), r.destinationFund || '', r.transferReference || '',
    r.receivedAssetType || '', r.receivedCurrency || '', r.receivedAmount === '' || r.receivedAmount == null ? '' : Number(r.receivedAmount),
    r.sourceBranch || '', r.destinationBranch || '', r.settlementMethod || '', r.receivableReference || '', r.hiveTransactionReference || '',
    r.lottoMovementType || '', r.lottoSourceWallet || '', r.lottoTicketNumber || '', r.lottoClaimantName || '', r.supportingDocumentName || '',
    r.telegramStatus || '', r.telegramLink || '', r.sourceApp || 'PSulit Expense / Cash Movement App', r.settlementType || '',
    r.settlementParentExpenseId || '', r.settlementReference || '', r.settlementOriginalAmount == null ? '' : Number(r.settlementOriginalAmount),
    r.settlementPreviousPaid == null ? '' : Number(r.settlementPreviousPaid), r.settlementRemaining == null ? '' : Number(r.settlementRemaining),
    r.settlementStatus || ''
  ];
}

function ensureHeader_(sheet) {
  const current = sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0];
  if (current.join('|') !== HEADERS.join('|')) sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.setFrozenRows(1);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const expectedSecret = PropertiesService.getScriptProperties().getProperty(SECRET_PROPERTY);
    if (!expectedSecret || body.secret !== expectedSecret) return reply_({ ok: false, error: 'Unauthorized' });
    if (body.eventType !== EXPECTED_EVENT) return reply_({ ok: false, error: 'Unsupported event' });
    if (body.spreadsheetId !== ALLOWED_SPREADSHEET_ID) return reply_({ ok: false, error: 'Spreadsheet not allowed' });
    if (!ALLOWED_SHEETS.has(body.sheetName)) return reply_({ ok: false, error: 'Sheet not allowed' });
    if (!body.row || !body.row.syncKey) return reply_({ ok: false, error: 'Missing row or sync key' });

    const ss = SpreadsheetApp.openById(ALLOWED_SPREADSHEET_ID);
    const sheet = ss.getSheetByName(body.sheetName);
    if (!sheet) return reply_({ ok: false, error: 'Target sheet not found' });
    ensureHeader_(sheet);

    const syncKey = String(body.row.syncKey);
    const lastRow = sheet.getLastRow();
    let targetRow = lastRow + 1;
    let action = 'appended';
    if (lastRow >= 2) {
      const keys = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
      const idx = keys.findIndex(r => String(r[0]) === syncKey);
      if (idx >= 0) {
        targetRow = idx + 2;
        action = 'updated';
      }
    }

    sheet.getRange(targetRow, 1, 1, HEADERS.length).setValues([rowValues_(body.row)]);
    return reply_({ ok: true, action, row: targetRow });
  } catch (err) {
    return reply_({ ok: false, error: String(err && err.message ? err.message : err).slice(0, 300) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}
