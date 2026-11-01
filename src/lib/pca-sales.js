import { SALES_SUBACCOUNT_BY_CATEGORY, productForItem } from './pca-products.js';
export { SALES_SUBACCOUNT_BY_CATEGORY } from './pca-products.js';
import { allocatePcaTax } from './pca-allocation.js';
const SALES_ACCOUNT = { code: '513', name: '水産売上高' };
const RECEIVABLE_ACCOUNT = { code: '152', name: '売掛金' };
const TAX_CODES = { 8: 'B6', 10: 'B5' };


function normalizeName(value) {
  return String(value || '').normalize('NFKC').replace(/[\s　]/g, '').trim();
}

function normalizeCustomerName(value) {
  return normalizeName(value).replace(/株式会社|有限会社|合同会社|合名会社|合資会社/g, '');
}

function findCustomerMaster(customers, name) {
  const exactKey = normalizeName(name);
  const exact = (customers || []).filter(customer => normalizeName(customer.name) === exactKey);
  if (exact.length === 1) return { customer: exact[0] };
  if (exact.length > 1) return { ambiguous: true };
  const aliasKey = normalizeCustomerName(name);
  const aliases = (customers || []).filter(customer => normalizeCustomerName(customer.name) === aliasKey);
  if (aliases.length === 1) return { customer: aliases[0] };
  if (aliases.length > 1) return { ambiguous: true };
  return { customer: null };
}

function normalizeDate(value) {
  const match = String(value || '').match(/^(\d{4})[-/.]?(\d{1,2})[-/.]?(\d{1,2})/);
  if (!match) return '';
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function departmentForItem(item) {
  const name = normalizeName(item?.name);
  if (/サザエ/.test(name)) return '102';
  if (/蛤|ハマグリ|はまぐり/.test(name)) return '103';
  if (/アワビ|あわび/.test(name)) return '105';
  return '601';
}

function rowsForInvoice(doc, products, fromMonth, toMonth) {
  const dated = (doc.items || [])
    .filter(item => item && !item.receiptTaxSummary && (String(item.name || '').trim() || Number(item.amount || 0) !== 0))
    .map(item => ({ item, date: normalizeDate(item.date || doc.date) }));
  if (!dated.some(row => row.date && row.date.slice(0, 7) >= fromMonth && row.date.slice(0, 7) <= toMonth)) return [];
  const candidates = dated.map(row => {
      const { item, date } = row;
      if (!date || date.slice(0, 7) < fromMonth || date.slice(0, 7) > toMonth) return { item, date, category: null };
      const product = productForItem(item, products);
      if (!product?.category || !SALES_SUBACCOUNT_BY_CATEGORY[product.category]) {
        throw new Error(`商品マスターの分類またはPCA補助コードを確認できません: ${item.name || '明細'}`);
      }
      return { item, category: product.category, date };
    })
  const unsupported = candidates.filter(({ item }) => ![8, 10].includes(Number(item.taxRate)));
  if (unsupported.length) {
    throw new Error(`PCA出力に対応していない税率があります（${[...new Set(unsupported.map(({ item }) => `${Number(item.taxRate)}%`))].join('、')}）。原票を確認してください。`);
  }
  const invalid = candidates.filter(({ item }) => !String(item.name || '').trim() || !Number.isFinite(Number(item.amount)) || Number(item.amount) <= 0);
  if (invalid.length) throw new Error(`品名または正の明細金額が不足している請求書があります: ${doc.docNo || doc.customer || '請求書'}`);
  const calculated = candidates.map(({ item, date, category }) => ({
    item,
    date,
    category,
    rate: Number(item.taxRate),
    included: Boolean(item.taxIncluded),
    originalAmount: Number(item.amount),
    tax: 0,
    gross: 0,
  }));
  allocatePcaTax(calculated);
  return calculated.filter(row => row.date && row.date.slice(0, 7) >= fromMonth && row.date.slice(0, 7) <= toMonth);
}

function pcaRow(doc, line, customerMaster) {
  const row = Array(45).fill('');
  row[0] = line.date.replace(/-/g, '');
  row[2] = '21';
  row[3] = '0';
  row[4] = '1';
  row[7] = RECEIVABLE_ACCOUNT.code;
  row[8] = RECEIVABLE_ACCOUNT.name;
  row[9] = String(customerMaster.code || '').trim();
  row[10] = customerMaster.name;
  row[11] = '00';
  row[12] = '対象外';
  row[13] = String(line.gross);
  row[14] = '0';
  row[15] = '1';
  row[16] = departmentForItem(line.item);
  row[18] = SALES_ACCOUNT.code;
  row[19] = SALES_ACCOUNT.name;
  row[20] = SALES_SUBACCOUNT_BY_CATEGORY[line.category];
  row[22] = TAX_CODES[line.rate];
  row[24] = String(line.gross);
  row[25] = String(line.tax);
  row[26] = String(doc.customer || '').trim();
  row[30] = '1';
  return row;
}

function quoteCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function pcaInvoicesToCSV(documents, customers, products, fromMonth, toMonth) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(fromMonth || '') || !/^\d{4}-(0[1-9]|1[0-2])$/.test(toMonth || '') || fromMonth > toMonth) {
    throw new Error('開始月と終了月を正しく指定してください。');
  }
  const eligible = [];
  const unknownCustomers = [];
  const customersWithoutCode = [];
  const ambiguousCustomers = [];
  (documents || []).filter(doc => doc?.docType === '請求書' && !doc.voidedAt).forEach(doc => {
    const lines = rowsForInvoice(doc, products, fromMonth, toMonth);
    if (!lines.length) return;
    const match = findCustomerMaster(customers, doc.customer);
    if (match.ambiguous) {
      ambiguousCustomers.push(doc.customer || '（取引先未設定）');
      return;
    }
    if (!match.customer) {
      unknownCustomers.push(doc.customer || '（取引先未設定）');
      return;
    }
    if (!String(match.customer.code || '').trim()) {
      customersWithoutCode.push(match.customer.name || doc.customer || '（取引先未設定）');
      return;
    }
    eligible.push(...lines.map(line => ({ doc, line, customer: match.customer })));
  });
  if (ambiguousCustomers.length) throw new Error('顧客マスターで名称が重複している取引先があります: ' + [...new Set(ambiguousCustomers)].join('、'));
  if (unknownCustomers.length) throw new Error('顧客マスター未登録の取引先があります: ' + [...new Set(unknownCustomers)].join('、'));
  if (customersWithoutCode.length) throw new Error('顧客マスターのコード未入力の取引先があります: ' + [...new Set(customersWithoutCode)].join('、'));
  if (!eligible.length) throw new Error('指定期間に出力できる請求書明細がありません。');
  return eligible.map(({ doc, line, customer }) => pcaRow(doc, line, customer).map(quoteCell).join(',')).join('\r\n') + '\r\n';
}
