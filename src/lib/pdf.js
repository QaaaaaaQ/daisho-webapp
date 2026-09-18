// ── PDF生成ライブラリ v3.0 ─────────────────────────────────────
// 変更: jsPDF直接生成・角印背景化・DAISHO2倍・不要要素削除・行高統一

const fm = (n) => Number(n || 0).toLocaleString("ja-JP");
const fd = (d) => {
  if (!d) return "";
  try {
    const t = new Date(d);
    return isNaN(t) ? String(d) : t.getFullYear() + "-" + String(t.getMonth()+1).padStart(2,"0") + "-" + String(t.getDate()).padStart(2,"0");
  } catch { return String(d); }
};

const esc = (value) => String(value == null ? "" : value)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;").replace(/'/g, "&#39;");

export function calcTax(items) {
  items = items || [];
  let s8 = 0, s10 = 0, gross8 = 0, gross10 = 0;
  items.forEach(function(i) {
    const a = Number(i.amount || 0);
    const rate = Number(i.taxRate) === 10 ? 10 : 8;
    const excl = i.taxIncluded ? (rate === 8 ? Math.round(a/1.08) : Math.round(a/1.10)) : a;
    if (rate === 10) s10 += excl; else s8 += excl;
    if (rate === 10) gross10 += i.taxIncluded ? a : excl + Math.round(excl * 0.10);
    else gross8 += i.taxIncluded ? a : excl + Math.round(excl * 0.08);
  });
  const t8 = Math.round(s8*0.08), t10 = Math.round(s10*0.10);
  const sub = s8+s10, tax = t8+t10;
  const total = gross8 + gross10;
  return {s8,s10,t8,t10,sub,tax,total,gross8,gross10};
}

// ── 右上ブロック: メタ情報 + ロゴ(2倍) + 社名(角印背景) ──────
function coBlock(co, date, no, typeLabel) {
  const dateLabel = typeLabel === "納品書" ? "納品日" : typeLabel === "見積書" ? "見積日" : typeLabel === "領収書" ? "発行日" : "請求日";
  const noLabel   = typeLabel === "納品書" ? "納品書番号" : typeLabel === "見積書" ? "見積書番号" : typeLabel === "領収書" ? "領収書番号" : "請求書番号";

  // ロゴ: 2倍サイズ
  const logoHtml = (co && co.logoImg)
    ? '<img src="' + co.logoImg + '" style="height:86px;max-width:336px;object-fit:contain;display:block;margin:3mm 0 3mm auto" alt="logo"/>'
    : '<div style="border:4px solid #2a6a2a;border-radius:5px;display:inline-block;padding:3mm 9mm;margin:3mm 0 3mm 0">' +
      '<span style="font-size:32pt;font-weight:bold;color:#2a6a2a;letter-spacing:5px">DAISHO</span></div>';

  // 会社情報 + 角印を背景に
  var sealImg = (co && co.sealImg)
    ? '<img src="' + co.sealImg + '" style="width:100px;height:100px;object-fit:contain;opacity:0.60;flex-shrink:0"/>'
    : '';

  var coInfo = '<div style="display:flex;align-items:flex-start;gap:2mm;justify-content:flex-end">' +
    '<div style="text-align:right;padding:2mm 0">' +
    '<div style="font-size:11.5pt;font-weight:bold;margin-bottom:1mm">' + esc(co.name||"") + '</div>' +
    '<div style="font-size:8.5pt;line-height:1.8">' +
    esc(co.manager||"") + '<br>' +
    esc(co.addr||"") + '<br>' +
    esc(co.tel||"") + '　' + esc(co.fax||"") +
    '</div></div>' + sealImg + '</div>';

  return '<div style="text-align:right">' +
    '<table style="border-collapse:collapse;margin-left:auto;margin-bottom:1mm"><tbody>' +
    '<tr><td style="color:#666;font-size:8pt;text-align:right;padding:1px 5px;border:none">登録番号</td>' +
    '<td style="font-size:8pt;padding:1px 4px;border:none">' + esc(co.regNo||"") + '</td></tr>' +
    '<tr><td style="color:#666;font-size:8pt;text-align:right;padding:1px 5px;border:none">' + dateLabel + '</td>' +
    '<td style="font-size:8pt;padding:1px 4px;border:none">' + date + '</td></tr>' +
    '<tr><td style="color:#666;font-size:8pt;text-align:right;padding:1px 5px;border:none">' + noLabel + '</td>' +
    '<td style="font-size:8pt;padding:1px 4px;border:none">' + no + '</td></tr>' +
    '</tbody></table>' +
    logoHtml +
    coInfo +
    '</div>';
}

