const { Resvg } = require("@resvg/resvg-js");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const FOREX_CODES = new Set([
  "PHP", "USD", "JPY", "KRW", "CNY", "EUR", "GBP", "AUD", "CAD", "CHF",
  "NZD", "SGD", "HKD", "TWD", "THB", "MYR", "IDR", "AED", "SAR", "BND"
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
    if (/^Rates:/i.test(rawLine) || /exchangerate-api\.com/i.test(rawLine)) continue;
    if (/^[─-]{5,}$/.test(rawLine)) continue;

    const normalized = normalizeHeading(rawLine);
    if (normalized === "FOREX CASH" || normalized === "FOREX") { getSection("FOREX CASH"); continue; }
    if (normalized === "OTHER BALANCES" || normalized === "OTHERS") { getSection("OTHER BALANCES"); continue; }
    if (normalized === "BANK BALANCES") { getSection("BANK BALANCES"); continue; }
    if (normalized.includes("RECEIVABLES") && normalized.includes("OWED TO PSULIT")) { getSection("RECEIVABLES"); continue; }
    if (normalized.includes("PAYABLES") && normalized.includes("OWED BY PSULIT")) { getSection("PAYABLES"); continue; }
    if (normalized.includes("SCRATCH IT") && normalized.includes("PHYSICAL COUNT")) { getSection("SCRATCH PHYSICAL COUNT"); continue; }

    const fx = rawLine.match(/^(?:[^A-Z0-9]*)([A-Z]{3}):\s*(.+)$/);
    if (fx && FOREX_CODES.has(fx[1])) {
      getSection("FOREX CASH").rows.push({ label: fx[1], value: fx[2].trim() });
      continue;
    }

    const fund = rawLine.match(/^(?:[^A-Za-z0-9]*)(Hive|JuanPay|Scratch|LottoMatik Cash|LottoMatik Wallet):\s*(.+)$/i);
    if (fund) {
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
    current.rows.push({ label, value });
  }

  const other = sections.find(s => s.name === "OTHER BALANCES");
  if (other) {
    const lottoRows = other.rows.filter(r => /lottomatik/i.test(r.label));
    other.rows = other.rows.filter(r => !/lottomatik/i.test(r.label));
    if (lottoRows.length) {
      const idx = sections.indexOf(other);
      sections.splice(idx + 1, 0, { name: "LOTTOMATIK", rows: lottoRows.map(r => ({ label: r.label.replace(/^LottoMatik\s*/i, "") || "Balance", value: r.value })) });
    }
  }

  const order = ["FOREX CASH", "OTHER BALANCES", "LOTTOMATIK", "BANK BALANCES", "RECEIVABLES", "PAYABLES", "SCRATCH PHYSICAL COUNT"];
  sections.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));

  return { title, branch, shift, teller, timestamp, ref, grandTotal, cctv, isBackfill, sections };
}

function palette(name) {
  const map = {
    "FOREX CASH": ["#102D4E", "#69B7FF"],
    "OTHER BALANCES": ["#3A2A07", "#F7C95C"],
    "LOTTOMATIK": ["#0D3322", "#56D98A"],
    "BANK BALANCES": ["#0C2F34", "#52D6DE"],
    "RECEIVABLES": ["#38141D", "#F07793"],
    "PAYABLES": ["#3B1E0C", "#F59A52"],
    "SCRATCH PHYSICAL COUNT": ["#261B43", "#B49AF7"],
  };
  return map[name] || ["#17212E", "#A8B6C7"];
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
    case "CAD": return box(`<rect width="42" height="28" fill="#FFF"/><rect width="9" height="28" fill="#D80621"/><rect x="33" width="9" height="28" fill="#D80621"/><circle cx="21" cy="14" r="5" fill="#D80621"/>`);
    case "AUD": return box(`<rect width="42" height="28" fill="#012169"/><circle cx="31" cy="9" r="3" fill="#FFF"/><circle cx="28" cy="20" r="2.5" fill="#FFF"/>`);
    case "CHF": return box(`<rect width="42" height="28" fill="#D52B1E"/><rect x="18" y="6" width="6" height="16" fill="#FFF"/><rect x="13" y="11" width="16" height="6" fill="#FFF"/>`);
    case "SAR": return box(`<rect width="42" height="28" fill="#006C35"/><rect x="9" y="13" width="24" height="2" fill="#FFF"/><rect x="15" y="18" width="12" height="2" fill="#FFF"/>`);
    case "TWD": return box(`<rect width="42" height="28" fill="#FE0000"/><rect width="18" height="14" fill="#000095"/><circle cx="9" cy="7" r="3.5" fill="#FFF"/>`);
    case "IDR": return box(`<rect width="42" height="14" fill="#FF0000"/><rect y="14" width="42" height="14" fill="#FFF"/>`);
    default: return box(`<rect width="42" height="28" fill="#253241"/><text x="21" y="19" text-anchor="middle" font-size="12" font-weight="700" fill="#EAF1F8">${esc(c.slice(0,3))}</text>`);
  }
}

function rowSvg(sectionName, x, y, label, value, width) {
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

    if (section.name === "FOREX CASH" && data.grandTotal) {
      body += `<rect x="${margin + 28}" y="${y}" width="${cardW - 56}" height="92" rx="18" fill="#0D3322" stroke="#31C978" stroke-width="2"/>`;
      body += `<text x="${margin + 52}" y="${y + 40}" font-size="22" font-weight="700" fill="#91E5B5">TOTAL (PHP EQUIVALENT)</text>`;
      body += `<text x="${margin + cardW - 52}" y="${y + 42}" text-anchor="end" font-size="34" font-weight="700" fill="#D6DAE0">${esc(data.grandTotal)}</text>`;
      body += `<text x="${margin + 52}" y="${y + 72}" font-size="16" font-weight="400" fill="#79C99D">Converted value of Foreign Currency Cash only</text>`;
      y += 120;
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
