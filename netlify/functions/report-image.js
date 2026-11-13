const { Resvg } = require("@resvg/resvg-js");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// IMPORTANT: keep in sync with CURRENCIES_SHORT in index.html,
// FOREX_CODES in send-report-live.js, and https://rates.psulit.ph/.
// A currency missing here is silently left off the rendered Cash Count
// photo even though the teller counted it correctly.
const FOREX_CODES = new Set([
  "PHP", "USD", "JPY", "KRW", "CNY", "EUR", "GBP", "AUD", "CAD", "CHF",
  "NZD", "SGD", "AED", "SAR", "HKD", "KWD", "BHD", "QAR", "JOD",
  "MYR", "BND", "THB", "TWD", "IDR", "VND"
]);

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
function clean(text) { return String(text || "").replace(/\*/g, "").replace(/\r/g, "").trim(); }
function first(text, regex, fallback = "") { const m = text.match(regex); return m ? String(m[1] || "").trim() : fallback; }
function normalizeHeading(line) { return line.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim(); }

function parseReport(message) {
  const text = clean(message);
  const lines = text.split("\n").map(x => x.trim()).filter(Boolean);
  const titleLine = lines[0] || "CASH COUNT";
  const shift = first(text, /Shift:\s*([^\n]+)/i);
  const countType = first(text, /Shift:\s*[^\n(]*\((Opening|Closing)\)/i);
  const title = /CLOSING/i.test(countType || titleLine) ? "CASH COUNT - CLOSING" : "CASH COUNT - OPENING";
  const branch = first(text, /Branch:\s*([^\n]+)/i);
  const teller = first(text, /Teller:\s*([^\n]+)/i);
  const timestamp = first(text, /Timestamp:\s*([^\n]+)/i);
  const ref = first(text, /Ref Code:\s*([^\n]+)/i);
  const grandTotal = first(text, /Grand Total:\s*([^\n]+)/i);
  const arBookletsMatch = text.match(/AR Booklets Remaining:\s*(\d+)/i);
  const arBooklets = arBookletsMatch ? arBookletsMatch[1] : null;
  const cctv = first(text, /CCTV footage for\s+(.+?)\s+on record/i);
  const isBackfill = /BACKFILL:/i.test(text);
  const sections = [];
  let current = null;

  const getSection = (name) => {
    let section = sections.find(s => s.name === name);
    if (!section) {
      section = { name, rows: [] };
      sections.push(section);
    }
    current = section;
    return section;
  };

  for (const rawLine of lines.slice(1)) {
    if (/^(?:[^A-Za-z0-9]*)(Branch|Shift|Teller|Timestamp|Ref Code):/i.test(rawLine)) continue;
    if (/^(?:[^A-Za-z0-9]*)Grand Total:/i.test(rawLine)) continue;
    if (/CCTV footage/i.test(rawLine)) continue;
    if (/^BACKFILL:/i.test(rawLine)) continue;
    if (/Submitted\s*&\s*Locked/i.test(rawLine)) continue;
    if (/^📒\s*AR Booklets Remaining:/i.test(rawLine)) continue;
    if (/^Rates:/i.test(rawLine) || /exchangerate-api\.com/i.test(rawLine)) continue;
    if (/^[─-]{5,}$/.test(rawLine)) continue;

    const normalized = normalizeHeading(rawLine);
    if (normalized === "FOREX CASH" || normalized === "FOREX") { getSection("FOREX CASH"); continue; }
    if (normalized === "OTHER BALANCES" || normalized === "OTHERS") { getSection("OTHER BALANCES"); continue; }
    if (normalized === "BANK BALANCES") { getSection("BANK BALANCES"); continue; }
    if (normalized.includes("RECEIVABLES") && normalized.includes("OWED TO ")) { getSection("RECEIVABLES"); continue; }
    if (normalized.includes("PAYABLES") && normalized.includes("OWED BY ")) { getSection("PAYABLES"); continue; }
    if (normalized.includes("SCRATCH INVENTORY") || (normalized.includes("SCRATCH IT") && normalized.includes("PHYSICAL COUNT"))) { getSection("REMAINING SCRATCH CARDS"); continue; }
    if (normalized.includes("SCRATCH IT") && normalized.includes("WINNING CARDS COUNT")) { getSection("WINNING CARDS PRESENTED TODAY"); continue; }

    const fx = rawLine.match(/^(?:[^A-Z0-9]*)([A-Z]{3}):\s*(.+)$/);
    if (fx && FOREX_CODES.has(fx[1])) {
      getSection("FOREX CASH").rows.push({ label: fx[1], value: fx[2].trim() });
      continue;
    }

    const fund = rawLine.match(/^(?:[^A-Za-z0-9]*)(Hive|JuanPay|Scratch|LottoMatik Cash|LottoMatik Wallet):\s*(.+)$/i);
    if (fund) {
      // Scratch cash belongs in the dedicated Scratch section, not Other Balances.
      if (/^Scratch$/i.test(fund[1])) continue;
      getSection("OTHER BALANCES").rows.push({ label: fund[1], value: fund[2].trim() });
      continue;
    }

    if (!current) continue;
    let label = "", value = "";
    let m = rawLine.match(/^(.+?):\s*(.+)$/);
    if (m) { label = m[1].trim(); value = m[2].trim(); }
    else {
      m = rawLine.match(/^(.+?)\s+[—-]\s+(.+)$/);
      if (m) { label = m[1].trim(); value = m[2].trim(); } else label = rawLine;
    }
    // Route Scratch cash and payout to their own section even though physical inventory
    // appears first in the submitted message.
    if (/^cash on hand$/i.test(label) || /^winning cards\s*\/\s*payout$/i.test(label)) {
      getSection("SCRATCH").rows.push({ label, value });
      continue;
    }
    current.rows.push({ label, value });
  }

  const other = sections.find(s => s.name === "OTHER BALANCES");
  if (other) {
    // Defensive filter: never show Scratch cash twice in the Other Balances section.
    const lottoRows = other.rows.filter(r => /lottomatik/i.test(r.label));
    other.rows = other.rows.filter(r => !/lottomatik/i.test(r.label) && !/^scratch$/i.test(r.label));
    if (lottoRows.length) {
      const idx = sections.indexOf(other);
      sections.splice(idx + 1, 0, { name: "LOTTOMATIK", rows: lottoRows.map(r => ({ label: r.label.replace(/^LottoMatik\s*/i, "") || "Balance", value: r.value })) });
    }
  }

  // Hive cash is Moneybees' money held by the branch, so the report shows it under PAYABLES as "Hive/MB".
  // Display only: the teller still counts it by denomination, and the submitted message and the sheet rows
  // stay "Hive" / Fund Balance, so the cash log and the audit read it exactly as before.
  const otherForHive = sections.find(s => s.name === "OTHER BALANCES");
  if (otherForHive) {
    const hiveRows = otherForHive.rows.filter(r => /^hive\b/i.test(String(r.label || "").trim()));
    if (hiveRows.length) {
      otherForHive.rows = otherForHive.rows.filter(r => !/^hive\b/i.test(String(r.label || "").trim()));
      let pay = sections.find(s => s.name === "PAYABLES");
      if (!pay) { pay = { name: "PAYABLES", rows: [] }; sections.push(pay); }
      pay.hive = hiveRows.map(r => {
        const v = String(r.value || "").replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "").trim();
        const php = /^PHP\s*[—-]\s*/i.test(v);
        return { label: "Hive/MB" + (php || !/^[A-Z]{3}\s*[—-]/.test(v) ? "" : " (" + v.slice(0, 3) + ")"), value: php ? v.replace(/^PHP\s*[—-]\s*/i, "") : v.replace(/^[A-Z]{3}\s*[—-]\s*/, "") };
      });
    }
  }

  // Thermal rolls belong under LottoMatik, even though the Cash Count
  // submission currently places the line after the Scratch physical count.
  const scratchForThermal = sections.find(s => s.name === "SCRATCH");
  if (scratchForThermal) {
    const thermalRows = scratchForThermal.rows.filter(r => /^(?:lottomatik\s+)?thermal rolls on hand$/i.test(String(r.label || "").trim()));
    scratchForThermal.rows = scratchForThermal.rows.filter(r => !/^(?:lottomatik\s+)?thermal rolls on hand$/i.test(String(r.label || "").trim()));
    if (thermalRows.length) {
      let lotto = sections.find(s => s.name === "LOTTOMATIK");
      if (!lotto) {
        lotto = { name: "LOTTOMATIK", rows: [] };
        sections.push(lotto);
      }
      lotto.rows.push(...thermalRows.map(r => ({ ...r, label: "Thermal Rolls on Hand" })));
    }
  }

  // On the report image, Scratch is one section with cash/payout first, then inventory.
  const scratch = sections.find(s => s.name === "SCRATCH");
  if (scratch) {
    const rowRank = (label) => {
      const normalized = normalizeHeading(label);
      if (normalized === "CASH ON HAND") return 0;
      if (normalized.startsWith("WINNING CARDS PAYOUT")) return 1;
      if (normalized === "GO BANANA") return 2;
      if (normalized === "RED HOT 7") return 3;
      if (normalized === "GO FOR GOLD") return 4;
      return 99;
    };
    scratch.rows.sort((a, b) => rowRank(a.label) - rowRank(b.label));
  }

  // Same order on every report: currencies in a fixed order, receivables/payables by name.
  const FX_ORDER = ["PHP","USD","EUR","GBP","JPY","CNY","HKD","SGD","AUD","CAD","CHF","KRW","SAR","AED","THB","MYR","NZD","BHD","KWD","JOD","QAR","IDR","VND","TWD","BND"];
  const fxRank = (c) => { const i = FX_ORDER.indexOf(String(c || "").toUpperCase()); return i < 0 ? 999 : i; };
  const fxSec = sections.find(s => s.name === "FOREX CASH");
  if (fxSec) fxSec.rows.sort((a, b) => fxRank(a.label) - fxRank(b.label));
  for (const nm of ["RECEIVABLES", "PAYABLES"]) {
    const sec = sections.find(s => s.name === nm);
    if (sec) sec.rows.sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { sensitivity: "base" }));
  }
  { const pay = sections.find(s => s.name === "PAYABLES"); if (pay && pay.hive) { pay.rows = [...pay.hive, ...pay.rows]; delete pay.hive; } }  // Hive/MB first

  const order = ["FOREX CASH", "OTHER BALANCES", "LOTTOMATIK", "BANK BALANCES", "RECEIVABLES", "PAYABLES", "SCRATCH", "REMAINING SCRATCH CARDS", "WINNING CARDS PRESENTED TODAY"];
  sections.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));

  return { title, branch, shift, teller, timestamp, ref, grandTotal, arBooklets, cctv, isBackfill, sections };
}

