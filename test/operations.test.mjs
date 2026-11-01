import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmLegacyPdfAmounts, isAdminRole, taxCorrectionPreview } from '../src/lib/operations.js';
import { calcTax } from '../src/lib/money.js';

const doc = { id:'doc-1', docNo:'DEL-1', updatedAt:'v1', items:[{name:'魚A',taxRate:0,amount:1000},{name:'魚B',taxRate:8,amount:2000}] };

test('historical repair is a per-document preview and accepts only supported explicit rates', () => {
  assert.deepEqual(taxCorrectionPreview(doc,[8,8]), { documentId:'doc-1',docNo:'DEL-1',expectedUpdatedAt:'v1',changes:[{index:0,name:'魚A',from:0,to:8,amount:1000}],summary:calcTax(doc.items.map(item=>({...item,taxRate:8})))});
  assert.throws(()=>taxCorrectionPreview(doc,[0,8]),/8%または10%/);
  assert.throws(()=>taxCorrectionPreview(doc,[8]),/明細の税率/);
});

test('legacy PDF reissue requires a user-confirmed amount and tax snapshot', () => {
  assert.throws(()=>confirmLegacyPdfAmounts(doc,{gross:3240,tax:240,rates:[8,8]},false),/原票で/);
  assert.throws(()=>confirmLegacyPdfAmounts(doc,{gross:3000,tax:200,rates:[8,8]},true),/原票で/);
  assert.equal(confirmLegacyPdfAmounts(doc,{gross:3240,tax:240,rates:[8,8]},true).taxSummary.tax,240);
});

test('role checks recognize only the server supplied admin role', () => {
  assert.equal(isAdminRole('admin'),true);
  assert.equal(isAdminRole('employee'),false);
  assert.equal(isAdminRole(undefined),false);
});
