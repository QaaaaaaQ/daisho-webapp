const SALES_ACCOUNT = { code: '513', name: '水産売上高', subCode: '002' };
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

function rowsForInvoice(doc, fromMonth, toMonth) {
  const candidates = (doc.items || [])
    .filter(item => item && !item.receiptTaxSummary && (String(item.name || '').trim() || Number(item.amount || 0) !== 0))
    .map(item => ({ item, date: normalizeDate(item.date || doc.date) }))
    .filter(row => row.date && row.date.slice(0, 7) >= fromMonth && row.date.slice(0, 7) <= toMonth);
  const unsupported = candidates.filter(({ item }) => ![8, 10].includes(Number(item.taxRate)));
  if (unsupported.length) {
    throw new Error(`PCA出力に対応していない税率があります（${[...new Set(unsupported.map(({ item }) => `${Number(item.taxRate)}%`))].join('、')}）。原票を確認してください。`);
  }
  const invalid = candidates.filter(({ item }) => !String(item.name || '').trim() || !Number.isSafeInteger(Number(item.amount)) || Number(item.amount) <= 0);
  if (invalid.length) throw new Error(`品名または正の明細金額が不足している請求書があります: ${doc.docNo || doc.customer || '請求書'}`);
  const calculated = candidates.map(({ item, date }) => ({
    item,
    date,
    rate: Number(item.taxRate),
    included: Boolean(item.taxIncluded),
    originalAmount: Number(item.amount),
    tax: 0,
    gross: 0,
  }));
  allocateTax(calculated, 8);
  allocateTax(calculated, 10);
  return calculated;
}

function pcaRow(doc, line, customerMaster) {
  const row = Array(45).fill('');
  row[0] = line.date.replace(/-/g, '');
  row[2] = '21';
  row[3] = '0';
  row[4] = '1';
  row[7] = RECEIVABLE_ACCOUNT.code;
  row[8] = RECEIVABLE_ACCOUNT.name;
  row[9] = String(customerMaster.pcaSubaccountCode || '').trim();
  row[10] = customerMaster.name;
  row[11] = '00';
  row[12] = '対象外';
  row[13] = String(line.gross);
  row[14] = '0';
  row[15] = '1';
  row[16] = departmentForItem(line.item);
  row[18] = SALES_ACCOUNT.code;
  row[19] = SALES_ACCOUNT.name;
  row[20] = SALES_ACCOUNT.subCode;
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

export function pcaInvoicesToCSV(documents, customers, fromMonth, toMonth) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(fromMonth || '') || !/^\d{4}-(0[1-9]|1[0-2])$/.test(toMonth || '') || fromMonth > toMonth) {
    throw new Error('開始月と終了月を正しく指定してください。');
  }
  const eligible = [];
  const unknownCustomers = [];
  const customersWithoutPcaCode = [];
  const ambiguousCustomers = [];
  (documents || []).filter(doc => doc?.docType === '請求書' && !doc.voidedAt).forEach(doc => {
    const lines = rowsForInvoice(doc, fromMonth, toMonth);
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
    if (!String(match.customer.pcaSubaccountCode || '').trim()) {
      customersWithoutPcaCode.push(match.customer.name || doc.customer || '（取引先未設定）');
      return;
    }
    eligible.push(...lines.map(line => ({ doc, line, customer: match.customer })));
  });
  if (ambiguousCustomers.length) throw new Error('顧客マスターで名称が重複している取引先があります: ' + [...new Set(ambiguousCustomers)].join('、'));
  if (unknownCustomers.length) throw new Error('顧客マスター未登録の取引先があります: ' + [...new Set(unknownCustomers)].join('、'));
  if (customersWithoutPcaCode.length) throw new Error('PCA補助科目コード未入力の取引先があります: ' + [...new Set(customersWithoutPcaCode)].join('、'));
  if (!eligible.length) throw new Error('指定期間に出力できる請求書明細がありません。');
  return eligible.map(({ doc, line, customer }) => pcaRow(doc, line, customer).map(quoteCell).join(',')).join('\r\n') + '\r\n';
}