function palette(name) {
  const map = {
    "FOREX CASH": ["#102D4E", "#69B7FF"],
    "OTHER BALANCES": ["#3A2A07", "#F7C95C"],
    "LOTTOMATIK": ["#0D3322", "#56D98A"],
    "BANK BALANCES": ["#0C2F34", "#52D6DE"],
    "RECEIVABLES": ["#38141D", "#F07793"],
    "PAYABLES": ["#3B1E0C", "#F59A52"],
    "SCRATCH": ["#261B43", "#B49AF7"],
    "REMAINING SCRATCH CARDS": ["#0C2F34", "#52D6DE"],
    "WINNING CARDS PRESENTED TODAY": ["#123322", "#56D98A"],
  };
  return map[name] || ["#17212E", "#A8B6C7"];
}

function starPts(cx, cy, R, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, d = i % 2 ? r : R; pts.push(`${(cx + d * Math.cos(a)).toFixed(2)},${(cy + d * Math.sin(a)).toFixed(2)}`); }
  return pts.join(" ");
}

function flagSvg(code, x, y) {
  const c = String(code || "").toUpperCase();
  const w = 42, h = 28, r = 5;
  const box = (inner) => `<g transform="translate(${x} ${y})"><clipPath id="clip-${c}-${x}-${y}"><rect width="${w}" height="${h}" rx="${r}"/></clipPath><g clip-path="url(#clip-${c}-${x}-${y})">${inner}</g><rect width="${w}" height="${h}" rx="${r}" fill="none" stroke="#657284" stroke-width="1"/></g>`;
  switch (c) {
    case "PHP": return box(`<rect width="42" height="14" fill="#0B5ED7"/><rect y="14" width="42" height="14" fill="#CE1126"/><polygon points="0,0 18,14 0,28" fill="#FFF"/><circle cx="7" cy="14" r="3" fill="#FCD116"/>`);
    case "USD": return box(`<rect width="42" height="28" fill="#FFF"/><rect y="0" width="42" height="4" fill="#B22234"/><rect y="8" width="42" height="4" fill="#B22234"/><rect y="16" width="42" height="4" fill="#B22234"/><rect y="24" width="42" height="4" fill="#B22234"/><rect width="18" height="15" fill="#3C3B6E"/>`);
    case "JPY": return box(`<rect width="42" height="28" fill="#FFF"/><circle cx="21" cy="14" r="8" fill="#BC002D"/>`);
    case "EUR": return box(`<rect width="42" height="28" fill="#003399"/><circle cx="21" cy="14" r="7" fill="none" stroke="#FFCC00" stroke-width="2"/>`);
    case "GBP": return box(`<rect width="42" height="28" fill="#012169"/><path d="M0 0 L42 28 M42 0 L0 28" stroke="#FFF" stroke-width="6"/><path d="M0 0 L42 28 M42 0 L0 28" stroke="#C8102E" stroke-width="3"/><path d="M21 0V28M0 14H42" stroke="#FFF" stroke-width="8"/><path d="M21 0V28M0 14H42" stroke="#C8102E" stroke-width="4"/>`);
    case "CAD": return box(`<rect width="42" height="28" fill="#FFF"/><rect width="10" height="28" fill="#D80621"/><rect x="32" width="10" height="28" fill="#D80621"/><path d="M21 4 L23 9 L27 8 L25 13 L28 14 L24 17 L24 22 L22 21 L22 24 H20 V21 L18 22 V17 L14 14 L17 13 L15 8 L19 9 Z" fill="#D80621"/>`);
    case "AUD": return box(`<rect width="42" height="28" fill="#012169"/><g clip-path="inset(0)"><rect width="21" height="14" fill="#012169"/><path d="M0 0 L21 14 M21 0 L0 14" stroke="#FFF" stroke-width="3"/><path d="M0 0 L21 14 M21 0 L0 14" stroke="#C8102E" stroke-width="1.4"/><path d="M10.5 0V14M0 7H21" stroke="#FFF" stroke-width="4.5"/><path d="M10.5 0V14M0 7H21" stroke="#C8102E" stroke-width="2.6"/></g><circle cx="31" cy="9" r="3" fill="#FFF"/><circle cx="28" cy="20" r="2.5" fill="#FFF"/>`);
    case "CHF": return box(`<rect width="42" height="28" fill="#D52B1E"/><rect x="18" y="6" width="6" height="16" fill="#FFF"/><rect x="13" y="11" width="16" height="6" fill="#FFF"/>`);
    case "SAR": return box(`<rect width="42" height="28" fill="#006C35"/><rect x="9" y="13" width="24" height="2" fill="#FFF"/><rect x="15" y="18" width="12" height="2" fill="#FFF"/>`);
    case "TWD": return box(`<rect width="42" height="28" fill="#FE0000"/><rect width="18" height="14" fill="#000095"/><circle cx="9" cy="7" r="3.5" fill="#FFF"/>`);
    case "VND": return box(`<rect width="42" height="28" fill="#DA251D"/><polygon points="${starPts(21, 14.5, 9, 3.6)}" fill="#FFFF00"/>`);
    case "KRW": return box(`<rect width="42" height="28" fill="#FFF"/><circle cx="21" cy="14" r="6.5" fill="#CD2E3A"/><path d="M14.5 14 a6.5 6.5 0 0 0 13 0 a3.25 3.25 0 0 0 -6.5 0 a3.25 3.25 0 0 1 -6.5 0 Z" fill="#0047A0"/><g fill="#000"><rect x="4" y="4" width="7" height="1.6" transform="rotate(-34 7 5)"/><rect x="4" y="7" width="7" height="1.6" transform="rotate(-34 7 5)"/><rect x="31" y="22" width="7" height="1.6" transform="rotate(-34 35 23)"/><rect x="31" y="19" width="7" height="1.6" transform="rotate(-34 35 23)"/><rect x="31" y="4" width="7" height="1.6" transform="rotate(34 35 5)"/><rect x="4" y="22" width="7" height="1.6" transform="rotate(34 7 23)"/></g>`);
    case "HKD": return box(`<rect width="42" height="28" fill="#DE2910"/><g fill="#FFF"><circle cx="21" cy="9.5" r="3.2"/><circle cx="25.5" cy="12.8" r="3.2"/><circle cx="23.8" cy="18" r="3.2"/><circle cx="18.2" cy="18" r="3.2"/><circle cx="16.5" cy="12.8" r="3.2"/></g><circle cx="21" cy="14.5" r="2" fill="#DE2910"/>`);
    case "CNY": return box(`<rect width="42" height="28" fill="#DE2910"/><polygon points="${starPts(8, 8, 5, 2)}" fill="#FFDE00"/><polygon points="${starPts(16, 3.5, 1.6, .7)}" fill="#FFDE00"/><polygon points="${starPts(19, 7, 1.6, .7)}" fill="#FFDE00"/><polygon points="${starPts(19, 12, 1.6, .7)}" fill="#FFDE00"/><polygon points="${starPts(16, 15.5, 1.6, .7)}" fill="#FFDE00"/>`);
    case "SGD": return box(`<rect width="42" height="14" fill="#EF3340"/><rect y="14" width="42" height="14" fill="#FFF"/><circle cx="9" cy="7" r="5" fill="#FFF"/><circle cx="11" cy="7" r="4.5" fill="#EF3340"/><polygon points="${starPts(15, 4.5, 1.4, .6)}" fill="#FFF"/><polygon points="${starPts(17.5, 6.8, 1.4, .6)}" fill="#FFF"/><polygon points="${starPts(16.5, 9.8, 1.4, .6)}" fill="#FFF"/><polygon points="${starPts(13.3, 9.8, 1.4, .6)}" fill="#FFF"/><polygon points="${starPts(12.5, 6.8, 1.4, .6)}" fill="#FFF"/>`);
    case "MYR": return box(`<rect width="42" height="28" fill="#FFF"/><g fill="#CC0001"><rect y="0" width="42" height="4"/><rect y="8" width="42" height="4"/><rect y="16" width="42" height="4"/><rect y="24" width="42" height="4"/></g><rect width="21" height="16" fill="#010066"/><circle cx="8" cy="8" r="4.5" fill="#FC0"/><circle cx="9.3" cy="8" r="3.7" fill="#010066"/><polygon points="${starPts(13.5, 8, 3, 1.3)}" fill="#FC0"/>`);
    case "AED": return box(`<rect width="42" height="28" fill="#FFF"/><rect x="10" width="32" height="9.4" fill="#00732F"/><rect x="10" y="18.6" width="32" height="9.4" fill="#000"/><rect width="10" height="28" fill="#FF0000"/>`);
    case "THB": return box(`<rect width="42" height="28" fill="#A51931"/><rect y="4.7" width="42" height="18.6" fill="#F4F5F8"/><rect y="9.3" width="42" height="9.4" fill="#2D2A4A"/>`);
    case "NZD": return box(`<rect width="42" height="28" fill="#012169"/><g clip-path="inset(0)"><rect width="21" height="14" fill="#012169"/><path d="M0 0 L21 14 M21 0 L0 14" stroke="#FFF" stroke-width="3"/><path d="M0 0 L21 14 M21 0 L0 14" stroke="#C8102E" stroke-width="1.4"/><path d="M10.5 0V14M0 7H21" stroke="#FFF" stroke-width="4.5"/><path d="M10.5 0V14M0 7H21" stroke="#C8102E" stroke-width="2.6"/></g><g fill="#CC142B"><circle cx="31" cy="8" r="2"/><circle cx="35" cy="14" r="2"/><circle cx="31" cy="21" r="2"/><circle cx="27" cy="13" r="2"/></g>`);
    case "KWD": return box(`<rect width="42" height="9.4" fill="#007A3D"/><rect y="9.4" width="42" height="9.3" fill="#FFF"/><rect y="18.7" width="42" height="9.3" fill="#CE1126"/><polygon points="0,0 12,9.4 12,18.7 0,28" fill="#000"/>`);
    case "BHD": return box(`<rect width="42" height="28" fill="#CE1126"/><polygon points="0,0 14,0 18,2.8 14,5.6 18,8.4 14,11.2 18,14 14,16.8 18,19.6 14,22.4 18,25.2 14,28 0,28" fill="#FFF"/>`);
    case "QAR": return box(`<rect width="42" height="28" fill="#8A1538"/><polygon points="0,0 14,0 18,2.8 14,5.6 18,8.4 14,11.2 18,14 14,16.8 18,19.6 14,22.4 18,25.2 14,28 0,28" fill="#FFF"/>`);
    case "JOD": return box(`<rect width="42" height="9.4" fill="#000"/><rect y="9.4" width="42" height="9.3" fill="#FFF"/><rect y="18.7" width="42" height="9.3" fill="#007A3D"/><polygon points="0,0 21,14 0,28" fill="#CE1126"/><polygon points="${starPts(7, 14, 3, 1.3)}" fill="#FFF"/>`);
    case "IDR": return box(`<rect width="42" height="14" fill="#FF0000"/><rect y="14" width="42" height="14" fill="#FFF"/>`);
    default: return box(`<rect width="42" height="28" fill="#253241"/><text x="21" y="19" text-anchor="middle" font-size="12" font-weight="700" fill="#EAF1F8">${esc(c.slice(0,3))}</text>`);
  }
}

