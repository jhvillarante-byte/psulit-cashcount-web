/**
 * ONE-TIME REPAIR: correct PHP-equivalent values in both Expense & Cash Movement tabs.
 *
 * For rows with Actual Currency != PHP and valid Actual Amount + Valuation Rate,
 * set Amount PHP = round(Actual Amount * Valuation Rate, 2).
 *
 * Does not change Actual Currency, Actual Amount, Valuation Rate, descriptions,
 * party names, or transaction references. Logs every changed row.
 *
 * Review the execution log after running repairForeignCurrencyAmountPhp().
 */
const PSULIT_REPAIR_SPREADSHEET_ID = '1_msQClr0yfx_jTKeEfop6lnfNvBPd-sNNMkgLnBgsrU';

function repairForeignCurrencyAmountPhp() {
  const ss = SpreadsheetApp.openById(PSULIT_REPAIR_SPREADSHEET_ID);
  const tabs = ['Alphaland Expense & Cash Movement', 'Solaire Expense & Cash Movement'];
  const changes = [];

  tabs.forEach(function(tabName) {
    const sh = ss.getSheetByName(tabName);
    if (!sh) {
      changes.push({ tab: tabName, status: 'MISSING TAB' });
      return;
    }

    const values = sh.getDataRange().getValues();
    if (values.length < 2) return;
    const headers = values[0].map(function(v) { return String(v || '').trim().toLowerCase(); });
    function col(name) { return headers.indexOf(name.toLowerCase()); }

    const phpCol = col('Amount PHP');
    const currencyCol = col('Actual Currency');
    const amountCol = col('Actual Amount');
    const rateCol = col('Valuation Rate');
    const idCol = col('Record ID');

    if ([phpCol, currencyCol, amountCol, rateCol].some(function(i) { return i < 0; })) {
      changes.push({ tab: tabName, status: 'REQUIRED COLUMNS MISSING', headers: headers });
      return;
    }

    let changed = 0;
    for (let r = 1; r < values.length; r++) {
      const currency = String(values[r][currencyCol] || '').trim().toUpperCase();
      const actualAmount = Number(values[r][amountCol]);
      const rate = Number(values[r][rateCol]);
      if (!currency || currency === 'PHP' || !Number.isFinite(actualAmount) ||
          !Number.isFinite(rate) || actualAmount <= 0 || rate <= 0) continue;

      const correctPhp = Math.round((actualAmount * rate + Number.EPSILON) * 100) / 100;
      const currentPhp = Number(values[r][phpCol]);
      if (Number.isFinite(currentPhp) && Math.abs(currentPhp - correctPhp) < 0.005) continue;

      sh.getRange(r + 1, phpCol + 1).setValue(correctPhp);
      changed++;
      changes.push({
        tab: tabName,
        sheetRow: r + 1,
        recordId: idCol >= 0 ? String(values[r][idCol] || '') : '',
        currency: currency,
        actualAmount: actualAmount,
        valuationRate: rate,
        oldAmountPhp: values[r][phpCol],
        correctedAmountPhp: correctPhp
      });
    }
    changes.push({ tab: tabName, status: 'DONE', correctedRows: changed });
  });

  console.log(JSON.stringify(changes, null, 2));
  return changes;
}
