const { Resvg } = require('@resvg/resvg-js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stripEmoji(text) {
  return String(text || '')
    .replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/[\u2600-\u27BF]/gu, '')
    .replace(/\uFE0F/g, '')
    .trim();
}

function wrap(text, max = 64) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const out = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > max && line) {
      out.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) out.push(line);
  return out;
}

function classify(line) {
  const t = stripEmoji(line);
  if (!t) return 'blank';
  if (/^PSULIT SCRATCH IT/i.test(t)) return 'title';
  if (/^(SALES|WINNING CARDS \/ PAYOUTS|REPLENISHMENT|TODAY.?S TOTALS)$/i.test(t)) return 'section';
  if (/^(Cards Sold:|Sales:|Supplier Cost:|Gross Profit:|Winning Cards \/ Payouts:|Replenishment Gross:|Winning-Card Deductions:|Actual Cash Paid)/i.test(t)) return 'total';
  return 'body';
}

function renderPng(text) {
  const raw = String(text || '').replace(/\r/g, '').split('\n');
  const lines = [];
  for (const item of raw) {
    const kind = classify(item);
    const cleaned = stripEmoji(item);
    if (kind === 'blank') { lines.push({ kind, text: '' }); continue; }
    if (kind === 'title') { lines.push({ kind, text: cleaned }); continue; }
    const wrapped = wrap(cleaned.replace(/^•\s*/, '• '), kind === 'body' ? 68 : 62);
    wrapped.forEach((part, index) => lines.push({ kind, text: part, continuation: index > 0 }));
  }

  const W = 1000;
  const M = 52;
  const cardW = W - M * 2;
  let y = 186;
  const rendered = [];
  let firstTitle = true;

  for (const row of lines) {
    if (row.kind === 'blank') { y += 18; continue; }
    if (row.kind === 'title' && firstTitle) { firstTitle = false; continue; }
    if (row.kind === 'section') {
      y += 12;
      rendered.push(`<rect x="${M + 28}" y="${y - 30}" width="${cardW - 56}" height="52" rx="12" fill="#13355A"/>`);
      rendered.push(`<text x="${M + 50}" y="${y + 5}" font-size="23" font-weight="700" fill="#78BEFF">${esc(row.text.toUpperCase())}</text>`);
      y += 46;
      continue;
    }
    const color = row.kind === 'total' ? '#F0F3F6' : '#D6DAE0';
    const weight = row.kind === 'total' ? 700 : 400;
    const x = M + 48 + (row.continuation ? 22 : 0);
    rendered.push(`<text x="${x}" y="${y}" font-size="22" font-weight="${weight}" fill="${color}">${esc(row.text)}</text>`);
    y += 32;
  }

  y += 34;
  const H = Math.max(900, y + 56);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <style>text{font-family:'DejaVu Sans',sans-serif}</style>
    <rect width="${W}" height="${H}" fill="#06090D"/>
    <rect x="${M}" y="54" width="${cardW}" height="${H - 108}" rx="28" fill="#0D1219" stroke="#1C2632" stroke-width="2"/>
    <rect x="${M}" y="54" width="${cardW}" height="100" rx="28" fill="#101720"/>
    <rect x="${M}" y="126" width="${cardW}" height="28" fill="#101720"/>
    <text x="${M + 34}" y="92" font-size="24" font-weight="700" letter-spacing="3" fill="#31C978">PSULIT</text>
    <text x="${M + 34}" y="133" font-size="34" font-weight="700" fill="#F0F3F6">SCRATCH IT — DAILY SUMMARY</text>
    ${rendered.join('')}
  </svg>`;

  const fontDir = path.resolve(__dirname, '../../node_modules/dejavu-fonts-ttf/ttf');
  const fontFiles = [path.join(fontDir, 'DejaVuSans.ttf'), path.join(fontDir, 'DejaVuSans-Bold.ttf')];
  fontFiles.forEach(f => { if (!fs.existsSync(f)) throw new Error('Bundled Scratch report font missing.'); });
  const resvg = new Resvg(svg, { font: { fontFiles, defaultFontFamily: 'DejaVu Sans', loadSystemFonts: false } });
  return Buffer.from(resvg.render().asPng());
}

function field(boundary, name, value) {
  return Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
}

async function sendPhoto({ token, chatId, threadId, caption, png }) {
  const boundary = `----psulit-scratch-${crypto.randomBytes(10).toString('hex')}`;
  const header = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="scratch-daily-summary.png"\r\nContent-Type: image/png\r\n\r\n`);
  const close = Buffer.from(`\r\n--${boundary}--\r\n`);
  const parts = [field(boundary, 'chat_id', String(chatId))];
  if (threadId) parts.push(field(boundary, 'message_thread_id', String(threadId)));
  if (caption) parts.push(field(boundary, 'caption', String(caption).slice(0, 1024)));
  const payload = Buffer.concat([...parts, header, png, close]);
  const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': String(payload.length) },
    body: payload,
  });
  const result = await response.json();
  if (!response.ok || result.ok !== true) throw new Error(result.description || `Telegram HTTP ${response.status}`);
  return result.result?.message_id;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'POST required' }) };
  try {
    const body = JSON.parse(event.body || '{}');
    const secret = process.env.AUDIT_IMAGE_SECRET || '';
    if (!secret || String(body.secret || '') !== secret) return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'Unauthorized' }) };
    const token = process.env.TELEGRAM_BOT_TOKEN || '';
    if (!token) throw new Error('Telegram token missing.');
    const text = String(body.text || '').trim();
    const chatId = String(body.chat_id || '').trim();
    const threadId = Number(body.thread_id || 0);
    if (!text || !chatId || !threadId) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'text, chat_id and thread_id are required' }) };
    const png = renderPng(text);
    const messageId = await sendPhoto({ token, chatId, threadId, caption: body.caption || '', png });
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, message_id: messageId, mode: 'photo' }) };
  } catch (error) {
    console.error('send-scratch-report-image failed:', error.message);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: error.message || String(error) }) };
  }
};
