import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePaymentCsv, allocatePayment } from '../src/lib/payments.js';

test('bank CSV import respects explicit column mapping and quoted Japanese payer names', () => {
  const csv = '入金日,振込人,金額,摘要\r\n2026/10/31,"神戸, 大商","12,500","INV-1001"';
  const result = parsePaymentCsv(csv, { date:'入金日', payer:'振込人', amount:'金額', reference:'摘要' });
  assert.deepEqual(result, [{ date:'2026-10-31', payer:'神戸, 大商', amount:12500, reference:'INV-1001' }]);
});

test('CSV parser handles escaped quotes and rejects ambiguous or invalid rows', () => {
  const csv = 'date,payer,amount,reference\n2026-10-30,"A ""B""",1000,X1\n2026-10-31,C,abc,X2';
  const rows = parsePaymentCsv(csv, { date:'date', payer:'payer', amount:'amount', reference:'reference' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payer, 'A "B"');
  assert.throws(() => parsePaymentCsv(csv, { date:'date', payer:'payer', amount:'amount', reference:'missing' }), /列がありません/);
  assert.throws(() => parsePaymentCsv(csv, { date:'date', payer:'date', amount:'amount', reference:'reference' }), /異なるCSV列/);
});

test('partial and split allocations cannot exceed either invoice balance or payment remainder', () => {
  assert.deepEqual(allocatePayment({ amount:5000, allocated:1200 }, { outstanding:2000 }, 1000), { paymentAllocated:2200, invoicePaid:1000, unapplied:2800 });
  assert.throws(() => allocatePayment({ amount:5000, allocated:4800 }, { outstanding:500 }, 300), /入金残額/);
  assert.throws(() => allocatePayment({ amount:5000, allocated:0 }, { outstanding:500 }, 700), /請求残額/);
});

test('overpayment remains unapplied rather than increasing invoice paid amount', () => {
  const result = allocatePayment({ amount:1200, allocated:0 }, { outstanding:1000 }, 1000);
  assert.deepEqual(result, { paymentAllocated:1000, invoicePaid:1000, unapplied:200 });
});
