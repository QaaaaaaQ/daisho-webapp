export const DOC_TYPES = ["納品書", "請求書", "領収書", "見積書"];
export const STOCK_DOC_TYPES = new Set(["納品書", "請求書"]);

export function localDate(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function draftItem(date = localDate(), docType = "納品書") {
  return {
    date,
    origin: "",
    name: "",
    qty: "",
    unit: "",
    price: "",
    amount: 0,
    taxRate: 8,
    taxIncluded: docType === "領収書",
    caseCount: "",
    qtyPerCase: "",
  };
}

export function validItems(items = []) {
  return items.filter((item) => {
    if (!item) return false;
    return String(item.name || "").trim() || Number(item.qty || 0) !== 0 || Number(item.price || 0) !== 0 || Number(item.amount || 0) !== 0;
  }).map((item) => ({
    ...item,
    name: String(item.name || "").trim(),
    qty: Number(item.qty || 0),
    price: Number(item.price || 0),
    amount: Number(item.amount || 0),
    taxRate: Number(item.taxRate) === 10 ? 10 : 8,
    taxIncluded: Boolean(item.taxIncluded),
  }));
}

// 領収書は明示された手入力金額を正とし、金額が空の場合だけ明細合計を使う。
// itemTotal は税区分を含めた calcTax(items).total を渡す。
export function documentTotal(doc, itemTotal = 0) {
  if (doc?.docType === "領収書") {
    const manualAmount = Number(doc?.amount || 0);
    return manualAmount > 0 ? manualAmount : Number(itemTotal || 0);
  }
  return Number(itemTotal || 0);
}

export function validateItems(items, { requirePrice = true } = {}) {
  const rows = validItems(items);
  if (rows.length === 0) return "少なくとも1件の明細を入力してください";
  for (const item of rows) {
    if (!item.name) return "明細の商品名を入力してください";
    if (!(item.qty > 0)) return `「${item.name || "明細"}」の数量は0より大きくしてください`;
    if (requirePrice && !(item.price >= 0)) return `「${item.name}」の単価を入力してください`;
    if (item.price < 0 || item.amount < 0) return `「${item.name}」の金額は0以上にしてください`;
    const calculated = item.qty * item.price;
    if (Math.abs(calculated - item.amount) > 0.01) return `「${item.name}」の数量×単価と明細金額が一致しません`;
  }
  return "";
}

export function validateDocument(doc) {
  if (!DOC_TYPES.includes(doc.docType)) return "書類種別が正しくありません";
  if (!String(doc.customer || "").trim()) return "取引先を入力してください";
  const items = validItems(doc.items);
  if (doc.docType === "領収書") {
    if (!(Number(doc.amount || 0) > 0) && items.length === 0) return "領収金額、または内容明細を入力してください";
    if (items.length > 0) return validateItems(items);
    return "";
  }
  if (doc.docType !== "見積書" && !doc.date) return "日付を入力してください";
  return validateItems(items);
}

export function affectsStock(docType) {
  return STOCK_DOC_TYPES.has(docType);
}

export function docPrefix(docType) {
  return docType === "請求書" ? "INV" : docType === "領収書" ? "REC" : docType === "見積書" ? "EST" : "DEL";
}

export function normalizeDocument(doc) {
  const items = validItems(doc.items);
  return {
    ...doc,
    docType: doc.docType || "納品書",
    customer: String(doc.customer || "").trim(),
    date: doc.date || localDate(),
    items,
    amount: doc.docType === "領収書" ? Number(doc.amount || 0) : doc.amount,
  };
}
