import test from 'node:test';
import assert from 'node:assert/strict';
import {pcaInputIssues} from '../src/lib/input-quality.js';
const products=[{id:'p',name:'真河豚',category:'ふぐ類'}];
const customers=[{name:'顧客',code:'001'}];
const item={productId:'p',name:'真河豚',qty:1,price:108,amount:108,taxRate:8,taxIncluded:true};
const date='2026-11-01';
test('invoice requires a usable customer master code and product classification before saving',()=>{
  const issues=pcaInputIssues({docType:'請求書',date,customer:'顧客',items:[item]},[{name:'顧客',code:''}],[{...products[0],category:''}]);
  assert.deepEqual(issues.map(x=>x.code),['customer_code_missing','product_category_missing']);
});
test('invalid detail date cannot be silently skipped by the invoice export',()=>{
  assert.ok(pcaInputIssues({docType:'請求書',date,customer:'顧客',items:[{...item,date:'2026-02-30'}]},customers,products).some(i=>i.code==='date_missing'));
});
test('receipt needs details and matching amount but does not need a customer code',()=>{
  assert.deepEqual(pcaInputIssues({docType:'領収書',date,customer:'未登録',amount:108,items:[item]},[],products),[]);
  assert.ok(pcaInputIssues({docType:'領収書',date,customer:'顧客',amount:100,items:[item]},[],products).some(i=>i.code==='receipt_amount_mismatch'));
  assert.ok(pcaInputIssues({docType:'領収書',date,customer:'顧客',amount:100,items:[]},[],products).some(i=>i.code==='details_missing'));
});