function rowSvg(sectionName, x, y, label, value, width) {
  const noEmoji = (t) => String(t == null ? "" : t).replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "").replace(/\s{2,}/g, " ").trim();
  label = noEmoji(label); value = noEmoji(value);
  const rightX = x + width;
  if (sectionName === "FOREX CASH") {
    const code = String(label || "").trim().toUpperCase().split(/\s+/)[0];
    return `${flagSvg(code, x, y - 23)}<text x="${x + 56}" y="${y}" font-size="26" font-weight="600" fill="#EAF1F8">${esc(label)}</text><text x="${rightX}" y="${y}" text-anchor="end" font-size="26" font-weight="700" fill="#D6DAE0">${esc(value)}</text>`;
  }
  return `<text x="${x}" y="${y}" font-size="26" font-weight="400" fill="#D4DEE9">${esc(label)}</text><text x="${rightX}" y="${y}" text-anchor="end" font-size="26" font-weight="700" fill="#D6DAE0">${esc(value)}</text>`;
}

function renderSvg(data) {
  const width = 1000, margin = 52, cardW = width - margin * 2, rowH = 48, sectionHeaderH = 60;
  let contentH = 390;
  for (const s of data.sections) if (s.rows.length) contentH += sectionHeaderH + 28 + s.rows.length * rowH + 26;
  contentH += 230;
  const height = Math.max(1260, contentH + 100);
  let y = 48, body = "";
  body += `<rect width="${width}" height="${height}" fill="#06090D"/>`;
  body += `<rect x="${margin}" y="${y}" width="${cardW}" height="${height - 96}" rx="30" fill="#0D1219" stroke="#1C2632" stroke-width="2"/>`;
  body += `<rect x="${margin}" y="${y}" width="${cardW}" height="124" rx="30" fill="#101720"/>`;
  body += `<rect x="${margin}" y="${y + 92}" width="${cardW}" height="32" fill="#101720"/>`;
  body += `<text x="${margin + 36}" y="${y + 43}" font-size="25" font-weight="700" letter-spacing="3" fill="#31C978">PSULIT</text>`;
  body += `<text x="${margin + 36}" y="${y + 88}" font-size="40" font-weight="700" fill="#FFFFFF">${esc(data.title)}</text>`;
  body += `<text x="${margin + cardW - 36}" y="${y + 47}" text-anchor="end" font-size="20" font-weight="700" fill="#93A3B5">Daily Report</text>`;
  if (data.isBackfill) {
    body += `<rect x="${margin + cardW - 190}" y="${y + 68}" width="154" height="34" rx="17" fill="#3B2D09"/>`;
    body += `<text x="${margin + cardW - 113}" y="${y + 92}" text-anchor="middle" font-size="17" font-weight="700" fill="#F7C95C">BACKFILL</text>`;
  }
  y += 150;
  const details = [["Branch",data.branch],["Shift",data.shift],["Teller",data.teller],["Timestamp",data.timestamp],["Ref Code",data.ref]];
  for (const [label,value] of details) {
    body += `<text x="${margin + 36}" y="${y}" font-size="23" font-weight="700" fill="#7F90A3">${esc(label)}</text>`;
    body += `<text x="${margin + 235}" y="${y}" font-size="23" font-weight="400" fill="#EDF4FB">${esc(value)}</text>`;
    y += 44;
  }
  y += 8;
  body += `<line x1="${margin + 36}" y1="${y}" x2="${margin + cardW - 36}" y2="${y}" stroke="#263341" stroke-width="2"/>`;
  y += 30;

  for (const section of data.sections) {
    if (!section.rows.length) continue;
    const [bg, fg] = palette(section.name);
    const sectionTitle = section.name === "FOREX CASH" ? "FOREIGN CURRENCY CASH (ON HAND)" : section.name;
    body += `<rect x="${margin + 28}" y="${y}" width="${cardW - 56}" height="${sectionHeaderH}" rx="14" fill="${bg}" stroke="#24313F" stroke-width="1"/>`;
    body += `<text x="${margin + 50}" y="${y + 40}" font-size="24" font-weight="700" letter-spacing="1" fill="${fg}">${esc(sectionTitle)}</text>`;
    y += sectionHeaderH + 28;
    for (const row of section.rows) {
      body += rowSvg(section.name, margin + 52, y, row.label, row.value, cardW - 104);
      y += rowH;
    }
    y += 16;

    if (section.name === "FOREX CASH") {
      if (data.grandTotal) {
        body += `<rect x="${margin + 28}" y="${y}" width="${cardW - 56}" height="92" rx="18" fill="#0D3322" stroke="#31C978" stroke-width="2"/>`;
        body += `<text x="${margin + 52}" y="${y + 40}" font-size="22" font-weight="700" fill="#91E5B5">TOTAL (PHP EQUIVALENT)</text>`;
        body += `<text x="${margin + cardW - 52}" y="${y + 42}" text-anchor="end" font-size="34" font-weight="700" fill="#D6DAE0">${esc(data.grandTotal)}</text>`;
        body += `<text x="${margin + 52}" y="${y + 72}" font-size="16" font-weight="400" fill="#79C99D">Converted value of Foreign Currency Cash only</text>`;
        y += 120;
      }
      if (data.arBooklets !== null) {
        // Keep AR Booklets Remaining consistent with the report's dark theme.
        // Use plain text instead of an emoji, which the bundled font cannot render reliably.
        body += `<text x="${margin + 52}" y="${y + 30}" font-size="18" font-weight="500" fill="#8795A7">AR Booklets Remaining</text>`;
        body += `<text x="${margin + cardW - 52}" y="${y + 30}" text-anchor="end" font-size="18" font-weight="600" fill="#AAB5C3">${esc(data.arBooklets)}</text>`;
        y += 52;
      }
    }
  }

  body += `<text x="${margin + 38}" y="${y}" font-size="22" font-weight="700" fill="#56D98A">Submitted &amp; Locked</text>`;
  y += 38;
  if (data.cctv) body += `<text x="${margin + 38}" y="${y}" font-size="21" font-weight="400" fill="#D2A94F">CCTV footage for ${esc(data.cctv)} on record.</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>text { font-family: 'DejaVu Sans', sans-serif; }</style>${body}</svg>`;
}

