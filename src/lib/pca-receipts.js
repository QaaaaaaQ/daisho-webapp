import { SALES_SUBACCOUNT_BY_CATEGORY } from './pca-sales.js';

const CASH_ACCOUNT = { code: '135', name: '' };
const SALES_ACCOUNT = { code: '513', name: '水産売上高' };
const TAX_CODES = { 8: 'B6', 10: 'B5' };

function normalizeDate(value) {
  const match = String(value || '').match(/^(\d{4})[-/.]?(\d{1,2})[-/.]?(\d{1,2})/);
  if (!match) return '';
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function normalizeName(value) {
  return String(value || '').normalize('NFKC').replace(/[\s　]/g, '').trim();
}

function productCategoryKey(value) {
  return normalizeName(value)
    .replace(/[（(](?:一人前|\d+(?:[〜～-]\d+)?人前|生|ボイル|冷凍)[）)]/g, '')
    .replace(/(?:一人前|\d+(?:[〜～-]\d+)?人前)/g, '')
    .replace(/とらふく|とらふぐ|トラフグ|トラ河豚|虎河豚|真河豚|真ふぐ|まふぐ/g, '河豚')
    .replace(/刺身|さしみ|お造り|盛り合わせ|盛合せ|カット|ボイル|生|冷凍/g, '');
}

function categoryFromUniqueMasterMatches(matches) {
  if (!matches.length) return null;
  const category = matches[0].category;
  if (!category || !SALES_SUBACCOUNT_BY_CATEGORY[category] || matches.some(product => product.category !== category)) return null;
  return { category };
}

function productForItem(item, products) {
  const linked = item.productId ? (products || []).find(product => product.id === item.productId) : null;
  if (linked) return linked;
  const name = normalizeName(item.name);
  const matches = (products || []).filter(product => normalizeName(product.name) === name);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return categoryFromUniqueMasterMatches(matches);

  const categoryKey = productCategoryKey(item.name);
  if (!categoryKey) return null;
  const variants = (products || []).filter(product => productCategoryKey(product.name) === categoryKey);
  return categoryFromUniqueMasterMatches(variants);
}

function departmentForItem(item) {
  const name = normalizeName(item?.name);
  if (/サザエ/.test(name)) return '102';
  if (/蛤|ハマグリ|はまぐり/.test(name)) return '103';
  if (/アワビ|あわび/.test(name)) return '105';
  return '601';
}

function allocateTax(rows, rate) {
  const rateRows = rows.filter(row => row.rate === rate);
  if (!rateRows.length) return;
  const includedGrossTotal = rateRows.filter(row => row.included).reduce((sum, row) => sum + row.originalAmount, 0);
  const excludedNetTotal = rateRows.filter(row => !row.included).reduce((sum, row) => sum + row.originalAmount, 0);
  const includedNetTotal = includedGrossTotal - Math.round(includedGrossTotal * rate / (100 + rate));
  const taxableNetTotal = includedNetTotal + excludedNetTotal;
  const taxTotal = includedGrossTotal && !excludedNetTotal
    ? includedGrossTotal - includedNetTotal
    : Math.round(taxableNetTotal * rate / 100);
  const weights = rateRows.map(row => row.included
    ? row.originalAmount - Math.round(row.originalAmount * rate / (100 + rate))
    : row.originalAmount);
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const allocations = weights.map((weight, index) => {
    const exact = weightTotal ? taxTotal * weight / weightTotal : 0;
    return { index, tax: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remaining = taxTotal - allocations.reduce((sum, row) => sum + row.tax, 0);
  allocations.slice().sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .slice(0, remaining).forEach(row => { allocations[row.index].tax += 1; });
  rateRows.forEach((row, index) => {
    row.tax = allocations[index].tax;
    row.gross = row.included ? row.originalAmount : row.originalAmount + row.tax;
  });
}

function quoteCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function receiptRow(doc, line) {
  const row = Array(45).fill('');
  row[0] = line.date.replace(/-/g, '');
  row[2] = '21';
  row[3] = '0';
  row[4] = '1';
  row[7] = CASH_ACCOUNT.code;
  row[8] = CASH_ACCOUNT.name;
  // Cash account 135 has no auxiliary code or auxiliary name.
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
  row[26] = String(doc.description || doc.customer || '').trim();
  row[30] = '1';
  return row;
}

export function pcaReceiptsToCSV(documents, products, fromMonth, toMonth) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(fromMonth || '') || !/^\d{4}-(0[1-9]|1[0-2])$/.test(toMonth || '') || fromMonth > toMonth) {
    throw new Error('開始月と終了月を正しく指定してください。');
  }
  const rows = [];
  const skippedDocuments = [];
  const amountMismatchDocuments = [];
  (documents || []).filter(doc => doc?.docType === '領収書' && !doc.voidedAt).forEach(doc => {
    const date = normalizeDate(doc.date);
    if (!date || date.slice(0, 7) < fromMonth || date.slice(0, 7) > toMonth) return;
    const items = (doc.items || []).filter(item => item && !item.receiptTaxSummary &&
      (String(item.name || '').trim() || Number(item.amount || 0) !== 0));
    if (!items.length) {
      skippedDocuments.push({ docNo: doc.docNo || '', customer: doc.customer || '' });
      return;
    }
    const lines = items.map(item => {
      const product = productForItem(item, products);
      if (!product?.category || !SALES_SUBACCOUNT_BY_CATEGORY[product.category]) {
        throw new Error(`商品マスターの分類またはPCA補助コードを確認できません: ${item.name || '明細'}`);
      }
      return { item, category: product.category, date, rate: Number(item.taxRate),
        included: Boolean(item.taxIncluded), originalAmount: Number(item.amount), tax: 0, gross: 0 };
    });
    const unsupported = lines.filter(line => ![8, 10].includes(line.rate));
    if (unsupported.length) {
      throw new Error(`PCA出力に対応していない税率があります（${[...new Set(unsupported.map(line => `${line.rate}%`))].join('、')}）。原票を確認してください。`);
    }
    const invalid = lines.filter(line => !String(line.item.name || '').trim() ||
      !Number.isSafeInteger(line.originalAmount) || line.originalAmount <= 0);
    if (invalid.length) throw new Error(`品名または正の明細金額が不足している領収書があります: ${doc.docNo || doc.customer || '領収書'}`);
    allocateTax(lines, 8);
    allocateTax(lines, 10);
    const detailTotal = lines.reduce((sum, line) => sum + line.gross, 0);
    if (!Number.isSafeInteger(Number(doc.amount)) || Number(doc.amount) <= 0 || Number(doc.amount) !== detailTotal) {
      amountMismatchDocuments.push({
        docNo: doc.docNo || '',
        customer: doc.customer || '',
        receiptAmount: Number(doc.amount) || 0,
        detailTotal,
      });
      return;
    }
    rows.push(...lines.map(line => receiptRow(doc, line)));
  });
  return {
    csv: rows.map(row => row.map(quoteCell).join(',')).join('\r\n') + (rows.length ? '\r\n' : ''),
    skippedDocuments,
    amountMismatchDocuments,
  };
}
