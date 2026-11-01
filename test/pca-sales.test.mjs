import test from 'node:test';
import assert from 'node:assert/strict';
import { pcaInvoicesToCSV } from '../src/lib/pca-sales.js';

const customer = { name: '株式会社 神戸大商', code: '7061', pcaSubaccountCode: 'wrong-legacy-value' };
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

test('monthly exports preserve the total allocated across the whole invoice', () => {
  const item={...invoice.items[0],amount:106};
  const doc={...invoice,items:[{...item,date:'2026-10-31'},{...item,date:'2026-11-01'}]};
  const total=(from,to)=>pcaInvoicesToCSV([doc],[customer],products,from,to).trim().split('\r\n').reduce((n,line)=>n+Number(parseCsvRow(line)[13]),0);
  assert.equal(total('2026-10','2026-11'),229);
  assert.equal(total('2026-10','2026-10')+total('2026-11','2026-11'),229);
});

test('PCA export handles valid fractional-yen item amounts', () => {
  const doc={...invoice,items:[{...invoice.items[0],amount:126.25,qty:1.25}]};
  const fields=parseCsvRow(pcaInvoicesToCSV([doc],[customer],products,'2026-10','2026-10').trim());
  assert.equal(fields[13],'136');
});

test('unrelated invoices outside the period do not block export', () => {
  const unrelated={...invoice,docNo:'INV-OLD',items:[{...invoice.items[0],date:'2025-01-01',taxRate:0}]};
  const csv=pcaInvoicesToCSV([unrelated,invoice],[customer],products,'2026-10','2026-10');
  assert.equal(csv.trim().split('\r\n').length,1);
});

test('PCA sales export builds the 45-column invoice journal using the customer master code', () => {
  const [line] = pcaInvoicesToCSV([invoice], [customer], products, '2026-10', '2026-10').trimEnd().split('\r\n');
  const fields = parseCsvRow(line);
  assert.equal(fields.length, 45);
  assert.equal(fields[0], '20261003');
  assert.equal(fields[2], '21');
  assert.equal(fields[7], '152');
  assert.equal(fields[9], '7061');
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

test('PCA sales export requires the customer master code', () => {
  const customerWithoutCode = { name: customer.name, pcaSubaccountCode: '001' };
  assert.throws(
    () => pcaInvoicesToCSV([invoice], [customerWithoutCode], products, '2026-10', '2026-10'),
    /顧客マスターのコード未入力.*株式会社 神戸大商/,
  );
});
