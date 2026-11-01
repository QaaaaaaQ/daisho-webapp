import test from 'node:test';
import assert from 'node:assert/strict';
import { pcaReceiptsToCSV } from '../src/lib/pca-receipts.js';

const products = [{ id: 'product-puffer', name: '真河豚', category: 'ふぐ類' }];
const receipt = {
  docType: '領収書',
  docNo: 'REC-100',
  date: '2026-10-04',
  customer: 'ヒマココ合同会社',
  description: '鮮魚代として',
  amount: 108,
  items: [{ productId: 'product-puffer', name: '真河豚', qty: 1, amount: 108, taxRate: 8, taxIncluded: true, date: '2026-11-01' }],
};

function parseCsvRow(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted && char === '"' && line[i + 1] === '"') { value += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { values.push(value); value = ''; }
    else value += char;
  }
  values.push(value);
  return values;
}

test('PCA receipt export debits account 135 without an auxiliary code and credits category sales', () => {
  const result = pcaReceiptsToCSV([
    receipt,
    { ...receipt, docNo: 'INV-1', docType: '請求書' },
    { ...receipt, docNo: 'REC-VOID', voidedAt: '2026-10-05T00:00:00Z' },
  ], products, '2026-10', '2026-10');
  const [line] = result.csv.trimEnd().split('\r\n');
  const row = parseCsvRow(line);
  assert.equal(row.length, 45);
  assert.equal(row[0], '20261004');
  assert.equal(row[7], '135');
  assert.equal(row[8], '');
  assert.equal(row[9], '');
  assert.equal(row[10], '');
  assert.equal(row[13], '108');
  assert.equal(row[18], '513');
  assert.equal(row[20], '008');
  assert.equal(row[22], 'B6');
  assert.equal(row[24], '108');
  assert.equal(row[25], '8');
  assert.equal(row[26], '鮮魚代として');
  assert.deepEqual(result.skippedDocuments, []);
});

test('PCA receipt export skips amount-only receipts and reports them for detail entry', () => {
  const result = pcaReceiptsToCSV([
    receipt,
    { ...receipt, docNo: 'REC-ONLY-AMOUNT', items: [], amount: 5000 },
  ], products, '2026-10', '2026-10');
  assert.equal(result.csv.trimEnd().split('\r\n').length, 1);
  assert.deepEqual(result.skippedDocuments, [{ docNo: 'REC-ONLY-AMOUNT', customer: 'ヒマココ合同会社' }]);
  assert.deepEqual(result.amountMismatchDocuments, []);
});

test('PCA receipt export uses the receipt date for the selected period', () => {
  const result = pcaReceiptsToCSV([receipt], products, '2026-11', '2026-11');
  assert.equal(result.csv, '');
  assert.deepEqual(result.skippedDocuments, []);
});

test('PCA receipt export skips a receipt whose saved amount differs from the detail total and reports both amounts', () => {
  const mismatchedReceipt = {
    ...receipt,
    docNo: 'REC-0372479105',
    customer: '旭',
    amount: 16600,
    items: [{ productId: 'product-puffer', name: '真河豚刺身', qty: 40, amount: 20000, taxRate: 8, taxIncluded: true }],
  };
  const result = pcaReceiptsToCSV([receipt, mismatchedReceipt], products, '2026-10', '2026-10');
  assert.equal(result.csv.trimEnd().split('\r\n').length, 1);
  assert.deepEqual(result.skippedDocuments, []);
  assert.deepEqual(result.amountMismatchDocuments, [{
    docNo: 'REC-0372479105', customer: '旭', receiptAmount: 16600, detailTotal: 20000,
  }]);
});

test('PCA receipt export returns no CSV when every receipt amount conflicts with its details', () => {
  const result = pcaReceiptsToCSV([{ ...receipt, docNo: 'REC-MISMATCH', amount: 120 }], products, '2026-10', '2026-10');
  assert.equal(result.csv, '');
  assert.deepEqual(result.amountMismatchDocuments, [{
    docNo: 'REC-MISMATCH', customer: 'ヒマココ合同会社', receiptAmount: 120, detailTotal: 108,
  }]);
});

test('PCA receipt export matches portion and preparation variants to a unique product-master category', () => {
  const receiptProducts = [
    { id: 'fugu-sashimi', name: '真河豚刺身', category: 'ふぐ類' },
    { id: 'fugu-skin', name: '河豚皮', category: 'ふぐ類' },
    { id: 'fugu-skin-raw', name: 'トラ河豚皮（生）', category: 'ふぐ類' },
    { id: 'fugu-skin-boiled', name: '虎河豚皮ボイル', category: 'ふぐ類' },
    { id: 'fugu-skin-cut', name: '河豚皮カット', category: 'ふぐ類' },
  ];
  const legacyReceipt = {
    docType: '領収書', docNo: 'REC-100025', date: '2026-10-30', customer: '将軍',
    description: '鮮魚代として', amount: 3240,
    items: [
      { name: '真河豚刺身（一人前）', qty: 5, price: 300, amount: 1500, taxRate: 8, taxIncluded: false },
      { name: '虎河豚皮刺身', qty: 5, price: 300, amount: 1500, taxRate: 8, taxIncluded: false },
    ],
  };
  const result = pcaReceiptsToCSV([legacyReceipt], receiptProducts, '2026-10', '2026-10');
  const rows = result.csv.trimEnd().split('\r\n').map(parseCsvRow);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row[20] === '008'));
  assert.deepEqual(result.skippedDocuments, []);
});

test('PCA receipt export rejects a product-name variant whose master matches disagree on category', () => {
  const conflictingProducts = [
    { id: 'fugu', name: '真河豚刺身', category: 'ふぐ類' },
    { id: 'shellfish', name: '虎河豚刺身', category: '蟹類' },
  ];
  assert.throws(
    () => pcaReceiptsToCSV([{
      ...receipt,
      items: [{ name: '河豚刺身（一人前）', amount: 108, taxRate: 8, taxIncluded: true }],
    }], conflictingProducts, '2026-10', '2026-10'),
    /商品マスターの分類.*河豚刺身/,
  );
});
