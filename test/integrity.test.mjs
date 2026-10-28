import test from 'node:test';
import assert from 'node:assert/strict';
import {calcTax,receiptTax,documentTax} from '../src/lib/money.js';
import {createWorkflowClient,mapDocument,isBillable} from '../src/lib/workflow-client.js';
import {buildReceiptHTML} from '../src/lib/pdf.js';
import {validateDocument,validItems} from '../src/lib/domain.js';
const INV='\u8acb\u6c42\u66f8',DEL='\u7d0d\u54c1\u66f8',REC='\u9818\u53ce\u66f8';
const row=(amount,rate=8,included=false)=>({name:'Example',qty:1,price:amount,amount,taxRate:rate,taxIncluded:included,unit:'kg'});
test('regression: mixed 1080 inclusive plus 1000 exclusive equals 2160',()=>{
 const t=calcTax([row(1080,8,true),row(1000)]);assert.equal(t.total,2160);assert.equal(t.sub+t.tax,t.total);
});
test('round taxes once per rate, not once per row',()=>{
 const t=calcTax([row(6),row(6)]);assert.equal(t.total,13);assert.equal(t.tax,1);
});
test('inclusive gross is preserved and all total identities hold over 2000 mixtures',()=>{
 for(let n=1;n<=2000;n++){
  const t=calcTax([row(n,8,true),row(n%100,10),row(n/10)]);
  assert.equal(t.sub+t.tax,t.total);assert.equal(t.s8+t.t8,t.gross8);assert.equal(t.s10+t.t10,t.gross10);
 }
 assert.equal(calcTax([row(15000,8,true)]).total,15000);
});
test('invalid monetary values and unsupported rates fail explicitly',()=>{
 for(const n of [NaN,Infinity,-1])assert.throws(()=>calcTax([row(n)]));
 assert.throws(()=>calcTax([row(1,5)]));
});
test('receipt tax is 100 for known 10 percent and unknown for amount-only receipt',()=>{
 assert.equal(receiptTax({amount:1100,items:[row(1100,10,true)]}),100);
 assert.equal(receiptTax({amount:1100,items:[]}),null);
 assert.equal(receiptTax({amount:1200,items:[row(1100,10,true)]}),null);
});
test('HTML receipt renders unknown tax notice, not guessed 81 yen',()=>{
 const html=buildReceiptHTML({docType:REC,customer:'Test',date:'2026-10-28',amount:1100,items:[]},{});
 assert.ok(html.includes('\u7a0e\u984d\u672a\u8a18\u8f09'));assert.ok(!html.includes('81'));
});
test('HTML escapes customer, product and description text',()=>{
 const html=buildReceiptHTML({docType:REC,customer:'<script>bad()</script>',description:'<img onerror=x>',amount:1100,items:[]},{});
 assert.ok(!html.includes('<script>bad'));assert.ok(html.includes('&lt;script&gt;'));
});
test('stored tax snapshot is used for issued documents',()=>{
 assert.equal(documentTax({taxSummary:{version:2,total:17},items:[]}).total,17);
});
test('decimal amount normalization removes binary multiplication noise',()=>{
 const rows=validItems([{...row(4.1*3),qty:4.1,price:3}]);assert.equal(rows[0].amount,12.3);
 assert.equal(validateDocument({docType:INV,date:'2026-10-28',customer:'Test',items:rows}),'');
});
test('Infinity is not an acceptable manual receipt amount',()=>{
 assert.ok(validateDocument({docType:REC,customer:'Test',amount:Infinity,items:[]}));
});
test('status mapper retains concurrency, conversion, void and inventory fields',()=>{
 const d=mapDocument({id:'x',doc_type:DEL,updated_at:'now',stock_managed:false,voided_at:'past',source_document_ids:['a']});
 assert.equal(d.updatedAt,'now');assert.equal(d.stockManaged,false);assert.equal(isBillable(d),false);assert.deepEqual(d.sourceIds,['a']);
});
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
test('client coalesces simultaneous submissions into one request',async()=>{
 let count=0;const client=createWorkflowClient(async()=>{count++;await new Promise(r=>setTimeout(r,20));return {data:{document:{id:'x'}}};},async()=> 'user',memory());
 const [a,b]=await Promise.all([client('create',{doc:{}}),client('create',{doc:{}})]);assert.equal(count,1);assert.equal(a.document.id,b.document.id);
});
test('ambiguous network failure retries with the same request id after reload',async()=>{
 const storage=memory();let first;
 const broken=createWorkflowClient(async(_,args)=>{first=args.p_request_id;throw new TypeError('Failed to fetch');},async()=> 'user',storage);
 await assert.rejects(broken('create',{doc:{}}));
 const retry=createWorkflowClient(async(_,args)=>{assert.equal(args.p_request_id,first);return {data:{document:{id:'x'}}};},async()=> 'user',storage);
 await retry('create',{doc:{}});
});
test('missing migration fails closed without calling a legacy stock endpoint',async()=>{
 let count=0;const client=createWorkflowClient(async(name)=>{count++;assert.equal(name,'sales_workflow');return {error:{code:'PGRST202',message:'missing'}};},async()=> 'user',memory());
 await assert.rejects(client('create',{doc:{}}),/\u672a\u9069\u7528/);assert.equal(count,1);
});
