import test from 'node:test';
import assert from 'node:assert/strict';
import {saveValidatedDocument} from '../src/lib/save-document.js';

const item={productId:'p',name:'魚',qty:2,price:11000,amount:22000,taxRate:8,taxIncluded:true};
const doc={docType:'納品書',date:'2026-11-03',customer:'顧客A',items:[item]};
test('AI delivery draft reaches persistence with its own contents',async()=>{
  let received;
  const result=await saveValidatedDocument(doc,[],[],async draft=>{received=draft;return {...draft,id:'test-id'};});
  assert.equal(received,doc);assert.equal(result.saved.id,'test-id');
});
test('invalid invoices never reach persistence',async()=>{
  let calls=0;
  const result=await saveValidatedDocument({...doc,docType:'請求書'},[],[],async()=>{calls++;});
  assert.equal(calls,0);assert.ok(result.issues.some(i=>i.code==='customer_missing'));
});
