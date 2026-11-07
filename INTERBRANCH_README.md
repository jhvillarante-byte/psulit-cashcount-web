# Interbranch currency sale (added Nov 1, 2026)

For when one PSulit branch sells foreign currency to the other: the pesos are paid at the time of the sale
(the SELL and BUY are entered in the Transaction app as usual), the currencies are handed over later.

## For tellers
Open the Cash Log and tap "⇄ Interbranch currency" (bottom-left), or go to /interbranch.html.
1. New sale: choose the selling branch, enter both AR numbers, each currency with amount and rate, attach the
   photo of the acknowledgement receipt, Review, Save. One post goes to each branch's Expense topic.
2. Hand over: tick the currencies that physically moved (partial amounts are fine), enter the REAL time they
   moved (earlier than now if needed — the audit uses it), Record handover. What is still owed stays on the list.
Never post these by hand in Telegram: a hand-typed post does not reach the sheet, so the audit cannot see it.

## What it writes (per currency, in each branch's "Expense & Cash Movement" sheet)
- Seller: Payable (Forex Drawer, Actual Currency/Amount, Borrower "PSULIT <buyer>", Transfer Reference IBX-...).
- Buyer:  Receivable (same, Borrower "PSULIT <seller>").
- Handover: Payable Settlement (seller) + Receivable Settlement (buyer), linked to the originals,
  Created At = the handover time.
Amounts are in the currency's own units (as the app already stored currency rows); the rate and peso value are in
the Valuation Rate column, the description and the Telegram post.

## Deploying
No database migration and no change to the Google Apps Script are needed; same environment variables.
    npm install && netlify link --name psulit-expense && netlify deploy --prod --dir .
Deploy the cash-audit update (psulit-cash-audit-questions.zip) too: it reads these rows.
