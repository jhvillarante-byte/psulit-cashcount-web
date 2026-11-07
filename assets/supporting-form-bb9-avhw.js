// Standalone PDF generator for PSulit Cash Log supporting forms.
// Intentionally has no external chunk imports so generation works in static Netlify deploys.
const formTitles = {
  "Owner Collection": "OWNER COLLECTION ACKNOWLEDGMENT",
  "Receivable": "RECEIVABLE / CASH ADVANCE FORM",
  "Receivable Settlement": "RECEIVABLE SETTLEMENT ACKNOWLEDGMENT",
  "Payable Settlement": "PAYABLE SETTLEMENT ACKNOWLEDGMENT",
  "Internal Transfer": "INTERNAL FUND TRANSFER FORM",
  "Inter-Branch Transfer OUT": "INTER-BRANCH TRANSFER FORM",
  "Inter-Branch Transfer IN": "INTER-BRANCH TRANSFER FORM",
  "Currency Exchange": "CURRENCY EXCHANGE / WHOLESALE EXCHANGE FORM"
};
const fmt = value => value == null ? "" : String(value);
function rowsFor(e, employee, date) {
  const rows = [
    ["Reference", e.transferReference || e.receivableReference || ""],
    ["Official Date", date || e.date || ""],
    ["Branch", e.branch || ""],
    ["Employee", employee || ""],
    ["Description / Details", e.description || ""],
    ["Amount (PHP)", e.amount || e.actualAmount || ""],
  ];
  const cat = e.category;
  if (cat === "Owner Collection") rows.push(["Owner / Recipient", e.borrowerCompany || ""], ["Source Fund", e.fundDrawerUsed || ""]);
  if (cat === "Receivable") rows.push(["Person / Company", e.borrowerCompany || ""], ["Source Fund", e.fundDrawerUsed || ""], ["Currency", e.actualCurrency || "PHP"], ["Amount Owed", e.actualAmount || e.amount || ""]);
  if (cat === "Receivable Settlement") rows.push(["Receivable Reference", e.receivableReference || ""], ["Settlement Method", e.settlementMethod || ""], ["Received Into", e.fundDrawerUsed || ""], ["Amount Settled", e.amount || e.actualAmount || ""]);
  if (cat === "Payable Settlement") rows.push(["Payable Reference", e.receivableReference || e.transferReference || ""], ["Settlement Method", e.settlementMethod || ""], ["Paid From", e.fundDrawerUsed || ""], ["Amount Settled", e.amount || e.actualAmount || ""]);
  if (["Internal Transfer", "Inter-Branch Transfer OUT", "Inter-Branch Transfer IN"].includes(cat)) rows.push(["Source Fund", e.fundDrawerUsed || ""], ["Destination Fund", e.destinationFund || ""], ["Transfer Reference", e.transferReference || ""], ["From Branch", e.sourceBranch || e.branch || ""], ["To Branch", e.destinationBranch || ""]);
  if (cat === "Currency Exchange") rows.push(["Currency Given", e.actualCurrency || ""], ["Amount Given", e.actualAmount || ""], ["Currency Received", e.receivedCurrency || ""], ["Amount Received", e.receivedAmount || ""], ["Exchange Rate", e.valuationRate || ""]);
  return rows;
}
function pdfEscape(s) {
  return String(s).normalize("NFKD").replace(/[^\x20-\x7E]/g, "-").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
function wrap(s, max = 66) {
  const words = pdfEscape(s).split(/\s+/); const out=[]; let line="";
  for (const word of words) { if ((line ? line.length + 1 : 0) + word.length > max && line) { out.push(line); line=word; } else line += (line ? " " : "") + word; }
  out.push(line); return out;
}
function makePdf(lines) {
  const cmds=[]; let y=790;
  const text=(x,yy,size,str,bold=false)=>cmds.push(`BT /${bold?'F2':'F1'} ${size} Tf ${x} ${yy} Td (${pdfEscape(str)}) Tj ET`);
  cmds.push('0.03 0.47 0.24 rg 0 748 595 94 re f');
  text(38,804,18,'PSulit Money Changer',true); text(38,780,10,lines.title,true);
  cmds.push('0 0 0 rg'); text(38,728,8,'Generated: '+lines.generated);
  let yy=702;
  for (const [label,value] of lines.rows) {
    const wrapped=wrap(value || ' ' ,48); const h=Math.max(30,wrapped.length*11+17);
    if (yy-h<245) break;
    cmds.push(`0.78 0.84 0.80 RG 0.7 w 35 ${yy-h+3} 525 ${h} re S`);
    text(44,yy-12,8.5,label,true);
    wrapped.forEach((part,i)=>text(220,yy-12-i*11,9,part)); yy-=h;
  }
  yy=Math.min(yy-14,230);
  for (const label of lines.signatures) {
    if (yy<75) break;
    text(38,yy+13,8,label,true); cmds.push(`0.4 0.5 0.43 RG 0.7 w 38 ${yy} m 278 ${yy} l S`); yy-=42;
  }
  text(35,28,7,'Complete, sign, and upload this supporting document with the Cash Log entry.');
  const stream=cmds.join('\n');
  const objs=[];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>');
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  objs.push(`<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`);
  let pdf='%PDF-1.4\n%PSulit\n', offsets=[0];
  for(let i=0;i<objs.length;i++){offsets.push(new TextEncoder().encode(pdf).length);pdf+=`${i+1} 0 obj\n${objs[i]}\nendobj\n`;}
  const xref=new TextEncoder().encode(pdf).length;
  pdf+=`xref\n0 ${objs.length+1}\n0000000000 65535 f \n`;
  for(let i=1;i<offsets.length;i++)pdf+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
  pdf+=`trailer\n<< /Size ${objs.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
export async function generateSupportingForm(values, employee, date) {
  const category=fmt(values?.category);
  const title=formTitles[category] || `${category.toUpperCase()} SUPPORTING FORM`;
  const rows=rowsFor(values || {},employee,date);
  const signatures = category === 'Receivable Settlement'
    ? ['Received By - Name & Signature','Verified By - Name & Signature','Approved By - Name & Signature']
    : category === 'Payable Settlement'
      ? ['Paid By - Name & Signature','Verified By - Name & Signature','Approved By - Name & Signature']
      : ['Prepared / Released By - Name & Signature','Received By - Name & Signature','Approved By - Name & Signature'];
  return makePdf({title,rows,signatures,generated:new Date().toLocaleString('en-PH',{timeZone:'Asia/Manila'})});
}
export function supportingFormData(values, employee, date) { return { title: formTitles[fmt(values?.category)] || `${fmt(values?.category).toUpperCase()} SUPPORTING FORM`, rows: rowsFor(values || {},employee,date), fillable: [] }; }
