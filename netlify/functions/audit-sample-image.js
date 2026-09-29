const { Resvg } = require('@resvg/resvg-js');
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

function render() {
  const W = 720;
  const H = 993;
  const M = 44;
  const R = 24;
  const cardW = W - (M * 2);
  const rows = [
    ['Opening', '₱162,068.80'],
    ['Forex BUY cash-out', '− ₱50,781.69'],
    ['Expected', '₱111,287.11'],
    ['Actual Cash Count', '₱111,287.11'],
    ['Variance', '₱0.00'],
  ];
  const scratch = [
    ['Beginning Cash', '₱16,528.00'],
    ['Sales', '+ ₱900.00'],
    ['Payouts', '− ₱270.00'],
    ['Expected Closing', '₱17,158.00'],
    ['Actual Cash Count', '₱17,158.00'],
    ['Variance', '₱0.00'],
  ];

  let body = '';
  body += `<rect width="${W}" height="${H}" fill="#06090D"/>`;
  body += `<rect x="${M}" y="25" width="${cardW}" height="930" rx="${R}" fill="#0D1219" stroke="#1C2632" stroke-width="2"/>`;
  body += `<rect x="${M}" y="25" width="${cardW}" height="91" rx="${R}" fill="#101720"/>`;
  body += `<rect x="${M}" y="92" width="${cardW}" height="24" fill="#101720"/>`;
  body += `<text x="64" y="62" font-size="20" font-weight="700" letter-spacing="2" fill="#31C978">PSULIT</text>`;
  body += `<text x="64" y="97" font-size="28" font-weight="700" fill="#F0F3F6">ALPHALAND — DAILY AUDIT</text>`;
  body += `<text x="648" y="61" text-anchor="end" font-size="15" font-weight="700" fill="#B9C1CA">September 28, 2026</text>`;

  body += `<rect x="62" y="138" width="596" height="51" rx="12" fill="#103625" stroke="#31C978"/>`;
  body += `<text x="78" y="169" font-size="16" font-weight="700" fill="#7FE3A8">STATUS</text>`;
  body += `<text x="642" y="169" text-anchor="end" font-size="19" font-weight="700" fill="#E8EEF4">RECONCILED</text>`;

  function section(y, title, fill, fg) {
    body += `<rect x="62" y="${y}" width="596" height="39" rx="8" fill="${fill}"/>`;
    body += `<text x="78" y="${y + 26}" font-size="16" font-weight="700" fill="${fg}">${esc(title)}</text>`;
  }
  function kv(y, left, right, strong = false) {
    body += `<text x="78" y="${y}" font-size="17" fill="#D6DAE0">${esc(left)}</text>`;
    body += `<text x="640" y="${y}" text-anchor="end" font-size="17" font-weight="${strong ? 700 : 600}" fill="#D6DAE0">${esc(right)}</text>`;
  }

  section(214, 'PHP DRAWER', '#13355A', '#78BEFF');
  let y = 284;
  for (let i = 0; i < rows.length; i++, y += 34) kv(y, rows[i][0], rows[i][1], i === rows.length - 1);

  section(439, 'FOREX', '#4B3404', '#F2C66D');
  kv(505, 'BUY cash-out', '₱50,781.69');
  kv(540, 'Realized Forex Profit', '₱0.00');

  section(570, 'SCRATCH', '#2C2052', '#C6A7FF');
  y = 636;
  for (let i = 0; i < scratch.length; i++, y += 34) kv(y, scratch[i][0], scratch[i][1], i === scratch.length - 1);

  section(834, 'AUDIT NOTES', '#103625', '#7FE3A8');
  body += `<text x="78" y="898" font-size="15" fill="#D6DAE0">• PHP drawer reconciles exactly.</text>`;
  body += `<text x="78" y="929" font-size="15" fill="#D6DAE0">• Scratch reconciles exactly.</text>`;
  body += `<text x="78" y="960" font-size="15" fill="#D6DAE0">• USD and MYR were already reconciled and are not shown.</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <style>text{font-family:'DejaVu Sans',sans-serif}</style>${body}</svg>`;

  const fontDir = path.resolve(__dirname, '../../node_modules/dejavu-fonts-ttf/ttf');
  const fontFiles = [path.join(fontDir, 'DejaVuSans.ttf'), path.join(fontDir, 'DejaVuSans-Bold.ttf')];
  fontFiles.forEach(f => { if (!fs.existsSync(f)) throw new Error('Bundled font missing.'); });
  const resvg = new Resvg(svg, { font: { fontFiles, defaultFontFamily: 'DejaVu Sans', loadSystemFonts: false } });
  return Buffer.from(resvg.render().asPng());
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'GET required' };
  const png = render();
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
    isBase64Encoded: true,
    body: png.toString('base64'),
  };
};
