const { Resvg } = require('@resvg/resvg-js');

function esc(s=''){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function money(n){return `₱${Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;}

function render(){
  const W=880,H=1540,M=28,x0=M,x1=W-M,card=x1-x0;
  const C={bg:'#ffffff',ink:'#192320',mut:'#5b6763',green:'#1b694b',pale:'#ebf6f0',border:'#d8e0dc',navy:'#2b3b46',red:'#ad3737',pred:'#fceeee',amber:'#a06a12',pam:'#fcf7e7',grey:'#f6f8f7'};
  let y=24, s=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="${C.bg}"/>`;
  const box=(h,fill=C.bg,stroke=C.border)=>{s+=`<rect x="${x0}" y="${y}" width="${card}" height="${h}" rx="18" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;};
  const t=(x,yy,txt,size=19,weight=400,fill=C.ink,anchor='start')=>{s+=`<text x="${x}" y="${yy}" font-family="Arial,Helvetica,sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(txt)}</text>`;};
  const hr=(yy)=>{s+=`<line x1="${x0+18}" y1="${yy}" x2="${x1-18}" y2="${yy}" stroke="${C.border}"/>`;};
  const row=(yy,l,v,color=C.ink)=>{t(x0+22,yy,l,19,400,C.mut);t(x1-22,yy,v,20,700,color,'end');};

  box(112); s+=`<rect x="${x0}" y="${y}" width="10" height="112" rx="5" fill="${C.green}"/>`;
  t(x0+26,y+38,'PSULIT ALPHALAND',34,700); t(x0+28,y+83,'DAILY AUDIT • SEPTEMBER 29, 2026',20,700,C.green); t(x1-20,y+38,'FINAL',20,700,C.navy,'end'); t(x1-20,y+72,'Closing 8:29 PM',15,400,C.mut,'end'); y+=126;
  box(84,C.pam,'#ecdba9'); t(x0+22,y+34,'PHP & FX RECONCILED',20,700,C.amber); t(x0+22,y+64,'Scratch needs review: ₱5.00 short.',19,400,C.mut); y+=98;

  box(240); t(x0+22,y+36,'PHP DRAWER',23,700,C.navy); hr(y+52); let r=y+78;
  [['Opening PHP','₱111,287.11'],['− Forex BUY cash-out','₱35,793.13'],['+ Forex SELL cash-in','₱99,920.00'],['Expected PHP','₱175,413.98'],['Actual closing PHP','₱175,413.98']].forEach(([a,b],i)=>{row(r,a,b,i===4?C.green:C.ink);r+=31;});
  s+=`<rect x="${x0+18}" y="${y+197}" width="${card-36}" height="31" rx="10" fill="${C.pale}"/>`;t(x0+30,y+219,'PHP VARIANCE',20,700,C.green);t(x1-30,y+219,'₱0.00',20,700,C.green,'end'); y+=254;

  box(310); t(x0+22,y+36,'FOREIGN CURRENCY INVENTORY',23,700,C.navy); hr(y+52); t(x0+24,y+78,'Currency',15,400,C.mut);t(x0+270,y+78,'Expected',15,400,C.mut);t(x0+490,y+78,'Counted',15,400,C.mut);t(x1-26,y+78,'Var.',15,400,C.mut,'end');r=y+106;
  [['USD','129','129','0'],['JPY','40,000','40,000','0'],['AUD','300','300','0'],['EUR','300','300','0'],['MYR','77','77','0'],['TWD','700','700','0']].forEach(([a,b,c,d])=>{t(x0+24,r,a,19,400);t(x0+270,r,b,20,700);t(x0+490,r,c,20,700);t(x1-26,r,d,20,700,C.green,'end');r+=31;});
  s+=`<rect x="${x0+18}" y="${y+265}" width="${card-36}" height="32" rx="10" fill="${C.pale}"/>`;t(x0+30,y+288,'FX INVENTORY',20,700,C.green);t(x1-30,y+288,'RECONCILED',20,700,C.green,'end'); y+=324;

  box(238); t(x0+22,y+36,'SCRATCH IT',23,700,C.navy); hr(y+52);r=y+78;
  [['Opening cash','₱17,158.00'],['+ Sales','₱500.00'],['− Payouts','₱250.00'],['Expected closing','₱17,408.00'],['Actual closing','₱17,403.00']].forEach(([a,b],i)=>{row(r,a,b,i===4?C.red:C.ink);r+=31;});
  s+=`<rect x="${x0+18}" y="${y+196}" width="${card-36}" height="30" rx="10" fill="${C.pred}"/>`;t(x0+30,y+218,'SCRATCH VARIANCE',20,700,C.red);t(x1-30,y+218,'−₱5.00',20,700,C.red,'end'); y+=252;

  box(278); t(x0+22,y+36,'OTHER CLOSING BALANCES',23,700,C.navy); hr(y+52);r=y+78;
  [['Hive','₱50,074.37'],['JuanPay','₱3,570.00'],['LottoMatik Cash','₱2,688.00'],['LottoMatik Wallet','₱6,626.52'],['Receivable — MB','₱19,780.00'],['Payable — Jennalyn','₱4,140.00']].forEach(([a,b])=>{row(r,a,b);r+=31;}); y+=292;

  box(178,C.grey); t(x0+22,y+36,'AUDIT SUMMARY',23,700,C.navy); hr(y+52);t(x0+24,y+81,'Closing PHP cash',19,400,C.mut);t(x1-24,y+81,'₱175,413.98',20,700,C.green,'end');t(x0+24,y+116,'Forex PHP equivalent',19,400,C.mut);t(x1-24,y+116,'₱236,336.60',20,700,C.ink,'end');t(x0+24,y+151,'Only issue',19,400,C.mut);t(x1-24,y+151,'Scratch −₱5.00',20,700,C.red,'end');
  return s+'</svg>';
}

exports.handler=async(event)=>{
  try{
    if(event.httpMethod!=='POST') return {statusCode:405,body:'POST required'};
    const body=JSON.parse(event.body||'{}');
    if(body.key!=='ALPHA-20260929-FINAL') return {statusCode:403,body:'Forbidden'};
    const token=process.env.TELEGRAM_BOT_TOKEN;
    if(!token) throw new Error('Telegram token missing');
    const png=new Resvg(render(),{fitTo:{mode:'width',value:880}}).render().asPng();
    const form=new FormData(); form.append('chat_id','-1004316052145'); form.append('message_thread_id','2'); form.append('caption','PSULIT ALPHALAND — FINAL CLOSING AUDIT\nSeptember 29, 2026\nPHP & FX reconciled • Scratch short ₱5.00'); form.append('photo',new Blob([png],{type:'image/png'}),'PSULIT-Alphaland-Audit-2026-09-29.png');
    const resp=await fetch(`https://api.telegram.org/bot${token}/sendPhoto`,{method:'POST',body:form}); const tg=await resp.json(); if(!resp.ok||!tg.ok) throw new Error(tg.description||`Telegram ${resp.status}`);
    return {statusCode:200,headers:{'content-type':'application/json'},body:JSON.stringify({ok:true,messageId:tg.result.message_id,chatId:'-1004316052145',threadId:2})};
  }catch(e){return {statusCode:500,headers:{'content-type':'application/json'},body:JSON.stringify({ok:false,error:e.message||String(e)})};}
};
