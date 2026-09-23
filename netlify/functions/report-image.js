const { Resvg } = require("@resvg/resvg-js");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function clean(text) {
  return String(text || "").replace(/\*/g, "").replace(/\r/g, "").trim();
}

function first(text, regex, fallback = "") {
  const m = text.match(regex);
  return m ? String(m[1] || "").trim() : fallback;
}

function normalizeHeading(line) {
  return line.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function parseReport(message) {
  const text = clean(message);
  const lines = text.split("\n").map(x => x.trim()).filter(Boolean);
  const titleLine = lines[0] || "CASH COUNT";
  const title = /CLOSING/i.test(titleLine) ? "CASH COUNT - CLOSING" : "CASH COUNT - OPENING";
  const branch = first(text, /Branch:\s*([^\n]+)/i);
  const shift = first(text, /Shift:\s*([^\n]+)/i);
  const teller = first(text, /Teller:\s*([^\n]+)/i);
  const timestamp = first(text, /Timestamp:\s*([^\n]+)/i);
  const ref = first(text, /Ref Code:\s*([^\n]+)/i);
  const grandTotal = first(text, /Grand Total:\s*([^\n]+)/i);
  const cctv = first(text, /CCTV footage for\s+(.+?)\s+on record/i);
  const isBackfill = /BACKFILL:/i.test(text);

  const sections = [];
  let current = null;
  const pushSection = (name) => {
    current = { name, rows: [] };
    sections.push(current);
  };

  for (const rawLine of lines.slice(1)) {
    if (/^(Branch|Shift|Teller|Timestamp|Ref Code):/i.test(rawLine)) continue;
    if (/^Grand Total:/i.test(rawLine)) continue;
    if (/CCTV footage/i.test(rawLine)) continue;
    if (/^BACKFILL:/i.test(rawLine)) continue;

    const normalized = normalizeHeading(rawLine);
    if (normalized === "FOREX CASH") { pushSection("FOREX CASH"); continue; }
    if (normalized === "OTHER BALANCES") { pushSection("OTHER BALANCES"); continue; }
    if (normalized === "BANK BALANCES") { pushSection("BANK BALANCES"); continue; }
    if (normalized.includes("RECEIVABLES") && normalized.includes("OWED TO PSULIT")) { pushSection("RECEIVABLES"); continue; }
    if (normalized.includes("PAYABLES") && normalized.includes("OWED BY PSULIT")) { pushSection("PAYABLES"); continue; }
    if (normalized.includes("SCRATCH IT") && normalized.includes("PHYSICAL COUNT")) { pushSection("SCRATCH PHYSICAL COUNT"); continue; }
    if (!current) continue;

    let label = "";
    let value = "";
    let m = rawLine.match(/^(.+?):\s*(.+)$/);
    if (m) {
      label = m[1].trim();
      value = m[2].trim();
    } else {
      m = rawLine.match(/^(.+?)\s+[—-]\s+(.+)$/);
      if (m) {
        label = m[1].trim();
        value = m[2].trim();
      } else {
        label = rawLine;
      }
    }
    current.rows.push({ label, value });
  }

  const other = sections.find(s => s.name === "OTHER BALANCES");
  if (other) {
    const lottoRows = other.rows.filter(r => /lottomatik/i.test(r.label));
    other.rows = other.rows.filter(r => !/lottomatik/i.test(r.label));
    if (lottoRows.length) {
      const idx = sections.indexOf(other);
      sections.splice(idx + 1, 0, {
        name: "LOTTOMATIK",
        rows: lottoRows.map(r => ({
          label: r.label.replace(/^LottoMatik\s*/i, "") || "Balance",
          value: r.value,
        })),
      });
    }
  }

  return { title, branch, shift, teller, timestamp, ref, grandTotal, cctv, isBackfill, sections };
}

function palette(name) {
  const map = {
    "FOREX CASH": ["#E9F3FF", "#245D9C"],
    "OTHER BALANCES": ["#FFF4DA", "#9A6500"],
    "LOTTOMATIK": ["#E9F8EE", "#227A45"],
    "BANK BALANCES": ["#E8F7F8", "#16747A"],
    "RECEIVABLES": ["#FDECEF", "#A13A50"],
    "PAYABLES": ["#FFF0E7", "#A34D15"],
    "SCRATCH PHYSICAL COUNT": ["#F1ECFF", "#6545A6"],
  };
  return map[name] || ["#EFF3F8", "#38506A"];
}

function lineSvg(x, y, label, value, width) {
  const rightX = x + width;
  return `\n    <text x="${x}" y="${y}" font-size="26" font-weight="400" fill="#24364B">${esc(label)}</text>\n    <text x="${rightX}" y="${y}" text-anchor="end" font-size="26" font-weight="700" fill="#16273A">${esc(value)}</text>`;
}

function renderSvg(data) {
  const width = 1000;
  const margin = 56;
  const cardW = width - margin * 2;
  const rowH = 46;
  const sectionHeaderH = 58;
  let contentH = 390;
  for (const s of data.sections) {
    if (!s.rows.length) continue;
    contentH += sectionHeaderH + 26 + s.rows.length * rowH + 24;
  }
  contentH += 190;
  const height = Math.max(1250, contentH + 100);

  let y = 58;
  let body = "";
  body += `<rect x="0" y="0" width="${width}" height="${height}" fill="#EEF3F8"/>`;
  body += `<rect x="${margin}" y="${y}" width="${cardW}" height="${height - 116}" rx="30" fill="#FFFFFF"/>`;
  body += `<rect x="${margin}" y="${y}" width="${cardW}" height="118" rx="30" fill="#F8FBFD"/>`;
  body += `<rect x="${margin}" y="${y + 88}" width="${cardW}" height="30" fill="#F8FBFD"/>`;
  body += `<text x="${margin + 34}" y="${y + 43}" font-size="24" font-weight="700" letter-spacing="3" fill="#11864B">PSULIT</text>`;
  body += `<text x="${margin + 34}" y="${y + 84}" font-size="40" font-weight="700" fill="#17324D">${esc(data.title)}</text>`;
  body += `<text x="${margin + cardW - 34}" y="${y + 47}" text-anchor="end" font-size="21" font-weight="700" fill="#6C7E90">Daily Report</text>`;
  if (data.isBackfill) {
    body += `<rect x="${margin + cardW - 190}" y="${y + 63}" width="156" height="34" rx="17" fill="#FFF2C7"/>`;
    body += `<text x="${margin + cardW - 112}" y="${y + 87}" text-anchor="middle" font-size="17" font-weight="700" fill="#8A6500">BACKFILL</text>`;
  }
  y += 145;

  const details = [
    ["Branch", data.branch],
    ["Shift", data.shift],
    ["Teller", data.teller],
    ["Timestamp", data.timestamp],
    ["Ref Code", data.ref],
  ];
  for (const [label, value] of details) {
    body += `<text x="${margin + 34}" y="${y}" font-size="23" font-weight="700" fill="#718196">${esc(label)}</text>`;
    body += `<text x="${margin + 235}" y="${y}" font-size="23" font-weight="400" fill="#22364A">${esc(value)}</text>`;
    y += 44;
  }
  y += 8;
  body += `<line x1="${margin + 34}" y1="${y}" x2="${margin + cardW - 34}" y2="${y}" stroke="#E4EAF0" stroke-width="2"/>`;
  y += 30;

  for (const section of data.sections) {
    if (!section.rows.length) continue;
    const [bg, fg] = palette(section.name);
    body += `<rect x="${margin + 28}" y="${y}" width="${cardW - 56}" height="${sectionHeaderH}" rx="14" fill="${bg}"/>`;
    body += `<text x="${margin + 50}" y="${y + 39}" font-size="24" font-weight="700" letter-spacing="1" fill="${fg}">${esc(section.name)}</text>`;
    y += sectionHeaderH + 26;
    for (const row of section.rows) {
      body += lineSvg(margin + 52, y, row.label, row.value, cardW - 104);
      y += rowH;
    }
    y += 14;
  }

  body += `<rect x="${margin + 28}" y="${y}" width="${cardW - 56}" height="82" rx="18" fill="#EAF3FF"/>`;
  body += `<text x="${margin + 54}" y="${y + 53}" font-size="28" font-weight="700" fill="#245D9C">GRAND TOTAL</text>`;
  body += `<text x="${margin + cardW - 54}" y="${y + 53}" text-anchor="end" font-size="34" font-weight="700" fill="#17324D">${esc(data.grandTotal)}</text>`;
  y += 110;
  body += `<text x="${margin + 38}" y="${y}" font-size="22" font-weight="700" fill="#168653">Submitted &amp; Locked</text>`;
  y += 38;
  if (data.cctv) {
    body += `<text x="${margin + 38}" y="${y}" font-size="21" font-weight="400" fill="#9A6A00">CCTV footage for ${esc(data.cctv)} on record.</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n    <style>text { font-family: 'DejaVu Sans'; }</style>\n    ${body}\n  </svg>`;
}

function loadBundledFonts() {
  const fontDir = path.resolve(__dirname, "../../node_modules/dejavu-fonts-ttf/ttf");
  const regularPath = path.join(fontDir, "DejaVuSans.ttf");
  const boldPath = path.join(fontDir, "DejaVuSans-Bold.ttf");
  if (!fs.existsSync(regularPath) || !fs.existsSync(boldPath)) {
    throw new Error("Bundled report fonts are missing from the Netlify function package.");
  }
  return [fs.readFileSync(regularPath), fs.readFileSync(boldPath)];
}

async function renderCashCountPng(message) {
  const data = parseReport(message);
  const svg = renderSvg(data);
  const fontBuffers = loadBundledFonts();
  const resvg = new Resvg(svg, {
    font: {
      fontBuffers,
      defaultFontFamily: "DejaVu Sans",
      loadSystemFonts: false,
    },
  });
  return Buffer.from(resvg.render().asPng());
}

function buildCaption(message) {
  const data = parseReport(message);
  const lines = [
    data.title,
    `Branch: ${data.branch}`,
    `Shift: ${data.shift}`,
    `Teller: ${data.teller}`,
    `Ref Code: ${data.ref}`,
    `Grand Total: ${data.grandTotal}`,
  ];
  if (data.isBackfill) lines.push("Backfill: original submitted count");
  return lines.join("\n").slice(0, 1024);
}

function multipartField(boundary, name, value) {
  return Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
}

async function sendCashCountPhoto({ token, chatId, threadId, message }) {
  const png = await renderCashCountPng(message);
  const caption = buildCaption(message);
  const boundary = `----psulit-${crypto.randomBytes(12).toString("hex")}`;
  const photoHeader = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="photo"; filename="cash-count-report.png"\r\n` +
    `Content-Type: image/png\r\n\r\n`
  );
  const closing = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([
    multipartField(boundary, "chat_id", String(chatId)),
    multipartField(boundary, "message_thread_id", String(Number(threadId))),
    multipartField(boundary, "caption", caption),
    photoHeader,
    png,
    closing,
  ]);

  const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body,
  });

  const result = await response.json();
  if (!result.ok) throw new Error(result.description || "Telegram rejected the report image.");
  return result.result && result.result.message_id;
}

module.exports = {
  parseReport,
  renderCashCountPng,
  buildCaption,
  sendCashCountPhoto,
};
