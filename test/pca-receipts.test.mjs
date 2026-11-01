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
});

test('PCA receipt export uses the receipt date for the selected period', () => {
  const result = pcaReceiptsToCSV([receipt], products, '2026-11', '2026-11');
  assert.equal(result.csv, '');
  assert.deepEqual(result.skippedDocuments, []);
});

test('PCA receipt export stops when the receipt amount differs from the detailed taxable total', () => {
  assert.throws(
    () => pcaReceiptsToCSV([{ ...receipt, amount: 120 }], products, '2026-10', '2026-10'),
    /領収金額.*明細合計/,
  );
});
