/* PSulit Cash Log — simplified entry: what each button saves.
 * Every button writes the SAME category / fund / fields as the classic form, so the Google Sheet and the daily cash
 * audit read it exactly as before. Used by log.html (and by the tests).
 */
(function (root) {
  "use strict";
  const BRANCHES = ["Alphaland", "Solaire"];
  const other = (b) => (b === "Alphaland" ? "Solaire" : "Alphaland");
  const label = (b) => `PSULIT ${String(b).toUpperCase()}`;
  const r2 = (n) => Math.round(n * 100) / 100;
  const num = (t) => { const v = Number(String(t ?? "").replace(/,/g, "").trim()); return Number.isFinite(v) ? v : NaN; };
  const fail = (m) => { const e = new Error(m); e.userError = true; throw e; };
  const req = (v, name) => { const t = String(v ?? "").trim(); if (!t) fail(`Enter ${name}.`); return t; };
  const note = (v) => { const t = String(v ?? "").trim(); return t ? ` — ${t}` : ""; };
  const CCY = /^[A-Z]{3}$/;

  // An amount in any currency. Foreign currency needs the rate, so the peso value is known.
  function money(m, phpOnly, what = "the amount") {
    m = m || {};
    const ccy = phpOnly ? "PHP" : String(m.ccy || "PHP").trim().toUpperCase();
    if (!CCY.test(ccy)) fail("Choose a currency.");
    const amt = num(m.amt);
    if (!(amt > 0) || Math.abs(amt * 100 - Math.round(amt * 100)) > 1e-6) fail(`Enter ${what} (more than 0, at most 2 decimals).`);
    if (ccy === "PHP") return { ccy, amt, rate: null, php: r2(amt) };
    const rate = num(m.rate);
    if (!(rate > 0)) fail(`Enter the rate for ${ccy} (pesos per 1 ${ccy}).`);
    return { ccy, amt, rate, php: r2(amt * rate) };
  }
  const moneyUnvalued = (m, what = "the amount") => {
    m = m || {};
    const ccy = String(m.ccy || "PHP").trim().toUpperCase();
    if (!CCY.test(ccy)) fail("Choose a currency.");
    const amt = num(m.amt);
    if (!(amt > 0) || Math.abs(amt * 100 - Math.round(amt * 100)) > 1e-6) fail(`Enter ${what} (more than 0, at most 2 decimals).`);
    return { ccy, amt, rate: null, php: null };
  };
  const moneyFields = (x) => ({ actualCurrency: x.ccy, actualAmount: String(x.amt), amount: x.php == null ? "" : String(x.php), valuationRate: x.rate == null ? "" : String(x.rate) });
  const FX = { fundDrawerUsed: "Forex Drawer", assetType: "Physical Cash" };
  const fmt = (n) => Number(n).toLocaleString("en-PH", { maximumFractionDigits: 2 });

  // Paying back an open receivable / payable, in the debt's own currency. The app tracks what is left in the debt's
  // "Amount PHP" units, so the part paid is converted with the debt's own ratio, and the last payment clears it exactly.
  function payback(parent, v, settleCategory) {
    if (!parent || !parent.expenseId) fail("Choose which one is being paid back.");
    const method = v.method === "noncash" ? "Offset / Non-Cash" : "Cash Received";
    const units = Number(parent.settlementOriginalAmountCentavos ?? parent.amountCentavos) / 100;
    const ccy = String(parent.actualCurrency || "PHP").toUpperCase();
    const actual = Number(parent.actualAmount) > 0 ? Number(parent.actualAmount) : units;
    const ratio = units / actual;                       // "Amount PHP" units per 1 unit of the currency
    const leftUnits = Number(parent.settlementRemainingCentavos) / 100;
    const leftActual = r2(leftUnits / ratio);
    let paid = num(v.amt);
    if (!(paid > 0)) fail("Enter the amount paid back.");
    if (paid > leftActual + 0.005) fail(`Only ${fmt(leftActual)} ${ccy} is still owed.`);
    let units2 = r2(paid * ratio);
    if (paid >= leftActual - 0.005) { paid = leftActual; units2 = leftUnits; }   // the final payment clears it exactly
    units2 = Math.min(units2, leftUnits);
    const fund = method === "Offset / Non-Cash" ? { fundDrawerUsed: "External / No PSulit Fund", assetType: "Accounting Balance" }
      : { fundDrawerUsed: /^(Forex Drawer|Scratch|Lottomatik|LottoMatik|Hive|JuanPay)$/i.test(String(parent.fundDrawerUsed || "")) ? parent.fundDrawerUsed : "Forex Drawer", assetType: "Physical Cash" };
    return {
      category: settleCategory, ...fund,
      actualCurrency: ccy, actualAmount: String(paid), amount: String(units2),
      valuationRate: parent.valuationRate == null ? "" : String(parent.valuationRate),
      settlementParentExpenseId: parent.expenseId,
      receivableReference: String(parent.receivableReference || parent.transferReference || parent.expenseId),
      settlementMethod: method,
      borrowerCompany: parent.borrowerCompany || ""
    };
  }

  const FUNDS_MOVE = [["Scratch", "Scratch It"], ["LottoMatik", "LottoMatik"], ["Hive", "Hive"]];
  const EXPENSE_FUNDS = [["Forex Drawer", "Forex Drawer"], ["Scratch", "Scratch"], ["Lottomatik", "LottoMatik"], ["Hive", "Hive"], ["JuanPay", "JuanPay"], ["External / No PSulit Fund", "Outside PSulit funds"]];
  function moveFields(v, fixedFund) {
    const fund = fixedFund || req(v.fund, "which fund");
    if (!FUNDS_MOVE.some(([f]) => f === fund)) fail("Choose Scratch It, LottoMatik or Hive.");
    const x = money({ ccy: "PHP", amt: v.amt }, true);
    const toForex = v.direction === "toForex";
    const from = toForex ? fund : "Forex Drawer", to = toForex ? "Forex Drawer" : fund;
    return { category: "Internal Transfer", fundDrawerUsed: from, assetType: "Physical Cash", destinationFund: to, receivedAssetType: "Physical Cash", ...moneyFields(x), description: `Moved ₱${fmt(x.amt)} from ${from} to ${to}${note(v.note)}` };
  }

  function fundBorrowActions(currentFund) {
    const funds = [["Forex Drawer", "Forex"], ["Hive", "Hive"], ["Scratch", "Scratch It"], ["LottoMatik", "LottoMatik"]]
      .filter(([fund]) => fund !== currentFund);
    return [
      { id: `borrow-${currentFund.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, label: "Borrow cash",
        inputs: [
          { t: "select", id: "from", label: "Borrowed from", options: [...funds, ["other", "Person or company"]], required: true },
          { t: "text", id: "who", label: "Person / company name", when: { from: "other" }, required: true },
          { t: "money", norate: true, when: { from: funds[0]?.[0] } },
          ...funds.slice(1).map(([fund]) => ({ t: "money", norate: true, when: { from: fund } })),
          { t: "money", when: { from: "other" } },
          { t: "text", id: "purpose", label: "What it is for", required: true }
        ],
        build: (v) => {
          const purpose = req(v.purpose, "what it is for");
          if (funds.some(([fund]) => fund === v.from)) {
            const x = moneyUnvalued(v.m);
            return { category: "Internal Transfer", fundDrawerUsed: v.from, assetType: "Physical Cash", destinationFund: currentFund, receivedAssetType: "Physical Cash", ...moneyFields(x),
              description: `${currentFund} borrowed ${fmt(x.amt)} ${x.ccy} from ${v.from}: ${purpose}` };
          }
          if (v.from !== "other") fail("Choose where the cash was borrowed from.");
          const who = req(v.who, "the person or company name"), x = money(v.m);
          return { category: "Payable", otherCategory: "Cash borrowed", fundDrawerUsed: currentFund, assetType: "Physical Cash", ...moneyFields(x), borrowerCompany: who,
            description: `${currentFund} borrowed ${fmt(x.amt)} ${x.ccy} from ${who}: ${purpose}` };
        } },
      { id: `return-${currentFund.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, label: "Return borrowed cash",
        inputs: [
          { t: "select", id: "to", label: "Returning to", options: [...funds, ["other", "Person or company"]], required: true },
          { t: "money", norate: true, when: { to: funds[0]?.[0] } },
          ...funds.slice(1).map(([fund]) => ({ t: "money", norate: true, when: { to: fund } })),
          { t: "open", category: "Payable", when: { to: "other" } },
          { t: "method", when: { to: "other" } },
          { t: "payamt", when: { to: "other" } },
          { t: "text", id: "note", label: "Note (optional)" }
        ],
        build: (v, c) => {
          if (funds.some(([fund]) => fund === v.to)) {
            const x = moneyUnvalued(v.m);
            return { category: "Internal Transfer", fundDrawerUsed: currentFund, assetType: "Physical Cash", destinationFund: v.to, receivedAssetType: "Physical Cash", ...moneyFields(x),
              description: `${currentFund} returned ${fmt(x.amt)} ${x.ccy} to ${v.to}${note(v.note)}` };
          }
          if (v.to !== "other") fail("Choose who is receiving the repayment.");
          const f = payback(c.parent, v, "Payable Settlement");
          return { ...f, description: `${currentFund} paid back ${c.parent.borrowerCompany || "the lender"}${note(v.note)}` };
        } }
    ];
  }

  const GROUPS = [
    { id: "forex", label: "Forex", color: "#2D8BD8", actions: [
      { id: "fx-ib-sale", label: "Sell currency to the other branch", link: "/interbranch.html" },
      { id: "fx-ib-hand", label: "Hand over currency to the other branch", link: "/interbranch.html#hand" },
      { id: "fx-pickup", label: "Send currency for a client pickup at the other branch", inputs: [{ t: "money" }, { t: "text", id: "client", label: "Client name (optional)" }, { t: "text", id: "note", label: "Note (optional)" }],
        build: (v, c) => { const x = money(v.m); return { category: "Receivable", otherCategory: `Client pickup at ${c.other}`, ...FX, ...moneyFields(x), borrowerCompany: label(c.other), description: `Sent to ${c.other} for a client to pick up${v.client ? ": " + String(v.client).trim() : ""}. The sale will be entered at ${c.branch}${note(v.note)}` }; } },
      { id: "fx-send", label: "Send to the other branch", inputs: [{ t: "money" }, { t: "text", id: "ref", label: "Reference (optional)" }, { t: "text", id: "note", label: "Note (optional)" }],
        build: (v, c) => { const x = money(v.m); return { category: "Inter-Branch Transfer OUT", ...FX, ...moneyFields(x), destinationFund: "Forex Drawer", receivedAssetType: "Physical Cash", transferReference: String(v.ref || "").trim(), sourceBranch: c.branch, destinationBranch: c.other, description: `Sent to PSulit ${c.other}${note(v.note)}` }; } },
      { id: "fx-receive", label: "Receive from the other branch", inputs: [{ t: "money" }, { t: "text", id: "ref", label: "Reference (optional)" }, { t: "text", id: "note", label: "Note (optional)" }],
        build: (v, c) => { const x = money(v.m); return { category: "Inter-Branch Transfer IN", ...FX, ...moneyFields(x), destinationFund: "Forex Drawer", receivedAssetType: "Physical Cash", transferReference: String(v.ref || "").trim(), sourceBranch: c.other, destinationBranch: c.branch, description: `Received from PSulit ${c.other}${note(v.note)}` }; } },
      { id: "fx-exchange", label: "Currency exchange", inputs: [{ t: "money", id: "give", label: "We gave", norate: true }, { t: "money", id: "get", label: "We received", norate: true }, { t: "text", id: "pesoValue", label: "Peso value (only if neither side is PHP)" }, { t: "text", id: "who", label: "Exchanged with", required: true }, { t: "text", id: "note", label: "Note (optional)" }],
        build: (v) => {
          const give = { ccy: String(v.give?.ccy || "PHP").toUpperCase(), amt: num(v.give?.amt) }, get = { ccy: String(v.get?.ccy || "PHP").toUpperCase(), amt: num(v.get?.amt) };
          if (!CCY.test(give.ccy) || !CCY.test(get.ccy)) fail("Choose both currencies.");
          if (give.ccy === get.ccy) fail("The two currencies must be different.");
          if (!(give.amt > 0) || !(get.amt > 0)) fail("Enter both amounts.");
          const php = give.ccy === "PHP" ? give.amt : get.ccy === "PHP" ? get.amt : num(v.pesoValue);
          if (!(php > 0)) fail("Enter the peso value of the exchange.");
          const who = req(v.who, "who the exchange was with");
          return { category: "Currency Exchange", ...FX, actualCurrency: give.ccy, actualAmount: String(give.amt), amount: String(r2(php)), valuationRate: give.ccy === "PHP" ? "" : String(r2(php / give.amt * 1e6) / 1e6), receivedCurrency: get.ccy, receivedAmount: String(get.amt), receivedAssetType: "Physical Cash", destinationFund: "Forex Drawer", borrowerCompany: who, description: `Gave ${fmt(give.amt)} ${give.ccy}, received ${fmt(get.amt)} ${get.ccy} — with ${who}${note(v.note)}` };
        } },
      { id: "fx-lend", label: "Someone borrows from Forex", inputs: [{ t: "text", id: "who", label: "Who is borrowing", required: true }, { t: "money" }, { t: "text", id: "purpose", label: "What it is for", required: true }],
        build: (v) => { const who = req(v.who, "who is borrowing"), purpose = req(v.purpose, "what it is for"), x = money(v.m); return { category: "Receivable", ...FX, ...moneyFields(x), borrowerCompany: who, description: `Borrowed by ${who}: ${purpose}` }; } },
      { id: "fx-lend-back", label: "They pay it back", inputs: [{ t: "open", category: "Receivable" }, { t: "method" }, { t: "payamt" }, { t: "text", id: "note", label: "Note (optional)" }],
        build: (v, c) => { const f = payback(c.parent, v, "Receivable Settlement"); return { ...f, description: `Paid back by ${c.parent.borrowerCompany || "the borrower"}${f.settlementMethod === "Offset / Non-Cash" ? " (non-cash)" : ""}${note(v.note)}` }; } },
      { id: "fx-borrow", label: "Forex borrows cash", inputs: [
          { t: "select", id: "from", label: "Borrowed from", options: [["Hive", "Hive"], ["Scratch", "Scratch It"], ["LottoMatik", "LottoMatik"], ["other", "Person or company"]], required: true },
          { t: "text", id: "who", label: "Person / company name", when: { from: "other" }, required: true },
          { t: "money", id: "m", label: "Amount", norate: true, when: { from: "Hive" } },
          { t: "money", id: "m", label: "Amount", norate: true, when: { from: "Scratch" } },
          { t: "money", id: "m", label: "Amount", norate: true, when: { from: "LottoMatik" } },
          { t: "money", id: "m", label: "Amount", when: { from: "other" } },
          { t: "text", id: "purpose", label: "What it is for", required: true }
        ],
        build: (v) => {
          const purpose = req(v.purpose, "what it is for");
          if (["Hive", "Scratch", "LottoMatik"].includes(v.from)) {
            const x = moneyUnvalued(v.m);
            return { category: "Internal Transfer", fundDrawerUsed: v.from, assetType: "Physical Cash", destinationFund: "Forex Drawer", receivedAssetType: "Physical Cash", ...moneyFields(x),
              description: `Forex borrowed ${fmt(x.amt)} ${x.ccy} from ${v.from}: ${purpose}` };
          }
          if (v.from !== "other") fail("Choose where the cash was borrowed from.");
          const who = req(v.who, "the person or company name"), x = money(v.m);
          return { category: "Payable", otherCategory: "Cash borrowed", ...FX, ...moneyFields(x), borrowerCompany: who, description: `Forex borrowed ${fmt(x.amt)} ${x.ccy} from ${who}: ${purpose}` };
        } },
      { id: "fx-borrow-back", label: "Forex returns borrowed cash", inputs: [
          { t: "select", id: "to", label: "Returning to", options: [["Hive", "Hive"], ["Scratch", "Scratch It"], ["LottoMatik", "LottoMatik"], ["other", "Person or company"]], required: true },
          { t: "open", category: "Payable", when: { to: "other" } },
          { t: "method", when: { to: "other" } },
          { t: "payamt", when: { to: "other" } },
          { t: "money", norate: true, when: { to: "Hive" } },
          { t: "money", norate: true, when: { to: "Scratch" } },
          { t: "money", norate: true, when: { to: "LottoMatik" } },
          { t: "text", id: "note", label: "Note (optional)" }
        ],
        build: (v, c) => {
          if (["Hive", "Scratch", "LottoMatik"].includes(v.to)) {
            const x = moneyUnvalued(v.m);
            return { category: "Internal Transfer", fundDrawerUsed: "Forex Drawer", assetType: "Physical Cash", destinationFund: v.to, receivedAssetType: "Physical Cash", ...moneyFields(x),
              description: `Forex returned ${fmt(x.amt)} ${x.ccy} to ${v.to}${note(v.note)}` };
          }
          if (v.to !== "other") fail("Choose who Forex is paying back.");
          const f = payback(c.parent, v, "Payable Settlement");
          return { ...f, description: `Forex paid back ${c.parent.borrowerCompany || "the lender"}${note(v.note)}` };
        } },
      { id: "fx-shortage", label: "Teller shortage (charge to the teller)", inputs: [{ t: "text", id: "who", label: "Teller charged", required: true }, { t: "money", phpOnly: true, label: "Amount charged (pesos)" }, { t: "text", id: "what", label: "What was short (optional)", placeholder: "e.g. 30 AUD" }, { t: "text", id: "note", label: "Note (optional)" }],
        build: (v) => { const who = req(v.who, "the teller charged"), x = money(v.m, true, "the amount charged"); const what = String(v.what || "").trim(); return { category: "Receivable", otherCategory: "Teller Shortage", ...FX, ...moneyFields(x), borrowerCompany: who, description: `Shortage charged to ${who}${what ? ": " + what + " short" : ""}${note(v.note)}` }; } },
      { id: "fx-owner", label: "Owner collection", inputs: [{ t: "text", id: "who", label: "Collected by", value: "Jen Villarante", required: true }, { t: "money" }, { t: "text", id: "note", label: "Note (optional)" }],
        build: (v) => { const who = req(v.who, "who collected it"), x = money(v.m); return { category: "Owner Collection", ...FX, ...moneyFields(x), borrowerCompany: who, description: `Collected by ${who}${note(v.note)}` }; } },
      { id: "fx-owner-fund", label: "Owner additional fund", inputs: [{ t: "text", id: "who", label: "Funded by", value: "Jen Villarante", required: true }, { t: "money" }, { t: "text", id: "note", label: "Note (optional)" }],
        build: (v) => { const who = req(v.who, "who provided the additional fund"), x = money(v.m); return { category: "Owner Additional Fund", ...FX, ...moneyFields(x), borrowerCompany: who, description: `Additional fund provided by ${who}${note(v.note)}` }; } }
    ] },
    { id: "hive", label: "Hive", color: "#C8A400", actions: [
      { id: "hv-in", label: "Cash in", inputs: [{ t: "money", norate: true }, { t: "text", id: "ref", label: "Hive transaction / invoice reference", required: true }, { t: "text", id: "desc", label: "Description", required: true }],
        build: (v) => { const x = moneyUnvalued(v.m); return { category: "Hive In", fundDrawerUsed: "Hive", assetType: "Physical Cash", ...moneyFields(x), hiveTransactionReference: req(v.ref, "the Hive reference").toUpperCase(), description: req(v.desc, "a description") }; } },
      { id: "hv-out", label: "Cash out", inputs: [{ t: "money", norate: true }, { t: "text", id: "ref", label: "Hive transaction / invoice reference", required: true }, { t: "text", id: "desc", label: "Description", required: true }],
        build: (v) => { const x = moneyUnvalued(v.m); return { category: "Hive Out", fundDrawerUsed: "Hive", assetType: "Physical Cash", ...moneyFields(x), hiveTransactionReference: req(v.ref, "the Hive reference").toUpperCase(), description: req(v.desc, "a description") }; } },
      { id: "hv-comm", label: "Commission", inputs: [{ t: "money", norate: true }, { t: "text", id: "desc", label: "Which month", placeholder: "e.g. Commission for Oct 2026", required: true }],
        build: (v) => { const x = moneyUnvalued(v.m); return { category: "Hive Commission", fundDrawerUsed: "Hive", assetType: "Physical Cash", destinationFund: "Forex Drawer", ...moneyFields(x), description: req(v.desc, "which month") }; } },
      ...fundBorrowActions("Hive")
    ] },
    { id: "scratch", label: "Scratch It", color: "#6754C5", actions: [
      { id: "sc-payout", label: "Winning card payout", info: "Winning card payouts are entered in the Scratch It app, as usual. Its records already feed the daily audit, so entering them here too would count them twice." },
      { id: "sc-reimb", label: "Card reimbursement from supplier", inputs: [{ t: "select", id: "how", label: "How the supplier reimbursed", options: [["exchange", "Exchanged for new cards (no cash)"], ["cash", "Paid in cash"]], required: true }, { t: "cards" }, { t: "text", id: "note", label: "Note (optional)" }],
        build: (v) => {
          const parts = [["Go Banana", "GB"], ["Red Hot 7", "RH"], ["Go For Gold", "GFG"]].map(([n, k]) => ({ n, k, a: num(v.cards?.[k] || 0) }));
          if (parts.some(p => !(p.a >= 0))) fail("Enter the winning-card amounts in pesos.");
          const total = r2(parts.reduce((t, p) => t + p.a, 0));
          if (!(total > 0)) fail("Enter the winning-card amounts in pesos.");
          if (v.how !== "exchange" && v.how !== "cash") fail("Choose how the supplier reimbursed.");
          const list = parts.filter(p => p.a > 0).map(p => `${p.k} ₱${fmt(p.a)}`).join(" · ");
          return { category: "Others", otherCategory: "Scratch Winning Cards", fundDrawerUsed: "Scratch", assetType: v.how === "exchange" ? "Inventory Face Value" : "Physical Cash", actualCurrency: "PHP", actualAmount: String(total), amount: String(total),
            description: `Winning cards returned to the supplier: ${list} — ${v.how === "exchange" ? "exchanged for new cards" : "reimbursed in cash (refund)"}${note(v.note)}` };
        } },
      { id: "sc-buy", label: "Buy new cards from supplier", inputs: [{ t: "money", phpOnly: true }, { t: "text", id: "desc", label: "Cards bought", placeholder: "e.g. 5 Go Banana, 2 Red Hot", required: true }],
        build: (v) => { const x = money(v.m, true); return { category: "Others", otherCategory: "Scratch Card", fundDrawerUsed: "Scratch", assetType: "Physical Cash", ...moneyFields(x), description: `Bought cards from the supplier: ${req(v.desc, "the cards bought")}` }; } },
      ...fundBorrowActions("Scratch")
    ] },
    { id: "lotto", label: "LottoMatik", color: "#C0392B", actions: [
      { id: "lm-topup", label: "Top-up (from the cash drawer)", inputs: [{ t: "money", phpOnly: true }, { t: "text", id: "note", label: "Note (optional)" }],
        build: (v) => { const x = money(v.m, true); return { category: "LottoMatik Cash Movement", lottoMovementType: "LottoMatik Top-Up", lottoSourceWallet: "Cash Drawer", fundDrawerUsed: "LottoMatik", assetType: "Physical Cash", ...moneyFields(x), description: `LottoMatik top-up${note(v.note)}` }; } },
      { id: "lm-payout", label: "Winning ticket payout", inputs: [{ t: "money", phpOnly: true }, { t: "text", id: "ticket", label: "Ticket number", required: true }, { t: "text", id: "claimant", label: "Claimant name", required: true }, { t: "text", id: "game", label: "Game (optional)", placeholder: "e.g. 6/45" }],
        build: (v) => { const x = money(v.m, true); return { category: "LottoMatik Cash Movement", lottoMovementType: "Winning Ticket Payout", lottoTicketNumber: req(v.ticket, "the ticket number"), lottoClaimantName: req(v.claimant, "the claimant's name"), fundDrawerUsed: "LottoMatik", assetType: "Physical Cash", ...moneyFields(x), description: `Winning ticket payout${v.game ? " " + String(v.game).trim() : ""}` }; } },
      { id: "lm-wallet", label: "Wallet transfer (to the play wallet)", inputs: [{ t: "select", id: "wallet", label: "From", options: [["Commission Wallet", "Commission wallet"], ["Payout Wallet", "Pay-out wallet"]], required: true }, { t: "money", phpOnly: true }, { t: "text", id: "note", label: "Note (optional)" }],
        build: (v) => { if (!/^(Commission|Payout) Wallet$/.test(v.wallet || "")) fail("Choose which wallet."); const x = money(v.m, true); return { category: "LottoMatik Cash Movement", lottoMovementType: "LottoMatik Top-Up", lottoSourceWallet: v.wallet, fundDrawerUsed: "LottoMatik", assetType: "Wallet Balance", ...moneyFields(x), description: `Transfer ${v.wallet} to Play Wallet${note(v.note)}` }; } },
      ...fundBorrowActions("LottoMatik")
    ] },
    { id: "expenses", label: "Expenses", color: "#08783f", actions: [
      ...[["ex-fare", "Fare / transport", "Fare"], ["ex-payroll", "Payroll", "Payroll"], ["ex-govt", "Govt contribution (SSS, PhilHealth, Pag-IBIG)", "Govt Contribution"], ["ex-taxes", "Taxes", "Taxes"], ["ex-rent", "Rent", "Rent"], ["ex-internet", "Internet", "Internet"], ["ex-permit", "Business permit", "Others", "Business Permit"], ["ex-supplies", "Supplies", "Others", "Supplies"], ["ex-others", "Others (specify)", "Others", null]].map(([id, lab, cat, oc]) => ({
        id, label: lab, inputs: [...(oc === null ? [{ t: "text", id: "specify", label: "What expense", required: true }] : []), { t: "money", phpOnly: true }, { t: "select", id: "fund", label: "Paid from", options: EXPENSE_FUNDS, value: "Forex Drawer", required: true }, { t: "text", id: "desc", label: "Description", required: true }],
        build: (v) => { const x = money(v.m, true); const fund = EXPENSE_FUNDS.some(([f]) => f === v.fund) ? v.fund : "Forex Drawer"; return { category: cat, otherCategory: oc === null ? req(v.specify, "what the expense is") : (oc || ""), fundDrawerUsed: fund, assetType: "Physical Cash", ...moneyFields(x), description: req(v.desc, "a description") }; }
      }))
    ] }
  ];

  const ACTIONS = {}; for (const g of GROUPS) for (const a of g.actions) ACTIONS[a.id] = { ...a, group: g.id, groupLabel: g.label };

  // The form fields to POST to /api/expenses (the receipt photo and PIN are added by the page).
  function build(actionId, values, ctx) {
    const a = ACTIONS[actionId];
    if (!a || !a.build) fail("Unknown entry type.");
    if (!BRANCHES.includes(ctx?.branch)) fail("Choose the branch first.");
    const c = { ...ctx, other: other(ctx.branch) };
    const f = a.build(values || {}, c);
    const out = { branch: ctx.branch };
    for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== null && String(v) !== "") out[k] = String(v);
    const unvaluedHive = ["Hive In", "Hive Out", "Hive Commission"].includes(out.category) && Number(out.actualAmount) > 0 && /^[A-Z]{3}$/.test(out.actualCurrency || "");
    if (!(Number(out.amount) > 0) && !unvaluedHive) fail("Enter the amount.");
    if (!out.description) fail("Enter a description.");
    return out;
  }

  root.PsulitSimple = { GROUPS, ACTIONS, build, other, BRANCHES };
})(typeof window !== "undefined" ? window : globalThis);
