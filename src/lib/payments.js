function parseCsvRows(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const input = String(text ?? '').replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (quoted) throw new Error('CSVの引用符が閉じていません');
  if (cell !== '' || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows.filter(values => values.some(value => value !== ''));
}

export function parsePaymentCsv(text, mapping) {
  const [headers, ...sourceRows] = parseCsvRows(text);
  if (!headers?.length) throw new Error('CSVに見出し行がありません');
  const indexes = {};
  for (const field of ['date','payer','amount','reference']) {
    const heading = String(mapping?.[field] ?? '').trim();
    const hits = headers.reduce((found, value, index) => value.trim() === heading && heading ? [...found,index] : found, []);
    if (hits.length !== 1) throw new Error(`CSV列がありません、または重複しています: ${field}`);
    indexes[field] = hits[0];
  }
  if (new Set(Object.values(indexes)).size !== 4) throw new Error('日付、振込人、金額、摘要には異なるCSV列を割り当ててください');
  return sourceRows.flatMap(values => {
    const rawDate = String(values[indexes.date] ?? '').trim();
    const dateMatch=rawDate.match(/^(\d{4})\s*(?:年|[/-])\s*(\d{1,2})\s*(?:月|[/-])\s*(\d{1,2})\s*日?$/);
    const date=dateMatch?`${dateMatch[1]}-${dateMatch[2].padStart(2,'0')}-${dateMatch[3].padStart(2,'0')}`:'';
    const payer = String(values[indexes.payer] ?? '').trim();
    const reference = String(values[indexes.reference] ?? '').trim();
    const amountText = String(values[indexes.amount] ?? '').trim().replace(/[¥￥,\s]/g, '');
    const amount = Number(amountText);
    if (!date || !payer || !Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) return [];
    const parsedDate=new Date(`${date}T00:00:00Z`);
    if(Number.isNaN(parsedDate.valueOf())||parsedDate.toISOString().slice(0,10)!==date)return [];
    return [{ date, payer, amount, reference }];
  });
}

export function paymentCsvHeaders(text) {
  const [headers] = parseCsvRows(text);
  if (!headers?.length) throw new Error('CSVに見出し行がありません');
  return headers;
}

export function paymentImportKey(payment) {
  return [payment.date, payment.payer.trim().normalize('NFKC'), Math.round(Number(payment.amount)), payment.reference.trim().normalize('NFKC')].join('|');
}

export function allocatePayment(payment, invoice, amount) {
  const paymentAmount = Number(payment?.amount);
  const alreadyAllocated = Number(payment?.allocated ?? 0);
  const invoiceOutstanding = Number(invoice?.outstanding);
  const allocation = Number(amount);
  if (![paymentAmount, alreadyAllocated, invoiceOutstanding, allocation].every(Number.isFinite) ||
      paymentAmount < 0 || alreadyAllocated < 0 || invoiceOutstanding < 0 || allocation <= 0) {
    throw new Error('入金と請求残額を確認してください');
  }
  if (allocation - (paymentAmount - alreadyAllocated) > 0.000001) throw new Error('入金残額を超えて割り当てできません');
  if (allocation - invoiceOutstanding > 0.000001) throw new Error('請求残額を超えて割り当てできません');
  return {
    paymentAllocated: Math.round((alreadyAllocated + allocation) * 100) / 100,
    invoicePaid: Math.round(allocation * 100) / 100,
    unapplied: Math.round((paymentAmount - alreadyAllocated - allocation) * 100) / 100,
  };
}
