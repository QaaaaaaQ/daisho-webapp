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

export function calcTax(items) {
  items = items || [];
  let s8 = 0, s10 = 0;
  items.forEach(function(i) {
    const a = Number(i.amount || 0);
    const rate = Number(i.taxRate) === 10 ? 10 : 8;
    const excl = i.taxIncluded ? (rate === 8 ? Math.round(a/1.08) : Math.round(a/1.10)) : a;
    if (rate === 10) s10 += excl; else s8 += excl;
  });
  const t8 = Math.round(s8*0.08), t10 = Math.round(s10*0.10);
  const sub = s8+s10, tax = t8+t10;
  const hasTI = items.some(function(i){return i.taxIncluded;});
  const total = hasTI ? items.reduce(function(s,i){return s+Number(i.amount||0);},0) : sub+tax;
  return {s8,s10,t8,t10,sub,tax,total};
}

// ── 右上ブロック: メタ情報 + ロゴ(2倍) + 社名(角印背景) ──────
function coBlock(co, date, no, typeLabel) {
  const dateLabel = typeLabel === "納品書" ? "納品日" : "請求日";
  const noLabel   = typeLabel === "納品書" ? "納品書番号" : "請求書番号";

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
    '<div style="font-size:11.5pt;font-weight:bold;margin-bottom:1mm">' + (co.name||"") + '</div>' +
    '<div style="font-size:8.5pt;line-height:1.8">' +
    (co.manager||"") + '<br>' +
    (co.addr||"") + '<br>' +
    (co.tel||"") + '　' + (co.fax||"") +
    '</div></div>' + sealImg + '</div>';

  return '<div style="text-align:right">' +
    '<table style="border-collapse:collapse;margin-left:auto;margin-bottom:1mm"><tbody>' +
    '<tr><td style="color:#666;font-size:8pt;text-align:right;padding:1px 5px;border:none">登録番号</td>' +
    '<td style="font-size:8pt;padding:1px 4px;border:none">' + (co.regNo||"") + '</td></tr>' +
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
  const TD = 'style="border:0.5px solid #ccc;padding:3px 5px;' + ROW_H + ';font-size:8.5pt;white-space:nowrap;overflow:hidden"';
  const TDR = 'style="border:0.5px solid #ccc;padding:3px 6px;' + ROW_H + ';font-size:8.5pt;text-align:right"';
  const TDC = 'style="border:0.5px solid #ccc;padding:3px 5px;' + ROW_H + ';font-size:8.5pt;text-align:center"';
  const MIN = Math.max(items.length, 14);
  let h = "";
  for (let i = 0; i < MIN; i++) {
    const it = items[i];
    if (it) {
      const mark = Number(it.taxRate) === 10 ? "" : " ※";
      const dc = hasDate ? "<td " + TD + ">" + (fd(it.date)||"") + "</td>" : "";
      h += "<tr>" + dc +
        "<td " + TD + ">" + (it.origin||"") + "</td>" +
        "<td " + TD + ">" + (it.name||"") + mark + "</td>" +
        "<td " + TDC + ">" + (it.caseCount||"") + "</td>" +
        "<td " + TDC + ">" + (it.qtyPerCase||"") + "</td>" +
        "<td " + TDC + ">" + (it.qty||"") + "</td>" +
        "<td " + TDC + ">" + (it.unit||"") + "</td>" +
        "<td " + TDR + ">" + (it.price ? fm(it.price) : "") + "</td>" +
        "<td " + TDR + ">" + fm(it.amount) + "</td></tr>";
    } else {
      const dc = hasDate ? "<td " + TD + "></td>" : "";
      h += "<tr>" + dc +
        "<td " + TD + "></td><td " + TD + "></td>" +
        "<td " + TDC + "></td><td " + TDC + "></td>" +
        "<td " + TDC + "></td><td " + TDC + "></td>" +
        "<td " + TDR + "></td><td " + TDR + "></td></tr>";
    }
  }
  return h;
}