function bundledFontFiles() {
  const fontDir = path.resolve(__dirname, "../../node_modules/dejavu-fonts-ttf/ttf");
  const regularPath = path.join(fontDir, "DejaVuSans.ttf");
  const boldPath = path.join(fontDir, "DejaVuSans-Bold.ttf");
  if (!fs.existsSync(regularPath) || !fs.existsSync(boldPath)) throw new Error("Bundled report fonts are missing from the Netlify function package.");
  return [regularPath, boldPath];
}
async function renderCashCountPng(message) {
  const data = parseReport(message), svg = renderSvg(data), fontFiles = bundledFontFiles();
  const resvg = new Resvg(svg, { font: { fontFiles, defaultFontFamily: "DejaVu Sans", sansSerifFamily: "DejaVu Sans", loadSystemFonts: false } });
  return Buffer.from(resvg.render().asPng());
}
function buildCaption(message) {
  const data = parseReport(message);
  const lines = [data.title, `Branch: ${data.branch}`, `Shift: ${data.shift}`, `Teller: ${data.teller}`, `Ref Code: ${data.ref}`, `Forex Total (PHP Equivalent): ${data.grandTotal}`];
  if (data.isBackfill) lines.push("Backfill: original submitted count");
  return lines.join("\n").slice(0, 1024);
}
function multipartField(boundary, name, value) { return Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`); }
async function sendCashCountPhoto({ token, chatId, threadId, message }) {
  const png = await renderCashCountPng(message), caption = buildCaption(message), boundary = `----psulit-${crypto.randomBytes(12).toString("hex")}`;
  const photoHeader = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="cash-count-report.png"\r\nContent-Type: image/png\r\n\r\n`);
  const closing = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([multipartField(boundary,"chat_id",String(chatId)),multipartField(boundary,"message_thread_id",String(Number(threadId))),multipartField(boundary,"caption",caption),photoHeader,png,closing]);
  const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": String(body.length) }, body });
  const result = await response.json();
  if (!result.ok) throw new Error(result.description || "Telegram rejected the report image.");
  return result.result && result.result.message_id;
}
module.exports = { parseReport, renderCashCountPng, buildCaption, sendCashCountPhoto };
