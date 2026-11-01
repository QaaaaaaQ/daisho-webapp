import test from 'node:test';
import assert from 'node:assert/strict';
import { pcaInvoicesToCSV } from '../src/lib/pca-sales.js';

const customer = { name: '株式会社 神戸大商', pcaSubaccountCode: '001' };
const products = [{ id: 'product-puffer', name: '真河豚', category: 'ふぐ類' }];
const invoice = {
  docType: '請求書',
  docNo: 'INV-100',
  date: '2026-10-02',
  customer: '神戸大商株式会社',
  items: [{ productId: 'product-puffer', name: '真河豚', qty: 1, amount: 100, taxRate: 8, taxIncluded: false, date: '2026-10-03' }],
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

test('PCA sales export builds the 45-column invoice journal using the line date and customer subaccount', () => {
  const [line] = pcaInvoicesToCSV([invoice], [customer], products, '2026-10', '2026-10').trimEnd().split('\r\n');
  const fields = parseCsvRow(line);
  assert.equal(fields.length, 45);
  assert.equal(fields[0], '20261003');
  assert.equal(fields[2], '21');
  assert.equal(fields[7], '152');
  assert.equal(fields[9], '001');
  assert.equal(fields[13], '108');
  assert.equal(fields[16], '601');
  assert.equal(fields[18], '513');
  assert.equal(fields[20], '008');
  assert.equal(fields[22], 'B6');
  assert.equal(fields[24], '108');
  assert.equal(fields[25], '8');
  assert.equal(fields[26], '神戸大商株式会社');
});

test('PCA sales export filters invoice items by their own date and ignores non-sales documents', () => {
  const csv = pcaInvoicesToCSV([
    invoice,
    { ...invoice, docNo: 'INV-NOV', items: [{ ...invoice.items[0], date: '2026-11-01' }] },
    { ...invoice, docType: '領収書', docNo: 'REC-1' },
    { ...invoice, docNo: 'INV-VOID', voidedAt: '2026-10-04T00:00:00Z' },
  ], [customer], products, '2026-10', '2026-10');
  assert.equal(csv.trimEnd().split('\r\n').length, 1);
});

test('PCA sales export never substitutes an unsupported saved tax rate', () => {
  assert.throws(
    () => pcaInvoicesToCSV([{ ...invoice, items: [{ ...invoice.items[0], taxRate: 0 }] }], [customer], products, '2026-10', '2026-10'),
    /対応していない税率.*0%/,
  );
});

test('PCA sales subaccount follows the linked product master category', () => {
  const categories = [
    ['アサリ', '021'], ['アワビ', '005'], ['あんこう', '009'], ['うなぎ', '011'], ['サザエ', '002'],
    ['ふぐ類', '008'], ['ホタテ', '020'], ['蛤', '003'], ['蟹類', '016'], ['赤貝', '001'],
  ];
  const categoryProducts = categories.map(([category], index) => ({ id: `product-${index}`, name: `item-${index}`, category }));
  const categoryInvoice = { ...invoice, items: categoryProducts.map(product => ({
    productId: product.id,
    name: product.name,
    qty: 1,
    amount: 100,
    taxRate: 8,
    taxIncluded: false,
    date: '2026-10-03',
  })) };
  const rows = pcaInvoicesToCSV([categoryInvoice], [customer], categoryProducts, '2026-10', '2026-10')
    .trimEnd().split('\r\n').map(parseCsvRow);
  assert.deepEqual(rows.map(row => row[20]), categories.map(([, code]) => code));
  assert.ok(rows.every(row => row[18] === '513' && row[19] === '水産売上高'));
});

test('PCA sales export stops when a line cannot be matched to a categorized master product', () => {
  assert.throws(
    () => pcaInvoicesToCSV([invoice], [customer], [], '2026-10', '2026-10'),
    /商品マスターの分類.*真河豚/,
  );
});
