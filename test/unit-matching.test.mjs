import test from 'node:test';
import assert from 'node:assert/strict';
import {alignUnitsWithMaster} from '../src/lib/unit-matching.js';
import {saveValidatedDocument} from '../src/lib/save-document.js';
const products=[{id:'p',name:'虎河豚白子',unit:'kg',category:'ふぐ類'}];
const doc={docType:'納品書',date:'2026-11-03',customer:'ホテル',items:[{productId:'p',name:'虎河豚白子',unit:'キロ',qty:2,price:11000,amount:22000,taxRate:8,taxIncluded:true}]};
test('kilogram aliases match the selected product without changing amounts or the source',()=>{
 const result=alignUnitsWithMaster(doc,products);
 assert.equal(result.items[0].unit,'kg');assert.equal(result.items[0].qty,2);assert.equal(result.items[0].amount,22000);assert.equal(doc.items[0].unit,'キロ');
});
test('name-only drafts require a unique active master and never convert different units',()=>{
 const input={...doc,items:[{...doc.items[0],productId:undefined}]};
 assert.equal(alignUnitsWithMaster(input,products).items[0].unit,'kg');
 assert.equal(alignUnitsWithMaster(input,[...products,{...products[0],id:'p2'}]).items[0].unit,'キロ');
 assert.equal(alignUnitsWithMaster({...input,items:[{...input.items[0],unit:'g'}]},products).items[0].unit,'g');
 assert.equal(alignUnitsWithMaster(input,[{...products[0],unit:'箱'}]).items[0].unit,'キロ');
});
test('AI draft save passes the master unit to the persistence operation',async()=>{
 let saved;
 await saveValidatedDocument(doc,[],products,async value=>{saved=value;return {id:'test'};});
 assert.equal(saved.items[0].unit,'kg');assert.equal(saved.items[0].qty,2);
});
