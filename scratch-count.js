(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ScratchCount = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const PRODUCTS = Object.freeze([
    Object.freeze({ key: "scratch_go_banana", label: "Go Banana" }),
    Object.freeze({ key: "scratch_red_hot_7", label: "Red Hot 7" }),
    Object.freeze({ key: "scratch_go_for_gold", label: "Go For Gold" }),
  ]);
  const LOTTOMATIK_DENOMS = Object.freeze([1000, 500, 200, 100, 50, 20, 10, 5, 1]);

  function lottomatikIsSupported(branch, selected) {
    return (branch === "Alphaland" || branch === "Solaire") && selected === true;
  }

  function isRequired(branch, scratchSelected) {
    return branch === "Alphaland" && scratchSelected === true;
  }

  function validate(branch, scratchSelected, rawValues) {
    if (!isRequired(branch, scratchSelected)) return { valid: true, values: null, errors: {} };

    const values = {};
    const errors = {};
    PRODUCTS.forEach(({ key }) => {
      const raw = rawValues?.[key];
      const text = raw === undefined || raw === null ? "" : String(raw).trim();
      if (text === "") {
        errors[key] = "Required — enter 0 if none";
      } else if (!/^\d+$/.test(text)) {
        errors[key] = "Enter a whole number of 0 or more";
      } else {
        values[key] = Number(text);
      }
    });

    return { valid: Object.keys(errors).length === 0, values, errors };
  }

  function formatReport(branch, scratchSelected, values, bold) {
    if (!isRequired(branch, scratchSelected) || !values) return "";
    const mark = bold ? "*" : "";
    return [
      `🎟️ ${mark}SCRATCH IT — PHYSICAL COUNT${mark}`,
      ...PRODUCTS.map(({ key, label }) => `${label}: ${values[key]} pcs`),
    ].join("\n");
  }

  function validateLottomatik(branch, selected, rawValue) {
    if (!lottomatikIsSupported(branch, selected))
      return { valid: true, value: null, error: "" };
    const text = rawValue === undefined || rawValue === null ? "" : String(rawValue).trim();
    if (text === "") return { valid: false, value: null, error: "Required — enter 0.00 if empty" };
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text))
      return { valid: false, value: null, error: "Enter a non-negative PHP amount with up to 2 decimals" };
    return { valid: true, value: Number(text.replace(/,/g, "")), error: "" };
  }

  function formatLottomatikReport(branch, selected, value, bold) {
    if (!lottomatikIsSupported(branch, selected) || value === null) return "";
    const mark = bold ? "*" : "";
    return [
      `🎰 ${mark}LOTTOMATIK${mark}`,
      `Wallet Balance: ₱${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    ].join("\n");
  }

  function validateLottomatikCash(branch, selected, rawValues) {
    if (!lottomatikIsSupported(branch, selected)) return { valid: true, values: null, total: 0, errors: {} };
    const values = {};
    const errors = {};
    LOTTOMATIK_DENOMS.forEach(denom => {
      const key = `lottomatik_cash_${denom}`;
      const raw = rawValues?.[key];
      const text = raw === undefined || raw === null ? "" : String(raw).trim();
      if (text === "") values[key] = 0;
      else if (!/^\d+$/.test(text)) errors[key] = "Enter a whole number of 0 or more";
      else values[key] = Number(text);
    });
    const total = Object.entries(values).reduce((sum, [key, qty]) => sum + qty * Number(key.replace("lottomatik_cash_", "")), 0);
    return { valid: Object.keys(errors).length === 0, values, total, errors };
  }

  function formatLottomatikCashReport(branch, selected, values, bold) {
    if (!lottomatikIsSupported(branch, selected) || !values) return "";
    const mark = bold ? "*" : "";
    let total = 0;
    const lines = [`🎰 ${mark}LOTTOMATIK${mark}`];
    LOTTOMATIK_DENOMS.forEach(denom => {
      const qty = Number(values[`lottomatik_cash_${denom}`] || 0);
      total += qty * denom;
      if (qty > 0) lines.push(`₱${denom.toLocaleString()} × ${qty} = ₱${(qty * denom).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    });
    lines.push(`${mark}Total LottoMatik: ₱${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${mark}`);
    return lines.join("\n");
  }

  function buildLottomatikCarryRecord(values, wallet) {
    const cash = {};
    let cashTotal = 0;
    LOTTOMATIK_DENOMS.forEach(denom => {
      const key = `lottomatik_cash_${denom}`;
      const qty = Math.max(0, Math.floor(Number(values?.[key] || 0)));
      cash[key] = qty;
      cashTotal += qty * denom;
    });
    return { version: 1, cash, cashTotal, wallet: wallet === null || wallet === undefined ? null : Number(wallet) };
  }

  function normalizeLottomatikCarryRecord(raw) {
    if (raw === null || raw === undefined || raw === "") return null;
    if (typeof raw === "number" || typeof raw === "string") return { version: 0, cash: null, cashTotal: 0, wallet: Number(raw) };
    if (typeof raw !== "object") return null;
    const wallet = raw.wallet ?? raw.walletBalance ?? raw.lottomatikWalletBalance ?? null;
    const cash = raw.cash || raw.denominations || raw.lottomatikCash || null;
    const normalizedCash = cash ? Object.fromEntries(LOTTOMATIK_DENOMS.map(denom => {
      const key = `lottomatik_cash_${denom}`;
      return [key, Math.max(0, Math.floor(Number(cash[key] || 0)))];
    })) : null;
    const cashTotal = normalizedCash ? LOTTOMATIK_DENOMS.reduce((sum, denom) => sum + normalizedCash[`lottomatik_cash_${denom}`] * denom, 0) : Number(raw.cashTotal || 0);
    return { version: Number(raw.version || 0), cash: normalizedCash, cashTotal, wallet: wallet === null || wallet === "" ? null : Number(wallet) };
  }

  return { PRODUCTS, LOTTOMATIK_DENOMS, isRequired, validate, formatReport, validateLottomatik, formatLottomatikReport, validateLottomatikCash, formatLottomatikCashReport, buildLottomatikCarryRecord, normalizeLottomatikCarryRecord };
});
