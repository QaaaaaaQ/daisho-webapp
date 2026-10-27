import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {calcTax} from '../src/lib/money.js';
const DEL='\u7d0d\u54c1\u66f8',INV='\u8acb\u6c42\u66f8',REC='\u9818\u53ce\u66f8',EST='\u898b\u7a4d\u66f8';
const USER=randomUUID(),OTHER=randomUUID(),PRODUCT=randomUUID();
let pg;
test.before(async()=>{
 pg=new PGlite();
 await pg.exec(await readFile(new URL('./fixtures/workflow-schema.sql',import.meta.url),'utf8'));
 await pg.exec(await readFile(new URL('../supabase/migrations/20261027220243_atomic_sales_workflows.sql',import.meta.url),'utf8'));
 await pg.query('INSERT INTO auth.users VALUES($1,$2),($3,$4)',[USER,'one@example.invalid',OTHER,'two@example.invalid']);
 await pg.query('INSERT INTO products(id,code,name,unit,stock)VALUES($1,$2,$3,$4,1000)',[PRODUCT,'TEST-1','Example','kg']);
 await pg.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[USER]);
});
test.after(async()=>pg?.close());
async function call(action,payload,request=randomUUID()){
 return (await pg.query('SELECT public.sales_workflow($1,$2::jsonb,$3::uuid) AS result',[action,JSON.stringify(payload),request])).rows[0].result;
}
const item=(qty=2,price=100)=>({productId:PRODUCT,name:'Example',unit:'kg',qty,price,amount:qty*price,taxRate:8,taxIncluded:false});
const doc=(type=DEL,items=[item()])=>({docType:type,date:'2026-10-28',customer:'Fixture customer',items});
const stock=async()=>Number((await pg.query('SELECT stock FROM products WHERE id=$1',[PRODUCT])).rows[0].stock);
const count=async(table)=>Number((await pg.query('SELECT count(*) AS n FROM '+table)).rows[0].n);
const get=async(id)=>(await pg.query('SELECT * FROM documents WHERE id=$1',[id])).rows[0];
test('atomic create and identical retry change stock exactly once',async()=>{
 const before=await stock(),request=randomUUID(),payload={doc:doc()};
 const a=await call('create',payload,request),b=await call('create',payload,request);
 assert.equal(a.document.id,b.document.id);assert.equal(await stock(),before-2);
 assert.equal(a.document.workflow_version,2);assert.equal(a.document.amount,216);
 assert.equal(a.document.items[0].productId,PRODUCT);
 await assert.rejects(call('create',{doc:doc(DEL,[item(3)])},request));
});
test('failed insufficient-stock create rolls back document, sequence, audit and stock',async()=>{
 const before={stock:await stock(),docs:await count('documents'),audit:await count('document_audit_log')};
 await assert.rejects(call('create',{doc:doc(DEL,[item(10000)])}));
 assert.deepEqual({stock:await stock(),docs:await count('documents'),audit:await count('document_audit_log')},before);
});
test('estimates, receipts and direct invoices do not change stock by default',async()=>{
 const before=await stock();
 for(const type of [EST,REC,INV]) await call('create',{doc:doc(type)});
 assert.equal(await stock(),before);
});
test('direct invoice deducts only on explicit shipment choice',async()=>{
 const before=await stock();await call('create',{doc:{...doc(INV),stockManaged:true}});assert.equal(await stock(),before-2);
});
test('amount-only receipt has unknown tax, never guessed 8 percent',async()=>{
 const out=await call('create',{doc:{...doc(REC,[]),amount:1100}});assert.equal(out.document.tax_summary,null);assert.equal(out.document.amount,1100);
});
test('quantity edit applies only difference; price edit does not move stock',async()=>{
 let d=(await call('create',{doc:doc(DEL,[item(10)])})).document;const before=await stock();
 d=(await call('update',{id:d.id,expectedUpdatedAt:d.updated_at,doc:{...doc(DEL,[item(6)]),stockManaged:true}})).document;
 assert.equal(await stock(),before+4);
 const logs=await count('stock_logs');
 await call('update',{id:d.id,expectedUpdatedAt:d.updated_at,doc:doc(DEL,[item(6,150)])});assert.equal(await stock(),before+4);assert.equal(await count('stock_logs'),logs);
});
test('stale editor cannot overwrite newer data',async()=>{
 const d=(await call('create',{doc:doc()})).document;
 await call('update',{id:d.id,expectedUpdatedAt:d.updated_at,doc:{...doc(),subject:'first'}});
 await assert.rejects(call('update',{id:d.id,expectedUpdatedAt:d.updated_at,doc:{...doc(),subject:'second'}}));
});
test('invoice conversion retains originals and stock logs without a second shipment',async()=>{
 const a=(await call('create',{doc:doc()})).document,b=(await call('create',{doc:doc()})).document;
 const before=await stock(),logs=await count('stock_logs');
 const inv=(await call('invoice',{sourceIds:[a.id,b.id],doc:{date:'2026-10-28'}})).document;
 assert.equal(await stock(),before);assert.equal(await count('stock_logs'),logs);
 assert.equal((await get(a.id)).converted_to_document_id,inv.id);
 assert.equal(inv.items.length,2);assert.equal(inv.stock_managed,false);
 await assert.rejects(call('invoice',{sourceIds:[a.id],doc:{date:'2026-10-28'}}));
 await call('void',{id:inv.id,reason:'Reissue',reverseStock:false});
 assert.equal((await get(a.id)).converted_to_document_id,null);assert.equal(await stock(),before);
});
test('invalid or mixed-customer sources are rejected atomically',async()=>{
 const a=(await call('create',{doc:doc()})).document;
 const b=(await call('create',{doc:{...doc(),customer:'Other customer'}})).document;
 const n=await count('documents');
 await assert.rejects(call('invoice',{sourceIds:[a.id,a.id],doc:{date:'2026-10-28'}}));
 await assert.rejects(call('invoice',{sourceIds:[a.id,b.id],doc:{date:'2026-10-28'}}));
 assert.equal(await count('documents'),n);assert.equal((await get(a.id)).converted_to_document_id,null);
});
test('void alone does not return physically shipped inventory',async()=>{
 const d=(await call('create',{doc:doc()})).document,before=await stock();
 const v=(await call('void',{id:d.id,reason:'Document correction',reverseStock:false})).document;
 assert.ok(v.voided_at);assert.equal(await stock(),before);assert.ok(await get(d.id));
});
test('explicit reversal restores logged movement once even with a new retry key',async()=>{
 const d=(await call('create',{doc:doc()})).document,before=await stock();
 await call('void',{id:d.id,reason:'Shipment never occurred',reverseStock:true});
 await call('void',{id:d.id,reason:'Shipment never occurred',reverseStock:true});assert.equal(await stock(),before+2);
});
test('unknown legacy quantities cannot be silently reconciled',async()=>{
 const d=(await call('create',{doc:doc(EST)})).document;
 await pg.query('UPDATE documents SET stock_managed=NULL,workflow_version=NULL WHERE id=$1',[d.id]);
 const current=await get(d.id),before=await stock();
 await assert.rejects(call('update',{id:d.id,expectedUpdatedAt:current.updated_at,doc:doc(EST,[item(5)])}));
 assert.equal(await stock(),before);
});
test('adjustments require a reason and retry idempotently',async()=>{
 const before=await stock();await assert.rejects(call('adjust',{productId:PRODUCT,change:3,reason:''}));
 const key=randomUUID(),payload={productId:PRODUCT,change:3,reason:'Physical receipt'};
 await call('adjust',payload,key);await call('adjust',payload,key);assert.equal(await stock(),before+3);
});
test('other users cannot update or void owned documents',async()=>{
 const d=(await call('create',{doc:doc()})).document;
 await pg.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[OTHER]);
 try {await assert.rejects(call('void',{id:d.id,reason:'Unauthorized'}));}
 finally {await pg.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[USER]);}
});
test('authenticated RPC works without direct table privileges and anonymous callers are denied',async()=>{
 await pg.exec('SET ROLE authenticated');
 try {await call('create',{doc:doc(EST)});await assert.rejects(pg.query('SELECT * FROM app_private.workflow_requests'));}
 finally{await pg.exec('RESET ROLE');}
 await pg.exec('SET ROLE anon');
 try{await assert.rejects(call('create',{doc:doc(EST)}));}finally{await pg.exec('RESET ROLE');}
});
test('JS and PostgreSQL tax calculation agree over mixed samples',async()=>{
 for(let k=1;k<=30;k++){
  const items=[{...item(k,k/10),taxIncluded:true},{...item(2,k+1),taxRate:10},{...item(3,k/2),taxIncluded:false}];
  const sql=(await pg.query('SELECT app_private.document_tax($1::jsonb) AS tx',[JSON.stringify(items)])).rows[0].tx;
  const js=calcTax(items);for(const key of Object.keys(js))assert.equal(Number(sql[key]),js[key],`${k}: ${key}`);
 }
});