function taxBlock(tx) {
  let rows =
    '<tr><td style="padding:3px 7px;border:0.5px solid #ccc;color:#444">小計</td><td style="padding:3px 7px;border:0.5px solid #ccc;text-align:right">' + fm(tx.sub) + '円</td></tr>' +
    '<tr><td style="padding:3px 7px;border:0.5px solid #ccc;color:#444">消費税</td><td style="padding:3px 7px;border:0.5px solid #ccc;text-align:right">' + fm(tx.tax) + '円</td></tr>' +
    '<tr><td style="padding:3px 7px;border:0.5px solid #ccc;font-size:11pt;font-weight:bold;background:#f0f0f0">合計</td>' +
    '<td style="padding:3px 7px;border:0.5px solid #ccc;font-size:11pt;font-weight:bold;text-align:right;background:#f0f0f0">' + fm(tx.total) + '円</td></tr>' +
    '<tr><td colspan="2" style="padding:3px 7px;border:0.5px solid #ccc;font-size:7pt;color:#666;background:#fafafa">内　訳</td></tr>';
  if (tx.s8 > 0) rows +=
    '<tr><td style="padding:2px 7px;border:0.5px solid #ccc;font-size:7.5pt;color:#555;background:#fafafa">軽減税率8%対象(税抜)</td><td style="padding:2px 7px;border:0.5px solid #ccc;font-size:7.5pt;text-align:right;background:#fafafa">' + fm(tx.s8) + '円</td></tr>' +
    '<tr><td style="padding:2px 7px;border:0.5px solid #ccc;font-size:7.5pt;color:#555;background:#fafafa">軽減税率8%消費税</td><td style="padding:2px 7px;border:0.5px solid #ccc;font-size:7.5pt;text-align:right;background:#fafafa">' + fm(tx.t8) + '円</td></tr>';
  if (tx.s10 > 0) rows +=
    '<tr><td style="padding:2px 7px;border:0.5px solid #ccc;font-size:7.5pt;color:#555;background:#fafafa">標準税率10%対象(税抜)</td><td style="padding:2px 7px;border:0.5px solid #ccc;font-size:7.5pt;text-align:right;background:#fafafa">' + fm(tx.s10) + '円</td></tr>' +
    '<tr><td style="padding:2px 7px;border:0.5px solid #ccc;font-size:7.5pt;color:#555;background:#fafafa">標準税率10%消費税</td><td style="padding:2px 7px;border:0.5px solid #ccc;font-size:7.5pt;text-align:right;background:#fafafa">' + fm(tx.t10) + '円</td></tr>';
  return '<div style="float:right;width:200px;margin-bottom:4mm"><table style="width:100%;border-collapse:collapse">' + rows + '</table></div><div style="clear:both"></div>';
}

// 行高を統一した明細テーブル
function buildRows(items, hasDate) {
  items = items || [];
  const ROW_H = "height:16px";
  var B2 = "border:0.5px solid #ccc;" + ROW_H + ";font-size:8.5pt;overflow:hidden;padding:3px 4px";
  var TD  = "style=\"" + B2 + "\"";
  var TDR = "style=\"" + B2 + ";text-align:right\"";
  var TDC = "style=\"" + B2 + ";text-align:center\"";
  var TDorg  = "style=\"" + B2 + ";text-align:center;width:60px;min-width:60px;max-width:60px;font-size:7.5pt;color:#555\"";
  var TDsm   = "style=\"" + B2 + ";text-align:center;width:50px;min-width:50px;max-width:50px\"";
  var TDprice= "style=\"" + B2 + ";text-align:right;width:60px;min-width:60px;max-width:60px\"";
  var TDamt  = "style=\"" + B2 + ";text-align:right;width:64px;min-width:64px;max-width:64px\"";
  var TDTax  = "style=\"" + B2 + ";text-align:center;width:46px;min-width:46px;max-width:46px;font-size:7.5pt\"";
  const MIN = Math.max(items.length, 14);
  let h = "";
  for (let i = 0; i < MIN; i++) {
    const it = items[i];
    if (it) {
      const mark = Number(it.taxRate) === 10 ? "" : " ※";
      const dc = hasDate ? "<td " + TD + ">" + esc(fd(it.date)||"") + "</td>" : "";
      h += "<tr>" + dc +
        "<td " + TD + ">" + esc(it.name||"") + mark + "</td>" +
        "<td " + TD + " style='border:0.5px solid #ccc;padding:3px 4px;height:16px;font-size:7.5pt;color:#666'>" + esc(it.origin||"") + "</td>" +
        "<td " + TDC + ">" + esc(it.caseCount||"") + "</td>" +
        "<td " + TDC + ">" + esc(it.qtyPerCase||"") + "</td>" +
        "<td " + TDC + ">" + esc(it.qty||"") + "</td>" +
        "<td " + TDC + ">" + esc(it.unit||"") + "</td>" +
        "<td " + TDR + ">" + (it.price ? fm(it.price) : "") + "</td>" +
        "<td " + TDR + ">" + fm(it.amount) + "</td>" +
        "<td " + TDTax + ">" + (Number(it.taxRate)===10?"10%":"8%") + (it.taxIncluded?" 内":" 外") + "</td></tr>";
    } else {
      const dc = hasDate ? "<td " + TD + "></td>" : "";
      h += "<tr>" + dc +
        "<td " + TD + "></td>" +
        "<td " + TDorg + "></td>" +
        "<td " + TDsm + "></td><td " + TDsm + "></td>" +
        "<td " + TDsm + "></td><td " + TDsm + "></td>" +
        "<td " + TDprice + "></td><td " + TDamt + "></td><td " + TDTax + "></td></tr>";
    }
  }
  return h;
}

function tableHead(hasDate) {
  // 各列の幅をth・tdの両方に直接指定（html2canvas/colgroup非対応対策）
  var W = {
    date:  "width:72px;min-width:72px;max-width:72px",
    name:  "min-width:60px",           // 品名: 残り全部
    org:   "width:60px;min-width:60px;max-width:60px",
    cs:    "width:50px;min-width:50px;max-width:50px",
    qty:   "width:50px;min-width:50px;max-width:50px",
    unit:  "width:50px;min-width:50px;max-width:50px",
    price: "width:60px;min-width:60px;max-width:60px",
    amt:   "width:64px;min-width:64px;max-width:64px",
    tax:   "width:46px;min-width:46px;max-width:46px"
  };
  var B = "background:#1a2744;color:#fff;padding:4px 3px;font-weight:400;overflow:hidden;";
  function th(w, label, align) {
    align = align || "left";
    return "<th style='" + B + W[w] + ";font-size:8.5pt;text-align:" + align + "'>" + label + "</th>";
  }
  var dateTh = hasDate ? th("date","取引日") : "";
  return "<thead><tr>" + dateTh +
    th("name","品名") +
    th("org","産地","center") +
    th("cs","CS","center") +
    th("cs","入数","center") +
    th("qty","数量","center") +
    th("unit","単位","center") +
    th("price","単価","right") +
    th("amt","明細金額","right") +
    th("tax","税","center") +
    "</tr></thead>";
}

