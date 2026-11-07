# Simple Cash Log (added Nov 2026) — /log.html

Five buttons instead of a category list: Forex · Hive · Scratch It · LottoMatik · Expenses.
The Simple Cash Log is the main page ("/"). The classic form is at "/classic" (link "Classic form" at the top);
the classic form links back here ("☰ Simple Cash Log").

Every button saves the SAME category, fund and fields as the classic form, so the Google Sheet, the Telegram posts and the
daily cash audit work as before. The mapping is in cashlog-simple.js.

Forex (any currency; foreign currency asks for the rate):
  Sell currency to the other branch / Hand over currency → Interbranch page
  Client pickup at the other branch → Receivable (Client pickup at …); settle it with "They pay it back" on the sale day
  Send to / Receive from the other branch → Inter-Branch Transfer OUT / IN
  Currency exchange → Currency Exchange (what was given + what was received)
  Someone borrows / They pay it back (cash or non-cash) → Receivable / Receivable Settlement
  Forex borrows (Hive, or someone else) / Forex pays it back → Hive Out to Forex / Payable "Cash borrowed";
     Hive In from Forex / Payable Settlement
  Move pesos to or from Hive, Scratch It, LottoMatik → Internal Transfer (from fund → Destination Fund)
  Teller shortage → Receivable · Teller Shortage, charged to the teller (pesos; the shortage stays visible on the day)
  Owner collection → Owner Collection
Hive (pesos): Cash in · Cash out · Commission
Scratch It: Card reimbursement from supplier (exchanged for new cards / paid in cash) → Others · Scratch Winning Cards;
  Buy new cards → Others · Scratch Card; Move cash to/from Forex. Winning card payouts stay in the Scratch It app.
LottoMatik: Top-up · Winning ticket payout · Wallet transfer · Move cash to/from Forex
Expenses: Fare · Payroll · Govt contribution · Taxes · Rent · Internet · Business permit · Supplies · Others (specify);
  paid from the Forex drawer unless another fund is chosen.

No database migration and no Google Apps Script change. Deploy with the cash-audit update (it reads the new entry types).