function tableHead(hasDate) {
  const TH = 'style="background:#1a2744;color:#fff;padding:5px 5px;font-weight:400;font-size:8.5pt;white-space:nowrap"';
  const dc = hasDate ? "<th " + TH + ">取引日</th>" : "";
  return "<thead><tr>" + dc +
    "<th " + TH + ">産地</th>" +
    "<th " + TH + ">品名</th>" +
    "<th " + TH + " style='background:#1a2744;color:#fff;padding:5px;font-weight:400;font-size:8.5pt;text-align:center'>ケース数</th>" +
    "<th " + TH + " style='background:#1a2744;color:#fff;padding:5px;font-weight:400;font-size:8.5pt;text-align:center'>入数</th>" +
    "<th " + TH + " style='background:#1a2744;color:#fff;padding:5px;font-weight:400;font-size:8.5pt;text-align:center'>数量</th>" +
    "<th " + TH + " style='background:#1a2744;color:#fff;padding:5px;font-weight:400;font-size:8.5pt;text-align:center'>単位</th>" +
    "<th " + TH + " style='background:#1a2744;color:#fff;padding:5px;font-weight:400;font-size:8.5pt;text-align:right'>単価</th>" +
    "<th " + TH + " style='background:#1a2744;color:#fff;padding:5px;font-weight:400;font-size:8.5pt;text-align:right'>明細金額</th>" +
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

// ─── 納品書 ────────────────────────────────────────────────────
export function buildDeliveryHTML(doc, co) {
  const tx = calcTax(doc.items);
  const no   = doc.docNo || "DEL-" + Date.now();
  const date = fd(doc.date) || new Date().toISOString().slice(0,10);
  // 入金期日（あれば）
  const dueRow = doc.dueDate
    ? '<div style="font-size:8.5pt;color:#444;margin-top:2mm">入金期日：' + fd(doc.dueDate) + '</div>'
    : '';
  return '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>納品書 ' + no + '</title>' + baseCSS() + '</head><body>' +
    '<h1>納　品　書</h1>' +
    '<div class="hd">' +
      '<div>' +
        '<div class="to-name">' + (doc.customer||"") + ' 御中</div>' +
        (doc.toAddr ? '<div class="to-sub">' + doc.toAddr + '</div>' : '') +
        dueRow +
      '</div>' +
      coBlock(co, date, no, "納品書") +
    '</div>' +
    '<div class="sbj"><span class="sbj-l">件名</span><span>' + (doc.subject||"") + '</span></div>' +
    '<table class="sum-tbl"><tr><th>小計</th><th>消費税</th><th>合計金額</th></tr>' +
    '<tr><td>' + fm(tx.sub) + '円</td><td>' + fm(tx.tax) + '円</td><td class="sum-big">' + fm(tx.total) + '円</td></tr></table>' +
    '<table class="main">' + tableHead(false) + '<tbody>' + buildRows(doc.items, false) + '</tbody></table>' +
    taxNote(doc.items) +
    taxBlock(tx) +
    '<div class="note-box"><div class="nlbl">備考</div>' + (doc.note||"") + '</div>' +
    '</body></html>';
}

// ─── 請求書 ────────────────────────────────────────────────────
export function buildInvoiceHTML(doc, co) {
  const tx   = calcTax(doc.items);
  const no   = doc.docNo || "INV-" + Date.now();
  const date = fd(doc.date) || new Date().toISOString().slice(0,10);
  const bank = (doc.bank || co.bankA || "").split(/　|  |\s{2}/).join("<br>");
  const toContact = doc.toContact ? '<div class="to-sub">' + doc.toContact + '</div>' : "";
  return '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>請求書 ' + no + '</title>' + baseCSS() + '</head><body>' +
    '<h1>請　求　書</h1>' +
    '<div class="hd">' +
      '<div>' +
        '<div class="to-name">' + (doc.customer||"") + ' 御中</div>' +
        (doc.toAddr ? '<div class="to-sub">' + doc.toAddr + '</div>' : '') +
        toContact +
      '</div>' +
      coBlock(co, date, no, "請求書") +
    '</div>' +
    '<div class="sbj"><span class="sbj-l">件名</span><span>' + (doc.subject||"") + '</span></div>' +
    '<div class="amt-row"><span class="amt-lbl">請求金額</span><span class="amt-val">' + fm(tx.total) + '円</span></div>' +
    '<table class="main">' + tableHead(true) + '<tbody>' + buildRows(doc.items, true) + '</tbody></table>' +
    taxNote(doc.items) +
    taxBlock(tx) +
    '<div class="ftr">' +
      '<div><div class="ftr-l">入金期日</div><div>' + (doc.dueDate ? fd(doc.dueDate) : "") + '</div></div>' +
      '<div><div class="ftr-l">振込先</div><div style="line-height:1.7">' + bank + '</div></div>' +
    '</div>' +
    '<div class="note-box"><div class="nlbl">備考</div>' + (doc.note||"") + '</div>' +
    '</body></html>';
}

// ─── 領収書 ────────────────────────────────────────────────────
export function buildReceiptHTML(doc, co) {
  const amt  = Number(doc.amount||0);
  const tax  = Math.round(amt - amt/1.08);
  const no   = doc.docNo || "REC-" + Date.now();
  const date = fd(doc.date) || new Date().toISOString().slice(0,10);
  var receiptSealImg = (co && co.sealImg)
    ? '<img src="' + co.sealImg + '" style="width:100px;height:100px;object-fit:contain;opacity:0.60"/>'
    : '';
  return '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>領収書 ' + no + '</title>' + baseCSS() + '</head><body>' +
    '<h1>領　収　書</h1>' +
    '<div class="hd"><div>' +
      '<div class="to-name">' + (doc.customer||"") + ' 様</div>' +
      '<div class="to-sub">' + date + '　No. ' + no + '</div>' +
    '</div>' + coBlock(co, date, no, "領収書") + '</div>' +
    '<div style="border:2px solid #1a2744;border-radius:4px;padding:5mm;text-align:center;margin:5mm 0">' +
      '<div style="font-size:9pt;color:#555;margin-bottom:2mm">領　収　金　額</div>' +
      '<div style="font-size:22pt;font-weight:bold">¥' + fm(amt) + ' -</div>' +
      '<div style="font-size:8pt;color:#555;margin-top:2mm">（うち消費税等 ¥' + fm(tax) + '）</div>' +
    '</div>' +
    '<div style="font-size:9pt;margin:3mm 0">但し　' + (doc.description||"商品代として") + '</div>' +
    '<div style="font-size:9pt">上記金額を確かに領収いたしました。</div>' +
    '<div style="display:flex;align-items:center;gap:3mm;justify-content:flex-end;margin-top:6mm">' +
      '<div style="font-size:10pt;font-weight:bold">' + (co.name||"") + '</div>' +
      receiptSealImg +
    '</div>' +
    '</body></html>';
}

// ─── jsPDF + html2canvas で直接PDF生成 ─────────────────────────
export async function generateAndDownloadPDF(doc, co) {
  var fullHtml =
    doc.docType === "請求書" ? buildInvoiceHTML(doc, co) :
    doc.docType === "領収書" ? buildReceiptHTML(doc, co) :
    buildDeliveryHTML(doc, co);

  // <style>タグと<body>の中身を抽出（body直接スタイル問題を回避）
  var styleMatch = fullHtml.match(/<style[\s\S]*?<\/style>/i);
  var bodyMatch  = fullHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  var styleStr   = styleMatch ? styleMatch[0] : "";
  var bodyStr    = bodyMatch  ? bodyMatch[1]  : fullHtml;

  // wrapにbodyのスタイルを直接適用
  var wrap = document.createElement("div");
  wrap.style.cssText = "position:fixed;left:-9999px;top:0;width:794px;background:#fff;z-index:-1;" +
    "padding:45px 60px;" +
    "box-sizing:border-box;" +
    "font-family:Hiragino Sans,Yu Gothic UI,Meiryo,sans-serif;" +
    "font-size:9pt;line-height:1.5;color:#111;";
  wrap.innerHTML = styleStr + bodyStr;
  document.body.appendChild(wrap);

  try {
    var html2canvasMod = await import("html2canvas");
    var jsPDFMod = await import("jspdf");
    var html2canvas = html2canvasMod.default;
    var jsPDF = jsPDFMod.default;

    var canvas = await html2canvas(wrap, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: "#ffffff",
      width: 794,
      windowWidth: 794,
    });
    var imgData = canvas.toDataURL("image/png");

    var pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    var pageW = 210, pageH = 297;
    var imgH = (canvas.height / canvas.width) * pageW;

    if (imgH <= pageH) {
      pdf.addImage(imgData, "PNG", 0, 0, pageW, imgH);
    } else {
      var remaining = imgH;
      var yOffset = 0;
      while (remaining > 0) {
        pdf.addImage(imgData, "PNG", 0, -yOffset, pageW, imgH);
        remaining -= pageH;
        yOffset += pageH;
        if (remaining > 0) pdf.addPage();
      }
    }

    var filename = (doc.customer || "書類") + "_" + doc.docNo + ".pdf";

    // モバイル（iPhone/Android）は新しいタブで表示、PCはダウンロード
    var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) {
      // blob URLを新しいタブで開く（Safariの共有ボタンから共有可能）
      var pdfBlob = pdf.output("blob");
      var blobUrl = URL.createObjectURL(pdfBlob);
      var newTab = window.open(blobUrl, "_blank");
      // タブが開けない場合はダウンロードにフォールバック
      if (!newTab) { pdf.save(filename); }
    } else {
      pdf.save(filename);
    }
  } finally {
    document.body.removeChild(wrap);
  }
}

// プレビュー用（新タブ）
export function openPDF(doc, co) {
  const html =
    doc.docType === "請求書" ? buildInvoiceHTML(doc, co) :
    doc.docType === "領収書" ? buildReceiptHTML(doc, co) :
    buildDeliveryHTML(doc, co);
  const b = new Blob([html], { type: "text/html;charset=utf-8" });
  window.open(URL.createObjectURL(b), "_blank");
}
