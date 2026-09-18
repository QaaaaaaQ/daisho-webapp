import { calcTax } from "./pdf";
import { documentTotal } from "./domain";

const HEADERS = [
  "書類種別", "書類番号", "日付", "取引先", "件名", "入金期日", "有効期限", "取引条件",
  "振込先", "備考", "領収金額", "但し書き", "宛先住所", "宛先担当者", "明細日付",
  "品名", "産地", "ケース数", "入数", "数量", "単位", "単価", "明細金額", "税率",
  "税区分", "作成者", "作成者メール", "作成日時"
];

function cell(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function rowFor(doc, item) {
  const hasItem = !!item;
  const itemTotal = calcTax(doc.items || []).total;
  const amount = documentTotal(doc, itemTotal);
  return [
    doc.docType, doc.docNo, doc.date, doc.customer, doc.subject, doc.dueDate, doc.expiryDate, doc.conditions,
    doc.bank, doc.note, amount, doc.description, doc.toAddr, doc.toContact,
    hasItem ? item.date : "", hasItem ? item.name : "", hasItem ? item.origin : "",
    hasItem ? item.caseCount : "", hasItem ? item.qtyPerCase : "", hasItem ? item.qty : "",
    hasItem ? item.unit : "", hasItem ? item.price : "", hasItem ? item.amount : "",
    hasItem ? item.taxRate : "", hasItem ? (item.taxIncluded ? "内税" : "外税") : "",
    doc.savedBy, doc.savedByEmail, doc.savedAt
  ].map(cell).join(",");
}

export function documentsToCSV(docs) {
  const lines = [HEADERS.map(cell).join(",")];
  (docs || []).forEach(function(doc) {
    const items = (doc.items || []).filter(Boolean);
    if (items.length === 0) lines.push(rowFor(doc, null));
    else items.forEach(function(item) { lines.push(rowFor(doc, item)); });
  });
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

export function downloadDocumentsCSV(docs) {
  const list = (docs || []).filter(Boolean);
  if (list.length === 0) return;
  const blob = new Blob([documentsToCSV(list)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "請求書・領収書_明細_" + new Date().toISOString().slice(0, 10) + ".csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}