function taxNote(items) {
  items = items || [];
  const has8  = items.some(function(i){return Number(i.taxRate)!==10;});
  const has10 = items.some(function(i){return Number(i.taxRate)===10;});
  let note = "";
  if (has8)  note += "※印は軽減税率（8%）対象です。";
  if (has10) note += (has8 ? "　" : "") + "△印は標準税率（10%）対象です。";
  return note ? '<p style="font-size:7.5pt;color:#555;margin-bottom:2mm">' + note + '</p>' : "";
}

function baseCSS() {
  return '<style>*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:"Hiragino Sans","Yu Gothic UI","Meiryo",sans-serif;padding:12mm 16mm;color:#111;font-size:9pt;line-height:1.5}' +
    'h1{font-size:17pt;text-align:center;margin-bottom:4mm;letter-spacing:4px;font-weight:400}' +
    '.hd{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4mm}' +
    '.to-name{font-size:14pt;font-weight:bold;margin-bottom:2mm}' +
    '.to-sub{font-size:8.5pt;color:#444;margin-bottom:1px}' +
    '.sbj{display:flex;align-items:baseline;gap:6mm;border-top:1px solid #999;border-bottom:1px solid #999;padding:2mm 0;margin-bottom:3mm}' +
    '.sbj-l{font-size:8pt;color:#555;white-space:nowrap}' +
    '.sum-tbl{border-collapse:collapse;margin-bottom:3mm}' +
    '.sum-tbl th,.sum-tbl td{border:1px solid #bbb;padding:4px 10px;font-size:9pt;text-align:right}' +
    '.sum-tbl th{background:#f0f0f0;text-align:center}' +
    '.sum-big{font-size:13pt;font-weight:bold}' +
    '.amt-row{display:flex;align-items:baseline;gap:6mm;margin-bottom:3mm}' +
    '.amt-val{font-size:17pt;font-weight:bold}' +
    '.amt-lbl{font-size:8.5pt;color:#555}' +
    'table.main{width:100%;border-collapse:collapse;margin-bottom:2mm;table-layout:fixed}' +
    '.note-box{border:1px solid #bbb;padding:2mm 3mm;min-height:12mm;font-size:8.5pt;margin-top:2mm}' +
    '.nlbl{font-size:7.5pt;color:#666;margin-bottom:1mm}' +
    '.ftr{display:flex;gap:8mm;font-size:8.5pt;margin-top:2mm}' +
    '.ftr-l{color:#666;margin-bottom:1mm}' +
    '</style>';
}

function buildDocumentHTML(doc, co) {
  return doc.docType === "請求書" ? buildInvoiceHTML(doc, co) :
    doc.docType === "領収書" ? buildReceiptHTML(doc, co) :
    doc.docType === "見積書" ? buildEstimateHTML(doc, co) :
    buildDeliveryHTML(doc, co);
}

// ─── 納品書 ────────────────────────────────────────────────────
export function buildDeliveryHTML(doc, co) {
  const tx = calcTax(doc.items);
  const no   = doc.docNo || "DEL-" + Date.now();
  const date = fd(doc.date) || fd(new Date());
  // 入金期日（あれば）
  const dueRow = doc.dueDate
    ? '<div style="font-size:8.5pt;color:#444;margin-top:2mm">入金期日：' + fd(doc.dueDate) + '</div>'
    : '';
  return '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>納品書 ' + no + '</title>' + baseCSS() + '</head><body>' +
    '<h1>納　品　書</h1>' +
    '<div class="hd">' +
      '<div>' +
        '<div class="to-name">' + esc(doc.customer||"") + ' 御中</div>' +
        (doc.toAddr ? '<div class="to-sub">' + esc(doc.toAddr) + '</div>' : '') +
        dueRow +
      '</div>' +
      coBlock(co, date, no, "納品書") +
    '</div>' +
    '<div class="sbj"><span class="sbj-l">件名</span><span>' + esc(doc.subject||"") + '</span></div>' +
    '<table class="sum-tbl"><tr><th>小計</th><th>消費税</th><th>合計金額</th></tr>' +
    '<tr><td>' + fm(tx.sub) + '円</td><td>' + fm(tx.tax) + '円</td><td class="sum-big">' + fm(tx.total) + '円</td></tr></table>' +
    '<table class="main">' + tableHead(false) + '<tbody>' + buildRows(doc.items, false) + '</tbody></table>' +
    taxNote(doc.items) +
    taxBlock(tx) +
    '<div class="note-box"><div class="nlbl">備考</div>' + esc(doc.note||"") + '</div>' +
    '</body></html>';
}

