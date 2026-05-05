// ── PDF HTML生成ライブラリ ──────────────────────────────────

const fm = (n) => Number(n || 0).toLocaleString("ja-JP");
const fd = (d) => {
  if (!d) return "";
  try {
    const t = new Date(d);
    return isNaN(t) ? String(d) : `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`;
  } catch { return String(d); }
};

export function calcTax(items = []) {
  let s8 = 0, s10 = 0;
  (items || []).forEach((i) => {
    const a = Number(i.amount || 0), red = i.reduced !== false;
    if (i.taxIncluded) { if (red) s8 += Math.round(a / 1.08); else s10 += Math.round(a / 1.10); }
    else { if (red) s8 += a; else s10 += a; }
  });
  const t8 = Math.round(s8 * 0.08), t10 = Math.round(s10 * 0.10);
  const sub = s8 + s10, tax = t8 + t10;
  const hasTI = (items || []).some((i) => i.taxIncluded);
  const total = hasTI ? (items || []).reduce((s, i) => s + Number(i.amount || 0), 0) : sub + tax;
  return { s8, s10, t8, t10, sub, tax, total };
}

function css() {
  return `<style>*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Hiragino Sans","Yu Gothic UI","Meiryo",sans-serif;padding:12mm 15mm;color:#111;font-size:9.5pt;line-height:1.6}
h1{font-size:18pt;text-align:center;margin-bottom:5mm;letter-spacing:4px;font-weight:400}
.hd{display:flex;justify-content:space-between;margin-bottom:4mm}
.to-name{font-size:15pt;font-weight:bold;margin-bottom:1mm}.to-sub{font-size:8.5pt;color:#444}
.co{text-align:right;font-size:8.5pt;line-height:1.8}.co-name{font-size:11pt;font-weight:bold}
.logo-box{border:2px solid #2a6a2a;border-radius:3px;display:inline-block;padding:1mm 4mm;margin-bottom:1.5mm}
.logo-txt{font-size:12pt;font-weight:bold;color:#2a6a2a;letter-spacing:2px}
.meta{border-collapse:collapse}.meta td{border:none;padding:1px 4px;font-size:8.5pt}.meta .l{color:#666;text-align:right}
.sbj{display:flex;align-items:baseline;gap:6mm;border-top:1px solid #999;border-bottom:1px solid #999;padding:2mm 0;margin-bottom:3mm}
.sbj-l{font-size:8pt;color:#555;white-space:nowrap}
.sum-tbl{border-collapse:collapse;margin-bottom:4mm}
.sum-tbl th,.sum-tbl td{border:1px solid #bbb;padding:4px 12px;font-size:9pt;text-align:right}
.sum-tbl th{background:#f0f0f0;text-align:center}.sum-big{font-size:14pt;font-weight:bold}
.amt-row{display:flex;align-items:baseline;gap:6mm;margin-bottom:3mm}
.amt-lbl{font-size:8.5pt;color:#555}.amt-val{font-size:18pt;font-weight:bold}
table.main{width:100%;border-collapse:collapse;margin-bottom:2mm}
table.main thead tr{background:#1a2744;color:#fff}
table.main th{padding:5px 6px;font-size:8.5pt;font-weight:400}
table.main td{border:0.5px solid #ccc;padding:4px 6px;font-size:8.5pt}
.r{text-align:right}.c{text-align:center}
.emp td{border-color:#e8e8e8;height:13px}tr:nth-child(even) td{background:#f8f8f8}
.tnote{font-size:7.5pt;color:#555;margin-bottom:3mm}
.totals{float:right;width:195px;margin-bottom:4mm}
.totals table{width:100%;border-collapse:collapse}
.totals td{padding:3px 6px;border:0.5px solid #ccc;font-size:8.5pt}
.totals .lbl{color:#444}.totals .val{text-align:right}
.grand td{font-size:11pt;font-weight:bold;background:#f0f0f0}
.det td{font-size:7.5pt;color:#666;background:#fafafa}.cf{clear:both}
.ftr{display:flex;gap:8mm;font-size:8.5pt;margin-top:2mm}
.ftr-l{color:#666;margin-bottom:1mm}
.note-box{border:1px solid #bbb;padding:2mm 3mm;min-height:14mm;font-size:8.5pt;margin-top:3mm}
.nlbl{font-size:8pt;color:#666;margin-bottom:1mm}
.seals{display:flex;gap:6mm;margin-top:5mm}
.seal{border:1px solid #bbb;width:18mm;height:18mm;display:flex;align-items:center;justify-content:center;font-size:7pt;color:#aaa}
.pbtn{position:fixed;top:10px;right:10px;padding:8px 18px;background:#1a2744;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:11pt;font-family:inherit;z-index:99}
@media print{.pbtn{display:none}}</style>`;
}

