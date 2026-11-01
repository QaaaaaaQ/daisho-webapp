import test from 'node:test';
import assert from 'node:assert/strict';
import { pcaInvoicesToCSV } from '../src/lib/pca-sales.js';

const customer = { name: '株式会社 神戸大商', pcaSubaccountCode: '001' };
const invoice = {
  docType: '請求書',
  docNo: 'INV-100',
  date: '2026-10-02',
  customer: '神戸大商株式会社',
  items: [{ name: '真河豚', qty: 1, amount: 100, taxRate: 8, taxIncluded: false, date: '2026-10-03' }],
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
  const [line] = pcaInvoicesToCSV([invoice], [customer], '2026-10', '2026-10').trimEnd().split('\r\n');
  const fields = parseCsvRow(line);
  assert.equal(fields.length, 45);
  assert.equal(fields[0], '20261003');
  assert.equal(fields[2], '21');
  assert.equal(fields[7], '152');
  assert.equal(fields[9], '001');
  assert.equal(fields[13], '108');
  assert.equal(fields[16], '601');
  assert.equal(fields[18], '513');
  assert.equal(fields[20], '002');
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
  ], [customer], '2026-10', '2026-10');
  assert.equal(csv.trimEnd().split('\r\n').length, 1);
});

test('PCA sales export never substitutes an unsupported saved tax rate', () => {
  assert.throws(
    () => pcaInvoicesToCSV([{ ...invoice, items: [{ ...invoice.items[0], taxRate: 0 }] }], [customer], '2026-10', '2026-10'),
    /対応していない税率.*0%/,
  );
});