// ─── 請求書 ────────────────────────────────────────────────────
export function buildInvoiceHTML(doc, co) {
  const tx   = calcTax(doc.items);
  const no   = doc.docNo || "INV-" + Date.now();
  const date = fd(doc.date) || fd(new Date());
  const bank = esc(doc.bank || co.bankA || "").split(/　|  |\s{2}/).join("<br>");
  const toContact = doc.toContact ? '<div class="to-sub">' + esc(doc.toContact) + '</div>' : "";
  return '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>請求書 ' + no + '</title>' + baseCSS() + '</head><body>' +
    '<h1>請　求　書</h1>' +
    '<div class="hd">' +
      '<div>' +
        '<div class="to-name">' + esc(doc.customer||"") + ' 御中</div>' +
        (doc.toAddr ? '<div class="to-sub">' + esc(doc.toAddr) + '</div>' : '') +
        toContact +
      '</div>' +
      coBlock(co, date, no, "請求書") +
    '</div>' +
    '<div class="sbj"><span class="sbj-l">件名</span><span>' + esc(doc.subject||"") + '</span></div>' +
    '<div class="amt-row"><span class="amt-lbl">請求金額</span><span class="amt-val">' + fm(tx.total) + '円</span></div>' +
    '<table class="main">' + tableHead(true) + '<tbody>' + buildRows(doc.items, true) + '</tbody></table>' +
    taxNote(doc.items) +
    taxBlock(tx) +
    '<div class="ftr">' +
      '<div><div class="ftr-l">入金期日</div><div>' + (doc.dueDate ? fd(doc.dueDate) : "") + '</div></div>' +
      '<div><div class="ftr-l">振込先</div><div style="line-height:1.7">' + bank + '</div></div>' +
    '</div>' +
    '<div class="note-box"><div class="nlbl">備考</div>' + esc(doc.note||"") + '</div>' +
    '</body></html>';
}

// ─── 見積書 ────────────────────────────────────────────────────
export function buildEstimateHTML(doc, co) {
  var tx   = calcTax(doc.items);
  var no   = doc.docNo || "EST-" + Date.now();
  var date = fd(doc.date) || fd(new Date());
  var expiryRow = doc.expiryDate
    ? '<div style="font-size:8.5pt;color:#444;margin-top:2mm">有効期限：' + fd(doc.expiryDate) + '</div>' : '';
  var condRow = doc.conditions
    ? '<div style="font-size:8.5pt;color:#444;margin-top:1mm">取引条件：' + esc(doc.conditions) + '</div>' : '';
  return "<!DOCTYPE html><html lang='ja'><head><meta charset='utf-8'><title>見積書 " + no + "</title>" + baseCSS() + "</head><body>" +
    "<h1>見　積　書</h1>" +
    "<div class='hd'>" +
      "<div>" +
        "<div class='to-name'>" + esc(doc.customer||"") + " 御中</div>" +
        (doc.toAddr ? "<div class='to-sub'>" + esc(doc.toAddr) + "</div>" : "") +
        expiryRow + condRow +
      "</div>" +
      coBlock(co, date, no, "見積書") +
    "</div>" +
    "<div class='sbj'><span class='sbj-l'>件名</span><span>" + esc(doc.subject||"") + "</span></div>" +
    "<div class='amt-row'><span class='amt-lbl'>お見積金額</span><span class='amt-val'>" + fm(tx.total) + "円</span></div>" +
    "<table class='main'>" + tableHead(false) + "<tbody>" + buildRows(doc.items, false) + "</tbody></table>" +
    taxNote(doc.items) +
    taxBlock(tx) +
    "<div class='note-box'><div class='nlbl'>備考・取引条件</div>" + esc(doc.note||"") + "</div>" +
    "</body></html>";
}

// ─── 領収書 ────────────────────────────────────────────────────
export function buildReceiptHTML(doc, co) {
  const items = (doc.items || []).filter(function(i) {
    return i && (i.name || i.origin || i.qty || i.price || i.amount);
  });
  const itemTx = calcTax(items);
  const manualAmount = Number(doc.amount || 0);
  const amt  = manualAmount > 0 ? manualAmount : itemTx.total;
  const detailsMatchAmount = items.length > 0 && Math.abs(amt - itemTx.total) < 0.01;
  const tax  = detailsMatchAmount ? itemTx.tax : Math.round(amt - amt/1.08);
  const no   = doc.docNo || "REC-" + Date.now();
  const date = fd(doc.date) || fd(new Date());
  const description = doc.description || doc.subject || "商品代として";
  const details = detailsMatchAmount
    ? '<div class="nlbl">内容明細</div><table class="main">' + tableHead(true) + '<tbody>' + buildRows(items, true) + '</tbody></table>' + taxNote(items)
    : '<div class="note-box"><div class="nlbl">但し書き</div>' + esc(description) + '</div>';
  return '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>領収書 ' + no + '</title>' + baseCSS() + '</head><body>' +
    '<h1>領　収　書</h1>' +
    '<div class="hd"><div>' +
      '<div class="to-name">' + esc(doc.customer||"") + ' 様</div>' +
      '<div class="to-sub">' + date + '　No. ' + no + '</div>' +
    '</div>' + coBlock(co, date, no, "領収書") + '</div>' +
    '<div style="border:2px solid #1a2744;border-radius:4px;padding:5mm;text-align:center;margin:5mm 0">' +
      '<div style="font-size:9pt;color:#555;margin-bottom:2mm">領　収　金　額</div>' +
      '<div style="font-size:22pt;font-weight:bold">¥' + fm(amt) + ' -</div>' +
      '<div style="font-size:8pt;color:#555;margin-top:2mm">（うち消費税等 ¥' + fm(tax) + '）</div>' +
    '</div>' +
    details +
    (detailsMatchAmount ? '<div style="font-size:9pt;margin:3mm 0">但し　' + esc(description) + '</div>' : '') +
    '<div style="font-size:9pt">上記金額を確かに領収いたしました。</div>' +
    '</body></html>';
}

let japaneseFontPromise;