function coBlock(co, date, no, typeLabel) {
  return `<div class="co">
<table class="meta"><tbody>
<tr><td class="l">登録番号</td><td>${co.regNo || ""}</td></tr>
<tr><td class="l">${typeLabel === "納品書" ? "納品日" : "請求日"}</td><td>${date}</td></tr>
<tr><td class="l">${typeLabel === "納品書" ? "納品書番号" : "請求書番号"}</td><td>${no}</td></tr>
</tbody></table>
<div style="margin-top:2mm"><div class="logo-box"><span class="logo-txt">DAISHO</span></div></div>
<div class="co-name">${co.name || ""}</div>
<div>${co.manager || ""}</div>
<div>${co.addr || ""}</div>
<div>${co.tel || ""}</div>
<div>${co.fax || ""}</div>
</div>`;
}

function buildRows(items = [], hasDate = false) {
  const MIN = Math.max((items || []).length, 16);
  let h = "";
  for (let i = 0; i < MIN; i++) {
    const it = (items || [])[i];
    if (it) {
      const mark = it.reduced !== false ? " ※" : "";
      const dc = hasDate ? `<td>${fd(it.date) || ""}</td>` : "";
      h += `<tr>${dc}<td>${it.name || ""}${mark}</td><td class="c">${it.qty || ""} ${it.unit || ""}</td><td class="r">${it.price ? fm(it.price) : ""}</td><td class="r">${fm(it.amount)}</td></tr>`;
    } else {
      h += `<tr class="emp">${hasDate ? "<td></td>" : ""}<td></td><td></td><td></td><td></td></tr>`;
    }
  }
  return h;
}

function taxBlock(tx) {
  return `<div class="totals"><table>
<tr><td class="lbl">小計</td><td class="val">${fm(tx.sub)}円</td></tr>
<tr><td class="lbl">消費税</td><td class="val">${fm(tx.tax)}円</td></tr>
<tr class="grand"><td class="lbl">合計</td><td class="val">${fm(tx.total)}円</td></tr>
<tr class="det"><td colspan="2" style="padding-top:4px">内　訳</td></tr>
<tr class="det"><td class="lbl">軽減税率8%対象(税抜)</td><td class="val">${fm(tx.s8)}円</td></tr>
<tr class="det"><td class="lbl">軽減税率8%消費税</td><td class="val">${fm(tx.t8)}円</td></tr>
</table></div><div class="cf"></div>`;
}

