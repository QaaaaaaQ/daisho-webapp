const ACCOUNT_CODE = /^[A-Za-z0-9]{1,10}$/;
const SUBACCOUNT_CODE = /^[^\s,\"']{1,10}$/;

export function eligiblePcaPayments(payments = []) {
  return payments.filter(payment => {
    const allocations = payment.payment_allocations || [];
    const allocated = allocations.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    return allocations.length > 0 && Math.abs(allocated - Number(payment.amount)) < 0.001;
  });
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"','""')}"` : text;
}

function yyyymmdd(date) {
  const value = String(date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('PCAに出力できない入金日があります');
  return value.replaceAll('-', '');
}

export function buildPcaJournalCsv(payments = [], customers = [], settings = {}) {
  const bankCode = String(settings.pcaBankAccountCode || '').trim();
  const bankSubaccount = String(settings.pcaBankSubaccountCode || '').trim();
  const receivableCode = String(settings.pcaReceivableAccountCode || '').trim();
  if (!ACCOUNT_CODE.test(bankCode) || !ACCOUNT_CODE.test(receivableCode)) {
    throw new Error('PCAの預金科目コードと売掛金科目コードを設定してください（半角英数字・10文字以内）');
  }
  if (bankSubaccount && !SUBACCOUNT_CODE.test(bankSubaccount)) {
    throw new Error('PCAの預金補助コードを確認してください（空白・カンマ・引用符は使用できません）');
  }
  const ready = eligiblePcaPayments(payments);
  if (!ready.length) throw new Error('入金額と同額まで請求書に割り当て済みの入金がありません');
  const customerByName = new Map(customers.map(customer => [customer.name, customer]));
  const rows = [];
  for (const payment of ready) {
    for (const allocation of payment.payment_allocations || []) {
      const amount = Number(allocation.amount);
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 999999999999) {
        throw new Error('PCA仕訳金額は1円以上、999,999,999,999円以下の整数である必要があります');
      }
      const customerName = allocation.documents?.customer || '';
      const subaccount = String(customerByName.get(customerName)?.pcaSubaccountCode || '').trim();
      if (subaccount && !SUBACCOUNT_CODE.test(subaccount)) throw new Error(`PCA補助コードを確認してください: ${customerName}`);
      const cells = Array(81).fill('');
      cells[0] = yyyymmdd(payment.payment_date);
      cells[1] = String(rows.length + 1);
      cells[2] = '21';
      cells[3] = '0';
      cells[4] = '0';
      cells[7] = bankCode;
      cells[9] = bankSubaccount;
      cells[13] = String(amount);
      cells[15] = '0';
      cells[18] = receivableCode;
      cells[20] = subaccount;
      cells[24] = String(amount);
      cells[26] = [payment.payer, allocation.documents?.doc_no, payment.reference].filter(Boolean).join(' / ').slice(0,256);
      cells[29] = '10';
      rows.push(cells.map(csvCell).join(','));
    }
  }
  if (rows.length > 99999) throw new Error('一度に出力できる仕訳は99,999件までです');
  return [`text version='7'`, ...rows].join('\r\n') + '\r\n';
}