function bytesToBase64(bytes) {
  var binary = "";
  var chunk = 0x8000;
  for (var i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function loadJapaneseFont() {
  if (!japaneseFontPromise) {
    japaneseFontPromise = fetch("/fonts/NotoSansJP-VF.ttf", { cache: "force-cache" })
      .then(function(res) {
        if (!res.ok) throw new Error("日文字体を読み込めませんでした");
        return res.arrayBuffer();
      })
      .then(function(buffer) { return bytesToBase64(new Uint8Array(buffer)); });
  }
  return japaneseFontPromise;
}

function setupJapanesePdfFont(pdf, fontData) {
  pdf.addFileToVFS("NotoSansJP-VF.ttf", fontData);
  pdf.addFont("NotoSansJP-VF.ttf", "NotoSansJP", "normal");
  pdf.addFont("NotoSansJP-VF.ttf", "NotoSansJP", "bold");
  pdf.setFont("NotoSansJP", "normal");
}

const PAGE = { left: 16, right: 194, top: 12, bottom: 284, width: 178 };
const PDF_COLORS = {
  ink: [0, 0, 0],
  muted: [31, 41, 55],
  grid: [76, 89, 108],
  header: [26, 39, 68],
  totalFill: [226, 232, 240],
  labelFill: [241, 245, 249],
};

function hasTaxIncluded(items) {
  return (items || []).some(function(item) { return item && item.taxIncluded; });
}

function pdfFont(pdf, size, style) {
  pdf.setFont("NotoSansJP", style || "normal");
  pdf.setFontSize(size);
  pdf.setTextColor.apply(pdf, PDF_COLORS.ink);
}

function pdfLines(pdf, value, width, size) {
  pdfFont(pdf, size || 8.5);
  return pdf.splitTextToSize(String(value == null ? "" : value), width || PAGE.width);
}

function drawImage(pdf, src, type, x, y, w, h) {
  if (!src || typeof src !== "string" || !src.startsWith("data:image/")) return false;
  try {
    pdf.addImage(src, type || (/data:image\/jpe?g/i.test(src) ? "JPEG" : "PNG"), x, y, w, h, undefined, "FAST");
    return true;
  } catch (err) {
    return false;
  }
}

function drawCompanyBlock(pdf, co, date, no, typeLabel) {
  var label = typeLabel === "納品書" ? "納品日" : typeLabel === "見積書" ? "見積日" : typeLabel === "領収書" ? "発行日" : "請求日";
  var noLabel = typeLabel === "納品書" ? "納品書番号" : typeLabel === "見積書" ? "見積書番号" : typeLabel === "領収書" ? "領収書番号" : "請求書番号";
  var x = PAGE.right;
  pdfFont(pdf, 7.2);
  pdf.setTextColor.apply(pdf, PDF_COLORS.muted);
  pdf.text("登録番号", x - 33, 27, { align: "right" });
  pdf.text(label, x - 33, 32, { align: "right" });
  pdf.text(noLabel, x - 33, 37, { align: "right" });
  pdf.setTextColor.apply(pdf, PDF_COLORS.ink);
  pdf.text(String(co.regNo || ""), x, 27, { align: "right" });
  pdf.text(String(date || ""), x, 32, { align: "right" });
  pdf.text(String(no || ""), x, 37, { align: "right" });

  if (!drawImage(pdf, co.logoImg, undefined, 154, 43, 40, 19)) {
    pdf.setDrawColor(42, 106, 42);
    pdf.setLineWidth(0.7);
    pdf.roundedRect(155, 43, 39, 19, 1.2, 1.2, "S");
    pdfFont(pdf, 13, "bold");
    pdf.setTextColor(42, 106, 42);
    pdf.text("DAISHO", 174.5, 54.5, { align: "center" });
  }

  var seal = !!co.sealImg && drawImage(pdf, co.sealImg, undefined, 168, 64, 26, 26);
  var infoRight = seal ? 165 : PAGE.right;
  pdfFont(pdf, 9.2, "bold");
  pdf.text(String(co.name || ""), infoRight, 72, { align: "right" });
  pdfFont(pdf, 7.3);
  var info = [co.manager, co.addr, [co.tel, co.fax].filter(Boolean).join("　")].filter(Boolean).join("\n");
  var infoLines = pdfLines(pdf, info, seal ? 75 : 78, 7.3);
  pdf.text(infoLines, infoRight, 77, { align: "right", lineHeightFactor: 1.15 });
}

function drawStrongText(pdf, value, x, y, options) {
  var opts = options || {};
  var text = String(value == null ? "" : value);
  pdf.text(text, x, y, opts);
  if (opts.align === "center") {
    pdf.text(text, x + 0.18, y, opts);
  } else {
    pdf.text(text, x + 0.18, y, opts);
  }
}

function drawReadableText(pdf, value, x, y, options) {
  var opts = options || {};
  var text = String(value == null ? "" : value);
  pdf.text(text, x, y, opts);
  if (text) {
    pdf.text(text, x + 0.10, y, opts);
    pdf.text(text, x + 0.18, y, opts);
  }
}

function drawHeader(pdf, doc, co) {
  var title = doc.docType === "請求書" ? "請　求　書" : doc.docType === "領収書" ? "領　収　書" : doc.docType === "見積書" ? "見　積　書" : "納　品　書";
  var no = doc.docNo || (doc.docType === "請求書" ? "INV-" : doc.docType === "領収書" ? "REC-" : doc.docType === "見積書" ? "EST-" : "DEL-") + Date.now();
  var date = fd(doc.date) || fd(new Date());
  pdfFont(pdf, 17, "bold");
  drawStrongText(pdf, title, 105, 20, { align: "center" });
  pdfFont(pdf, 14, "bold");
  drawStrongText(pdf, String(doc.customer || "") + (doc.docType === "領収書" ? " 様" : " 御中"), PAGE.left, 42);
  pdfFont(pdf, 8.5);
  if (doc.toAddr) pdf.text(pdfLines(pdf, doc.toAddr, 76, 8.2), PAGE.left, 40, { lineHeightFactor: 1.35 });
  if (doc.toContact) pdf.text(pdfLines(pdf, doc.toContact, 76, 8.2), PAGE.left, doc.toAddr ? 46 : 40, { lineHeightFactor: 1.35 });
  drawCompanyBlock(pdf, co || {}, date, no, doc.docType);

  pdf.setDrawColor.apply(pdf, PDF_COLORS.grid);
  pdf.setLineWidth(0.35);
  pdf.line(PAGE.left, 99, PAGE.right, 99);
  pdf.line(PAGE.left, 107, PAGE.right, 107);
  pdfFont(pdf, 8, "normal");
  pdf.setTextColor.apply(pdf, PDF_COLORS.muted);
  pdf.text("件名", PAGE.left, 104);
  pdf.setTextColor.apply(pdf, PDF_COLORS.ink);
  var subject = doc.subject || "";
  pdf.text(pdfLines(pdf, subject, 155, 9), PAGE.left + 18, 104, { lineHeightFactor: 1.2 });
  return { y: 111, no: no, date: date };
}

function drawAmountLine(pdf, label, amount, y) {
  pdfFont(pdf, 9);
  pdf.setTextColor.apply(pdf, PDF_COLORS.muted);
  pdf.text(label, PAGE.left, y);
  pdfFont(pdf, 17, "bold");
  pdf.setTextColor.apply(pdf, PDF_COLORS.ink);
  pdf.text(fm(amount) + "円", PAGE.left + 25, y + 1);
  return y + 10;
}

function drawCompactSummary(pdf, tx, y, items) {
  var labels = [hasTaxIncluded(items) ? "税抜小計" : "小計", "消費税", "合計金額"];
  var values = [tx.sub, tx.tax, tx.total];
  var x = PAGE.left;
  var w = 17.5;
  var headerH = 6;
  var valueH = 8;
  for (var i = 0; i < labels.length; i += 1) {
    var isTotal = i === 2;
    pdf.setFillColor.apply(pdf, isTotal ? PDF_COLORS.totalFill : PDF_COLORS.labelFill);
    pdf.setDrawColor.apply(pdf, PDF_COLORS.grid);
    pdf.setLineWidth(0.35);
    pdf.rect(x + i * w, y, w, headerH, "FD");
    pdfFont(pdf, 7.6, "bold");
    pdf.setTextColor.apply(pdf, PDF_COLORS.ink);
    drawReadableText(pdf, labels[i], x + i * w + w / 2, y + 4.8, { align: "center" });
    pdf.setFillColor(255, 255, 255);
    pdf.rect(x + i * w, y + headerH, w, valueH, "FD");
    pdfFont(pdf, i === 2 ? 9.1 : 8.0, i === 2 ? "bold" : "normal");
    drawReadableText(pdf, fm(values[i]) + "円", x + i * w + w / 2, y + headerH + 5.8, { align: "center" });
  }
  return y + headerH + valueH + 3;
}

function tableColumns(hasDate) {
  var cols = hasDate
    ? [["date", "取引日", 18, "center"], ["name", "品名", 46, "left"], ["origin", "産地", 16, "center"], ["caseCount", "CS", 13, "center"], ["qtyPerCase", "入数", 13, "center"], ["qty", "数量", 14, "center"], ["unit", "単位", 13, "center"], ["price", "単価", 16, "right"], ["amount", "明細金額", 17, "right"], ["tax", "税", 12, "center"]]
    : [["name", "品名", 64, "left"], ["origin", "産地", 16, "center"], ["caseCount", "CS", 13, "center"], ["qtyPerCase", "入数", 13, "center"], ["qty", "数量", 14, "center"], ["unit", "単位", 13, "center"], ["price", "単価", 16, "right"], ["amount", "明細金額", 17, "right"], ["tax", "税", 12, "center"]];
  return cols;
}

function rowValue(item, key) {
  var hasValue = item && Object.keys(item).some(function(name) { return item[name] !== null && item[name] !== undefined && item[name] !== ""; });
  if (!hasValue) return "";
  if (key === "date") return fd(item.date) || "";
  if (key === "price") return item.price ? fm(item.price) : "";
  if (key === "amount") return fm(item.amount);
  if (key === "tax") return (Number(item.taxRate) === 10 ? "10%" : "8%") + (item.taxIncluded ? "内" : "外");
  return item[key] == null ? "" : String(item[key]);
}

function drawTableHeader(pdf, x, y, cols) {
  var h = 8;
  var cur = x;
  pdf.setDrawColor(255, 255, 255);
  pdf.setLineWidth(0.2);
  cols.forEach(function(col) {
    // setTextColor can change jsPDF's current fill color, so reset it per cell.
    pdf.setFillColor(26, 39, 68);
    pdf.rect(cur, y, col[2], h, "FD");
    pdfFont(pdf, col[2] < 13 ? 6.8 : 8.0);
    pdf.setTextColor(255, 255, 255);
    var tx = col[3] === "right" ? cur + col[2] - 1.5 : col[3] === "center" ? cur + col[2] / 2 : cur + 1.5;
    pdf.text(col[1], tx, y + 5.3, { align: col[3] });
    cur += col[2];
  });
  return y + h;
}

function drawTableRow(pdf, x, y, item, cols) {
  var fontSize = 7.8;
  var lineHeight = 3.1;
  var sets = cols.map(function(col) { return pdfLines(pdf, rowValue(item, col[0]), Math.max(4, col[2] - 3), fontSize); });
  var maxLines = Math.max.apply(null, sets.map(function(lines) { return Math.max(1, lines.length); }));
  var h = Math.max(4.7, maxLines * lineHeight + 1.8);
  var cur = x;
  pdf.setDrawColor.apply(pdf, PDF_COLORS.grid);
  pdf.setLineWidth(0.3);
  pdf.setFillColor(255, 255, 255);
  cols.forEach(function(col, index) {
    pdf.rect(cur, y, col[2], h, "S");
    pdfFont(pdf, fontSize + 0.4, "bold");
    var align = col[3];
    var tx = align === "right" ? cur + col[2] - 1.5 : align === "center" ? cur + col[2] / 2 : cur + 1.5;
    drawReadableText(pdf, sets[index], tx, y + 3.5, { align: align, lineHeightFactor: lineHeight / fontSize });
    cur += col[2];
  });
  return y + h;
}

function drawItemsTable(pdf, items, hasDate, y, minRows) {
  var cols = tableColumns(hasDate);
  var index = 0;
  var list = (items || []).filter(function(item) { return item && (item.name || item.origin || item.qty || item.price || item.amount); });
  if (!list.length) list = [{}];
  while (list.length < (minRows || 0)) list.push({});
  while (index < list.length) {
    if (y + 16 > PAGE.bottom) {
      pdf.addPage();
      y = 20;
      pdfFont(pdf, 10, "bold");
      pdf.text("明細（続き）", PAGE.left, y);
      y += 6;
    }
    y = drawTableHeader(pdf, PAGE.left, y, cols);
    while (index < list.length) {
      var probe = list[index];
      var rowLines = cols.map(function(col) { return pdfLines(pdf, rowValue(probe, col[0]), Math.max(4, col[2] - 3), 7.8).length; });
      var rowH = Math.max(4.7, Math.max.apply(null, rowLines) * 3.1 + 1.8);
      if (y + rowH > PAGE.bottom) break;
      y = drawTableRow(pdf, PAGE.left, y, probe, cols);
      index += 1;
    }
  }
  return y + 4;
}

function drawTaxSummary(pdf, tx, y, items) {
  var rows = [[hasTaxIncluded(items) ? "税抜小計" : "小計", tx.sub], ["消費税", tx.tax], ["合計", tx.total]];
  rows.push(["内　訳", null]);
  if (tx.s8 > 0) rows.push(["軽減税率8%対象(税抜)", tx.s8], ["軽減税率8%消費税", tx.t8]);
  if (tx.s10 > 0) rows.push(["標準税率10%対象(税抜)", tx.s10], ["標準税率10%消費税", tx.t10]);
  var x = 124, w = 70, h = 6;
  rows.forEach(function(row, index) {
    var isTotal = index === 2;
    var isLabel = row[1] == null;
    pdf.setFillColor.apply(pdf, isTotal ? PDF_COLORS.totalFill : isLabel ? PDF_COLORS.labelFill : [255, 255, 255]);
    pdf.setDrawColor.apply(pdf, PDF_COLORS.grid);
    pdf.setLineWidth(0.3);
    pdf.rect(x, y, w, h, "FD");
    pdfFont(pdf, isTotal ? 9.2 : isLabel ? 6.6 : 7.0, isTotal ? "bold" : "normal");
    pdf.setTextColor.apply(pdf, isLabel ? PDF_COLORS.muted : PDF_COLORS.ink);
    if (isLabel) {
      drawReadableText(pdf, row[0], x + 2, y + 4.1);
    } else {
      drawReadableText(pdf, row[0], x + 2, y + 4.1);
      drawReadableText(pdf, fm(row[1]) + "円", x + w - 2, y + 4.1, { align: "right" });
    }
    y += h;
  });
  return y + 3;
}

function drawTaxNote(pdf, items, y) {
  var has8 = (items || []).some(function(i) { return Number(i.taxRate) !== 10; });
  var has10 = (items || []).some(function(i) { return Number(i.taxRate) === 10; });
  if (!has8 && !has10) return y;
  pdfFont(pdf, 7.2);
  pdf.setTextColor.apply(pdf, PDF_COLORS.muted);
  pdf.text((has8 ? "※印は軽減税率（8%）対象です。" : "") + (has8 && has10 ? "　" : "") + (has10 ? "△印は標準税率（10%）対象です。" : ""), PAGE.left, y);
  return y + 6;
}

function drawBoxText(pdf, label, value, y, minHeight) {
  var lines = pdfLines(pdf, value || "", PAGE.width - 8, 8.2);
  var h = Math.max(minHeight || 14, lines.length * 4 + 8);
  pdf.setDrawColor.apply(pdf, PDF_COLORS.grid);
  pdf.setLineWidth(0.35);
  pdf.rect(PAGE.left, y, PAGE.width, h, "S");
  pdfFont(pdf, 7.1);
  pdf.setTextColor.apply(pdf, PDF_COLORS.muted);
  pdf.text(label, PAGE.left + 3, y + 5);
  pdfFont(pdf, 8.2);
  pdf.setTextColor.apply(pdf, PDF_COLORS.ink);
  if (value) pdf.text(lines, PAGE.left + 3, y + 10, { lineHeightFactor: 1.25 });
  return y + h + 3;
}

function drawInvoiceFooter(pdf, doc, co, y) {
  if (y + 30 > PAGE.bottom) { pdf.addPage(); y = 20; }
  pdfFont(pdf, 7.2);
  pdf.setTextColor.apply(pdf, PDF_COLORS.muted);
  pdf.text("入金期日", PAGE.left, y);
  pdf.text("振込先", 76, y);
  pdf.setTextColor.apply(pdf, PDF_COLORS.ink);
  pdfFont(pdf, 8.2);
  pdf.text(doc.dueDate ? fd(doc.dueDate) : "", PAGE.left, y + 6);
  var bank = doc.bank || co.bankA || "";
  pdf.text(pdfLines(pdf, bank, 116, 8.2), 76, y + 6, { lineHeightFactor: 1.3 });
  return y + 17;
}

function drawReceiptAmount(pdf, amount, tax, y) {
  pdf.setDrawColor(26, 39, 68);
  pdf.setLineWidth(0.7);
  pdf.roundedRect(PAGE.left, y, PAGE.width, 29, 1.5, 1.5, "S");
  pdfFont(pdf, 8.5);
  pdf.setTextColor.apply(pdf, PDF_COLORS.muted);
  pdf.text("領　収　金　額", 105, y + 8, { align: "center" });
  pdfFont(pdf, 22, "bold");
  pdf.setTextColor.apply(pdf, PDF_COLORS.ink);
  pdf.text("¥" + fm(amount) + " -", 105, y + 19, { align: "center" });
  pdfFont(pdf, 7.5);
  pdf.setTextColor.apply(pdf, PDF_COLORS.muted);
  pdf.text("（うち消費税等 ¥" + fm(tax) + "）", 105, y + 25, { align: "center" });
  return y + 35;
}

function drawDocumentVector(pdf, doc, co) {
  var header = drawHeader(pdf, doc, co || {});
  var y = header.y;
  var tx = calcTax(doc.items || []);
  if (doc.docType === "請求書") y = drawAmountLine(pdf, "請求金額", tx.total, y);
  if (doc.docType === "見積書") y = drawAmountLine(pdf, "お見積金額", tx.total, y);
  if (doc.docType === "領収書") {
    var receiptItems = (doc.items || []).filter(function(i) { return i && (i.name || i.origin || i.qty || i.price || i.amount); });
    var receiptTx = calcTax(receiptItems);
    var manualAmount = Number(doc.amount || 0);
    var receiptAmount = manualAmount > 0 ? manualAmount : receiptTx.total;
    var receiptDetailsMatch = receiptItems.length > 0 && Math.abs(receiptAmount - receiptTx.total) < 0.01;
    var receiptTax = receiptDetailsMatch ? receiptTx.tax : Math.round(receiptAmount - receiptAmount / 1.08);
    y = drawReceiptAmount(pdf, receiptAmount, receiptTax, y);
    if (!receiptDetailsMatch) {
      y = drawBoxText(pdf, "但し書き", doc.description || doc.subject || "商品代として", y, 18);
      pdfFont(pdf, 9);
      pdf.text("上記金額を確かに領収いたしました。", PAGE.left, y + 2);
      return;
    }
    y = drawItemsTable(pdf, receiptItems, true, y, 14);
    y = drawTaxNote(pdf, receiptItems, y);
    y = drawBoxText(pdf, "但し", doc.description || doc.subject || "商品代として", y, 14);
    pdfFont(pdf, 9);
    pdf.text("上記金額を確かに領収いたしました。", PAGE.left, y + 2);
    return;
  }

  if (doc.docType === "納品書") y = drawCompactSummary(pdf, tx, y, doc.items || []);
  y = drawItemsTable(pdf, doc.items || [], doc.docType === "請求書", y, 14);
  y = drawTaxNote(pdf, doc.items || [], y);
  if (y + 50 > PAGE.bottom) { pdf.addPage(); y = 20; }
  y = drawTaxSummary(pdf, tx, y, doc.items || []);
  if (doc.docType === "請求書") y = drawInvoiceFooter(pdf, doc, co || {}, y);
  if (doc.docType === "納品書") {
    if (doc.dueDate) y = drawBoxText(pdf, "入金期日", fd(doc.dueDate), y, 12);
  }
  if (doc.docType === "見積書") {
    var estimateMeta = [doc.expiryDate ? "有効期限：" + fd(doc.expiryDate) : "", doc.conditions ? "取引条件：" + doc.conditions : ""].filter(Boolean).join("\n");
    if (estimateMeta) y = drawBoxText(pdf, "見積条件", estimateMeta, y, 14);
  }
  drawBoxText(pdf, "備考", doc.note || "", y, 14);
}

export async function createPdfForDocuments(docs, co) {
  var jsPDFMod = await import("jspdf");
  var jsPDF = jsPDFMod.jsPDF || jsPDFMod.default;
  var fontData = await loadJapaneseFont();
  var pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true, putOnlyUsedFonts: true });
  setupJapanesePdfFont(pdf, fontData);
  (docs || []).forEach(function(doc, index) {
    if (index > 0) pdf.addPage();
    drawDocumentVector(pdf, doc, co || {});
  });
  return pdf;
}

// ─── jsPDF の文字・線・表でベクター PDF を生成 ───────────────────
export async function generateAndDownloadPDF(doc, co) {
  const pdf = await createPdfForDocuments([doc], co);
  const filename = (doc.customer || "書類") + "_" + (doc.docNo || "document") + ".pdf";
  pdf.save(filename);
}

// プレビュー用（新タブ）
export function openPDF(doc, co) {
  const html = buildDocumentHTML(doc, co);
  const b = new Blob([html], { type: "text/html;charset=utf-8" });
  window.open(URL.createObjectURL(b), "_blank");
}