export function buildDeliveryHTML(doc, co) {
  const tx = calcTax(doc.items);
  const no = doc.docNo || `DEL-${Date.now()}`;
  const date = fd(doc.date) || new Date().toISOString().slice(0, 10);
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>納品書 ${no}</title>${css()}</head><body>
<button class="pbtn" onclick="window.print()">🖨 印刷 / PDF保存</button>
<h1>納　品　書</h1>
<div class="hd">
<div><div class="to-name">${doc.customer || ""} 御中</div><div class="to-sub">${doc.toAddr || ""}</div></div>
${coBlock(co, date, no, "納品書")}
</div>
<div class="sbj"><span class="sbj-l">件名</span><span>${doc.subject || ""}</span></div>
<table class="sum-tbl"><tr><th>小計</th><th>消費税</th><th>合計金額</th></tr>
<tr><td>${fm(tx.sub)}円</td><td>${fm(tx.tax)}円</td><td class="sum-big">${fm(tx.total)}円</td></tr></table>
<table class="main"><thead><tr><th>摘要</th><th class="c">数量</th><th class="r">単価</th><th class="r">明細金額</th></tr></thead>
<tbody>${buildRows(doc.items, false)}</tbody></table>
<p class="tnote">※印は軽減税率対象です。</p>
${taxBlock(tx)}
<div class="note-box"><div class="nlbl">備考</div>${doc.note || ""}</div>
<div class="seals"><div class="seal">担当</div><div class="seal">確認</div></div>
</body></html>`;
}

export function buildInvoiceHTML(doc, co) {
  const tx = calcTax(doc.items);
  const no = doc.docNo || `INV-${Date.now()}`;
  const date = fd(doc.date) || new Date().toISOString().slice(0, 10);
  const bank = (doc.bank || co.bankA || "").split(/　|  /).join("<br>");
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>請求書 ${no}</title>${css()}</head><body>
<button class="pbtn" onclick="window.print()">🖨 印刷 / PDF保存</button>
<h1>請　求　書</h1>
<div class="hd">
<div><div class="to-name">${doc.customer || ""} 御中</div>
<div class="to-sub">${doc.toAddr || ""}</div>
${doc.toContact ? `<div class="to-sub">${doc.toContact}</div>` : ""}
</div>
${coBlock(co, date, no, "請求書")}
</div>
<div class="sbj"><span class="sbj-l">件名</span><span>${doc.subject || ""}</span></div>
<div class="amt-row"><span class="amt-lbl">請求金額</span><span class="amt-val">${fm(tx.total)}円</span></div>
<table class="main"><thead><tr><th style="width:22mm">取引日</th><th>摘要</th><th class="c" style="width:22mm">数量</th><th class="r" style="width:18mm">単価</th><th class="r" style="width:22mm">明細金額</th></tr></thead>
<tbody>${buildRows(doc.items, true)}</tbody></table>
<p class="tnote">※印は軽減税率対象です。</p>
${taxBlock(tx)}
<div class="ftr">
<div><div class="ftr-l">入金期日</div><div>${doc.dueDate ? fd(doc.dueDate) : ""}</div></div>
<div><div class="ftr-l">振込先</div><div style="line-height:1.7">${bank}</div></div>
</div>
<div class="note-box"><div class="nlbl">備考</div>${doc.note || ""}</div>
<div class="seals"><div class="seal">担当</div><div class="seal">社印</div></div>
</body></html>`;
}

export function buildReceiptHTML(doc, co) {
  const amt = Number(doc.amount || 0);
  const tax = Math.round(amt - amt / 1.08);
  const no = doc.docNo || `REC-${Date.now()}`;
  const date = fd(doc.date) || new Date().toISOString().slice(0, 10);
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>領収書 ${no}</title>${css()}</head><body>
<button class="pbtn" onclick="window.print()">🖨 印刷 / PDF保存</button>
<h1>領　収　書</h1>
<div class="hd">
<div><div class="to-name">${doc.customer || ""} 様</div><div class="to-sub">${date}　No. ${no}</div></div>
${coBlock(co, date, no, "領収書")}
</div>
<div style="border:2px solid #1a2744;border-radius:4px;padding:5mm;text-align:center;margin:5mm 0">
<div style="font-size:9pt;color:#555;margin-bottom:2mm">領　収　金　額</div>
<div style="font-size:22pt;font-weight:bold">¥${fm(amt)} -</div>
<div style="font-size:8.5pt;color:#555;margin-top:2mm">（うち消費税等 ¥${fm(tax)}）</div>
</div>
<div style="font-size:9pt;margin:3mm 0">但し　${doc.description || "商品代として"}</div>
<div style="font-size:9pt">上記金額を確かに領収いたしました。</div>
<div style="text-align:right;margin-top:6mm;font-size:10pt;font-weight:bold">${co.name || ""}</div>
<div class="seals"><div class="seal" style="width:22mm;height:22mm">収入印紙</div><div class="seal" style="width:22mm;height:22mm">社印</div></div>
</body></html>`;
}

export function openPDF(doc, co) {
  const html =
    doc.docType === "請求書" ? buildInvoiceHTML(doc, co) :
    doc.docType === "領収書" ? buildReceiptHTML(doc, co) :
    buildDeliveryHTML(doc, co);
  const b = new Blob([html], { type: "text/html;charset=utf-8" });
  window.open(URL.createObjectURL(b), "_blank");
}
