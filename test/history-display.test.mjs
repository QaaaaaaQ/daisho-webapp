import test from 'node:test';
import assert from 'node:assert/strict';
import { historyDocumentView } from '../src/lib/history-display.js';
import { calcTax } from '../src/lib/money.js';
const DEL='\u7d0d\u54c1\u66f8', REC='\u9818\u53ce\u66f8';
const oldDoc=()=>({docType:DEL,items:[{amount:68000,taxRate:0},{amount:15000,taxRate:0}],amount:null,taxSummary:null});
const normal=[{amount:1080,taxRate:8,taxIncluded:true},{amount:1000,taxRate:8,taxIncluded:false}];

test('legacy zero-rate document is visible without invented tax or total',()=>{
  const v=historyDocumentView(oldDoc());
  assert.ok(v.issue);assert.equal(v.total,null);assert.equal(v.tax,null);assert.equal(v.items.length,2);
});
test('read-only model does not mutate historical rates or amounts',()=>{
  const d=oldDoc(),before=JSON.stringify(d);Object.freeze(d);d.items.forEach(Object.freeze);Object.freeze(d.items);
  historyDocumentView(d);assert.equal(JSON.stringify(d),before);assert.equal(d.items[0].taxRate,0);
});
test('strict calculation still rejects zero tax rate for issuing',()=>{
  assert.throws(()=>calcTax(oldDoc().items),/Unsupported tax rate/);
});
test('healthy documents remain computable alongside incompatible records',()=>{
  const views=[oldDoc(),{docType:DEL,items:normal}].map(historyDocumentView);
  assert.ok(views[0].issue);assert.equal(views[1].issue,'');assert.equal(views[1].total,2160);assert.equal(views[1].tax,160);
});
test('stored amount is a labeled reference, not a replacement tax calculation',()=>{
  const v=historyDocumentView({...oldDoc(),amount:83000});assert.equal(v.total,83000);assert.equal(v.source,'stored');assert.ok(v.issue);assert.equal(v.tax,null);
});
test('invalid amounts and malformed item lists do not break read-only history',()=>{
  for(const items of [[{amount:-10,taxRate:8}],[{amount:'bad',taxRate:8}],{},'not-an-array',[null],[42]]){
    const v=historyDocumentView({docType:DEL,items});assert.ok(v.issue);assert.equal(v.total,null);
  }
});
test('valid issued snapshot remains authoritative',()=>{
  const tx={version:2,...calcTax([{amount:200,taxRate:8}])};
  const v=historyDocumentView({docType:DEL,items:normal,taxSummary:tx});
  assert.equal(v.total,216);assert.equal(v.tax,16);assert.equal(v.source,'snapshot');
});
test('invalid tax snapshot is flagged instead of being treated as confirmed',()=>{
  const v=historyDocumentView({docType:DEL,items:normal,taxSummary:{version:2,total:999}});
  assert.ok(v.issue);assert.equal(v.total,null);assert.equal(v.tax,null);
});
test('amount-only receipt preserves known payment and leaves tax unknown',()=>{
  const v=historyDocumentView({docType:REC,items:[],amount:1100});assert.equal(v.total,1100);assert.equal(v.tax,null);assert.equal(v.issue,'');
});
test('known receipt and mismatch are handled without guessing',()=>{
  const items=[{amount:1100,taxRate:10,taxIncluded:true}];
  assert.equal(historyDocumentView({docType:REC,items,amount:1100}).tax,100);
  assert.equal(historyDocumentView({docType:REC,items,amount:2200}).tax,null);
});
test('missing and nonfinite stored amounts never become zero yen accidentally',()=>{
  for(const amount of [null,undefined,'',NaN,Infinity,{},true]){
    const v=historyDocumentView({...oldDoc(),amount});assert.equal(v.total,null);
  }
});
