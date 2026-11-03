import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

const actor=randomUUID(), product=randomUUID(), docId=randomUUID(), repairDocId=randomUUID(), invoiceId=randomUUID();
let pg;
test.before(async()=>{
  pg=new PGlite();
  await pg.exec(await readFile(new URL('./fixtures/workflow-schema.sql',import.meta.url),'utf8'));
  await pg.exec(await readFile(new URL('../supabase/migrations/20261027220243_atomic_sales_workflows.sql',import.meta.url),'utf8'));
  await pg.exec(await readFile(new URL('../supabase/migrations/20261101000000_operations_modules.sql',import.meta.url),'utf8'));
  await pg.exec(await readFile(new URL('../supabase/migrations/20261101031605_pca_manual_payment_and_account_mapping.sql',import.meta.url),'utf8'));
  await pg.exec(await readFile(new URL('../supabase/migrations/20261101032348_disable_payment_csv_import.sql',import.meta.url),'utf8'));
  await pg.exec(await readFile(new URL('../supabase/migrations/20261101080517_sync_reserved_document_changes.sql',import.meta.url),'utf8'));
  await pg.exec(await readFile(new URL('../supabase/migrations/20261101081041_revoke_legacy_workflow_rpcs.sql',import.meta.url),'utf8'));
  await pg.exec(await readFile(new URL('../supabase/migrations/20261101083428_fix_user_list_email_type.sql',import.meta.url),'utf8'));
  await pg.exec(await readFile(new URL('../supabase/migrations/20261101131115_document_input_audit.sql',import.meta.url),'utf8'));
  await pg.exec("ALTER TABLE public.products ENABLE ROW LEVEL SECURITY; GRANT SELECT, UPDATE, DELETE ON public.products TO authenticated; CREATE POLICY products_select ON public.products FOR SELECT TO authenticated USING (true);");
  await pg.exec(await readFile(new URL('../supabase/migrations/20261103033340_product_staff_edit_permissions.sql',import.meta.url),'utf8'));
  await pg.query('INSERT INTO auth.users VALUES($1,$2)',[actor,'admin@example.invalid']);
  await pg.query("INSERT INTO app_private.user_roles(user_id,role) VALUES($1,'admin')",[actor]);
  await pg.query('INSERT INTO products(id,name,unit,stock) VALUES($1,$2,$3,100)',[product,'Fish','kg']);
  await pg.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[actor]);
});
test.after(async()=>pg?.close());

test('staff may edit product attributes but not stock or delete; administrators can delete unused products',async()=>{
  const staff=randomUUID(), unused=randomUUID();
  await pg.query('INSERT INTO auth.users VALUES($1,$2)',[staff,'staff-edit@example.invalid']);
  await pg.query("INSERT INTO app_private.user_roles(user_id,role) VALUES($1,'employee')",[staff]);
  await pg.query("INSERT INTO products(id,name,stock) VALUES($1,'Test product',0)",[unused]);
  await pg.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[staff]);
  await pg.exec('SET ROLE authenticated');
  try {
    assert.equal((await pg.query("UPDATE products SET name='Changed' WHERE id=$1 RETURNING name",[unused])).rows[0].name,'Changed');
    await assert.rejects(pg.query('UPDATE products SET stock=100 WHERE id=$1',[unused]));
    assert.equal((await pg.query('DELETE FROM products WHERE id=$1 RETURNING id',[unused])).rows.length,0);
  } finally {await pg.exec('RESET ROLE');}
  await pg.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[actor]);
  const linked=randomUUID();
  await pg.query("INSERT INTO products(id,name,stock) VALUES($1,'Linked product',0)",[linked]);
  await pg.query("INSERT INTO stock_logs(product_id,change) VALUES($1,2)",[linked]);
  await pg.exec('SET ROLE authenticated');
  try {
    assert.equal((await pg.query('DELETE FROM products WHERE id=$1 RETURNING id',[product])).rows.length,0);
    await assert.rejects(pg.query('DELETE FROM products WHERE id=$1 RETURNING id',[linked]),/foreign key/i);
    assert.equal((await pg.query('DELETE FROM products WHERE id=$1 RETURNING id',[unused])).rows.length,1);
  }
  finally {await pg.exec('RESET ROLE');}
});

test('reserve shipment mode is stored when a delivery document is created',async()=>{
  const reserveProduct=randomUUID();
  const location=(await pg.query("SELECT id FROM inventory_locations WHERE name='主倉庫'")).rows[0].id;
  await pg.query('INSERT INTO products(id,name,unit,stock) VALUES($1,$2,$3,100)',[reserveProduct,'Atomic reserve fish','kg']);
  await pg.query("INSERT INTO inventory_lots(product_id,location_id,lot_code,on_hand_kg,on_hand_cases) VALUES($1,$2,'ATOMIC-OPENING',100,20)",[reserveProduct,location]);
  const request=randomUUID();
  const payload={doc:{docType:'納品書',date:'2026-10-31',customer:'Reserve customer',stockManaged:false,inventoryMode:'reserve',
    items:[{productId:reserveProduct,name:'Atomic reserve fish',unit:'kg',qty:2,caseCount:1,price:100,amount:200,taxRate:8,taxIncluded:false}]}};
  const result=(await pg.query('SELECT public.sales_workflow($1,$2::jsonb,$3::uuid) value',['create',JSON.stringify(payload),request])).rows[0].value;
  assert.equal(result.document.inventory_mode,'reserve');
  const reservation=(await pg.query('SELECT status,quantity_kg,case_count FROM inventory_reservations WHERE document_id=$1',[result.document.id])).rows[0];
  assert.equal(reservation.status,'reserved');assert.equal(Number(reservation.quantity_kg),2);assert.equal(Number(reservation.case_count),1);
  const limitedProduct=randomUUID();
  await pg.query('INSERT INTO products(id,name,unit,stock) VALUES($1,$2,$3,5)',[limitedProduct,'Insufficient reserve fish','kg']);
  await pg.query("INSERT INTO inventory_lots(product_id,location_id,lot_code,on_hand_kg,on_hand_cases) VALUES($1,$2,'LIMITED-OPENING',5,1)",[limitedProduct,location]);
  const failPayload={doc:{docType:'納品書',date:'2026-10-31',customer:'Must roll back',stockManaged:false,inventoryMode:'reserve',
    items:[{productId:limitedProduct,name:'Insufficient reserve fish',unit:'kg',qty:6,caseCount:1,price:100,amount:600,taxRate:8,taxIncluded:false}]}};
  await assert.rejects(pg.query('SELECT public.sales_workflow($1,$2::jsonb,$3::uuid)',['create',JSON.stringify(failPayload),randomUUID()]));
  assert.equal((await pg.query("SELECT count(*)::int n FROM documents WHERE customer='Must roll back'")).rows[0].n,0);
  assert.equal((await pg.query("SELECT count(*)::int n FROM inventory_reservations WHERE product_id=$1",[limitedProduct])).rows[0].n,0);
});

test('authenticated document creation is restricted to the atomic workflow RPC',async()=>{
  assert.equal((await pg.query("SELECT has_table_privilege('authenticated','public.documents','INSERT') allowed")).rows[0].allowed,false);
  assert.equal((await pg.query("SELECT has_table_privilege('authenticated','public.documents','UPDATE') allowed")).rows[0].allowed,false);
  assert.match((await pg.query("SELECT qual FROM pg_policies WHERE tablename='documents' AND policyname='documents_read_owner_or_admin'")).rows[0].qual,/created_by.*uid/);
  assert.equal((await pg.query("SELECT has_function_privilege('authenticated','public.create_document(jsonb)','EXECUTE') allowed")).rows[0].allowed,false);
  assert.equal((await pg.query("SELECT has_function_privilege('authenticated','public.sales_workflow(text,jsonb,uuid)','EXECUTE') allowed")).rows[0].allowed,true);
  await pg.exec('SET ROLE authenticated');
  try {
    const payload={doc:{docType:'領収書',date:'2026-11-01',customer:'RPC test',amount:100,items:[]}};
    const result=(await pg.query('SELECT public.sales_workflow($1,$2::jsonb,$3::uuid) value',['create',JSON.stringify(payload),randomUUID()])).rows[0].value;
    assert.equal(result.document.customer,'RPC test');
  } finally { await pg.exec('RESET ROLE'); }
});

test('an administrator can list users and change a role while an employee is denied',async()=>{
  const employee=randomUUID();
  await pg.query('INSERT INTO auth.users VALUES($1,$2)',[employee,'permission-test@example.invalid']);
  let users=(await pg.query('SELECT * FROM public.list_app_users()')).rows;
  assert.equal(users.find(u=>u.user_id===employee)?.role,'employee');
  await pg.query("SELECT public.set_user_role($1,'admin')",[employee]);
  users=(await pg.query('SELECT * FROM public.list_app_users()')).rows;
  assert.equal(users.find(u=>u.user_id===employee)?.role,'admin');
  await pg.query("SELECT public.set_user_role($1,'employee')",[employee]);
  await pg.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[employee]);
  try { await assert.rejects(pg.query('SELECT * FROM public.list_app_users()')); }
  finally { await pg.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[actor]); }
});

test('input events identify their real actor, contain only structured fields, and are searchable by administrators',async()=>{
  const employee=randomUUID();
  await pg.query('INSERT INTO auth.users VALUES($1,$2)',[employee,'input-test@example.invalid']);
  await pg.query("INSERT INTO app_private.user_roles(user_id,role) VALUES($1,'employee')",[employee]);
  await pg.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[employee]);
  await pg.query("SELECT public.record_document_input_event('請求書','validation_error','customer_code_missing','customer_code',NULL)");
  await pg.query("SELECT public.record_document_input_event('請求書','validation_error','product_category_missing','items.0.category',NULL)");
  await assert.rejects(pg.query("SELECT public.record_document_input_event('請求書','validation_error','private free text','customer_code',NULL)"));
  await assert.rejects(pg.query('SELECT * FROM public.list_document_input_events()'));
  assert.equal((await pg.query("SELECT has_function_privilege('anon','public.record_document_input_event(text,text,text,text,uuid)','EXECUTE') allowed")).rows[0].allowed,false);
  assert.equal((await pg.query("SELECT has_table_privilege('authenticated','app_private.document_input_events','SELECT') allowed")).rows[0].allowed,false);
  await pg.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[actor]);
  const rows=(await pg.query("SELECT * FROM public.list_document_input_events($1,'請求書',NULL,NULL,200)",[employee])).rows;
  assert.equal(rows.length,2);assert.ok(rows.every(row=>row.actor_id===employee));
  assert.ok(rows.some(row=>row.issue_code==='customer_code_missing'&&row.field_name==='customer_code'));
  assert.ok(rows.some(row=>row.issue_code==='product_category_missing'&&row.field_name==='items.0.category'));
});

test('editing a reserved document updates reservations atomically and shipped quantities cannot change',async()=>{
  const id=randomUUID();
  const location=(await pg.query("SELECT id FROM inventory_locations WHERE name='主倉庫'")).rows[0].id;
  await pg.query('INSERT INTO products(id,name,unit,stock) VALUES($1,$2,$3,100)',[id,'Edit reserve fish','kg']);
  await pg.query("INSERT INTO inventory_lots(product_id,location_id,lot_code,on_hand_kg,on_hand_cases) VALUES($1,$2,'EDIT',100,20)",[id,location]);
  const doc={docType:'納品書',date:'2026-10-31',customer:'Test',stockManaged:false,inventoryMode:'reserve',items:[{productId:id,name:'Fish',unit:'kg',qty:2,caseCount:1,price:100,amount:200,taxRate:8,taxIncluded:false}]};
  const invoke=async(action,payload)=>(await pg.query('SELECT public.sales_workflow($1,$2::jsonb,$3::uuid) value',[action,JSON.stringify(payload),randomUUID()])).rows[0].value;
  const created=(await invoke('create',{doc})).document;
  doc.items[0]={...doc.items[0],qty:10,caseCount:5,amount:1000};
  const edited=(await invoke('update',{id:created.id,expectedUpdatedAt:created.updated_at,doc})).document;
  const reserved=(await pg.query("SELECT quantity_kg,case_count FROM inventory_reservations WHERE document_id=$1 AND status='reserved'",[created.id])).rows[0];
  assert.equal(Number(reserved.quantity_kg),10);assert.equal(Number(reserved.case_count),5);
  const tooMuch={...doc,items:[{...doc.items[0],qty:101,amount:10100}]};
  await assert.rejects(invoke('update',{id:created.id,expectedUpdatedAt:edited.updated_at,doc:tooMuch}));
  const afterFailure=(await pg.query("SELECT quantity_kg,case_count FROM inventory_reservations WHERE document_id=$1 AND status='reserved'",[created.id])).rows[0];
  assert.equal(Number(afterFailure.quantity_kg),10);assert.equal(Number(afterFailure.case_count),5);
  await pg.query("SELECT inventory_workflow('ship',$1::uuid,NULL::uuid,'test')",[created.id]);
  doc.items[0]={...doc.items[0],qty:11,amount:1100};
  await assert.rejects(invoke('update',{id:created.id,expectedUpdatedAt:edited.updated_at,doc}));
});

test('employees see their own documents and administrators see both owners',async()=>{
  const employee=randomUUID(), other=randomUUID(), a=randomUUID(), b=randomUUID();
  await pg.query('INSERT INTO auth.users VALUES($1,$2),($3,$4)',[employee,'one@example.invalid',other,'two@example.invalid']);
  await pg.query("INSERT INTO app_private.user_roles(user_id,role) VALUES($1,'employee'),($2,'employee')",[employee,other]);
  await pg.query("INSERT INTO documents(id,doc_type,doc_no,customer,created_by) VALUES($1,'領収書','OWNER-A','A',$2),($3,'領収書','OWNER-B','B',$4)",[a,employee,b,other]);
  await pg.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[employee]);
  await pg.exec('SET ROLE authenticated');
  try {
    const visible=(await pg.query("SELECT doc_no FROM documents WHERE id=ANY($1::uuid[]) ORDER BY doc_no",[[a,b]])).rows.map(row=>row.doc_no);
    assert.deepEqual(visible,['OWNER-A']);
    await pg.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[actor]);
    const adminVisible=(await pg.query("SELECT doc_no FROM documents WHERE id=ANY($1::uuid[]) ORDER BY doc_no",[[a,b]])).rows.map(row=>row.doc_no);
    assert.deepEqual(adminVisible,['OWNER-A','OWNER-B']);
  } finally { await pg.exec('RESET ROLE'); await pg.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[actor]); }
});

test('reserve, ship, and cancel preserve independent kg and case balances',async()=>{
  await pg.query('UPDATE products SET stock=40 WHERE id=$1',[product]);
  const location=(await pg.query("SELECT id FROM inventory_locations WHERE name='主倉庫'")).rows[0].id;
  await pg.query("INSERT INTO inventory_lots(product_id,location_id,lot_code,on_hand_kg,on_hand_cases) VALUES($1,$2,'LOT-A',40,4)",[product,location]);
  const lot=(await pg.query('SELECT id FROM inventory_lots WHERE product_id=$1',[product])).rows[0].id;
  const directPayload={doc:{docType:'納品書',date:'2026-10-31',customer:'Direct customer',stockManaged:true,
    items:[{productId:product,name:'Fish',unit:'kg',qty:1,price:100,amount:100,taxRate:8,taxIncluded:false}]}};
  await assert.rejects(pg.query('SELECT public.sales_workflow($1,$2::jsonb,$3::uuid)',['create',JSON.stringify(directPayload),randomUUID()]));
  assert.equal(Number((await pg.query('SELECT stock FROM products WHERE id=$1',[product])).rows[0].stock),40);
  await pg.query("INSERT INTO documents(id,doc_type,doc_no,date,customer,items,created_by,stock_managed,inventory_mode) VALUES($1,'納品書','DEL-TEST','2026-10-31','Test',jsonb_build_array(jsonb_build_object('productId',$2::uuid,'name','Fish','unit','kg','qty',7.5,'caseCount',1),jsonb_build_object('productId',$2::uuid,'name','Fish same product row','unit','kg','qty',5,'caseCount',1)), $3,false,'reserve')",[docId,product,actor]);
  await pg.query("SELECT inventory_workflow('reserve',$1::uuid,$2::uuid,'confirmed')",[docId,location]);
  await assert.rejects(pg.query("SELECT inventory_workflow(NULL,$1::uuid,NULL::uuid,NULL)",[docId]));
  let row=(await pg.query('SELECT * FROM inventory_lots WHERE id=$1',[lot])).rows[0];
  assert.equal(Number(row.reserved_kg),12.5);assert.equal(Number(row.reserved_cases),2);
  await pg.query("SELECT inventory_workflow('ship',$1::uuid,NULL::uuid,'shipped')",[docId]);
  row=(await pg.query('SELECT * FROM inventory_lots WHERE id=$1',[lot])).rows[0];
  assert.equal(Number(row.on_hand_kg),27.5);assert.equal(Number(row.on_hand_cases),2);
  assert.equal(Number((await pg.query('SELECT stock FROM products WHERE id=$1',[product])).rows[0].stock),27.5);
  await assert.rejects(pg.query('UPDATE products SET stock=stock+1 WHERE id=$1',[product]));
  const second=randomUUID();
  await pg.query("INSERT INTO documents(id,doc_type,doc_no,date,customer,items,created_by,stock_managed,inventory_mode) VALUES($1,'納品書','DEL-TEST-2','2026-10-31','Test',jsonb_build_array(jsonb_build_object('productId',$2::uuid,'name','Fish','unit','kg','qty',10,'caseCount',1)), $3,false,'reserve')",[second,product,actor]);
  await pg.query("SELECT inventory_workflow('reserve',$1::uuid,$2::uuid,'confirmed')",[second,location]);
  await pg.query("UPDATE documents SET voided_at=now() WHERE id=$1::uuid",[second]);
  row=(await pg.query('SELECT * FROM inventory_lots WHERE id=$1',[lot])).rows[0];
  assert.equal(Number(row.on_hand_kg),27.5);assert.equal(Number(row.reserved_kg),0);assert.equal(Number(row.on_hand_cases),2);assert.equal(Number(row.reserved_cases),0);
});

test('manual payment entry is idempotent and audited',async()=>{
  const request=randomUUID();
  const paymentId=(await pg.query("SELECT create_manual_payment('2026-10-31','Customer',5000,'R1',$1) id",[request])).rows[0].id;
  assert.equal((await pg.query("SELECT create_manual_payment('2026-10-31','Customer',5000,'R1',$1) id",[request])).rows[0].id,paymentId);
  assert.equal((await pg.query("SELECT event FROM payment_audit WHERE payment_id=$1",[paymentId])).rows[0].event,'manual');
  await assert.rejects(pg.query("SELECT create_manual_payment('2026-10-31','Customer','NaN','R2',$1)",[randomUUID()]));
  await pg.query("INSERT INTO documents(id,doc_type,doc_no,date,customer,items,created_by,tax_summary) VALUES($1,'請求書','INV-TEST','2026-10-31','Customer','[]',$2,'{\"version\":2,\"total\":3000}')",[invoiceId,actor]);
  const payment=paymentId;
  const allocationRequest=randomUUID();
  const result=(await pg.query("SELECT allocate_payment($1,$2,2500,$3) result",[payment,invoiceId,allocationRequest])).rows[0].result;
  assert.equal(result.invoicePaid,2500);assert.equal(result.unapplied,2500);
  const retry=(await pg.query("SELECT allocate_payment($1,$2,2500,$3) result",[payment,invoiceId,allocationRequest])).rows[0].result;
  assert.equal(retry.invoicePaid,2500);assert.equal((await pg.query('SELECT count(*)::int n FROM payment_allocations')).rows[0].n,1);
  await assert.rejects(pg.query("SELECT allocate_payment($1,$2,600,$3)",[payment,invoiceId,randomUUID()]));
});

test('bank CSV import RPC is no longer executable by browser roles',async()=>{
  assert.equal((await pg.query("SELECT has_function_privilege('anon','public.import_payments(jsonb)','EXECUTE') allowed")).rows[0].allowed,false);
  assert.equal((await pg.query("SELECT has_function_privilege('authenticated','public.import_payments(jsonb)','EXECUTE') allowed")).rows[0].allowed,false);
  assert.equal((await pg.query("SELECT to_regprocedure('public.import_payments(jsonb)') IS NOT NULL retained")).rows[0].retained,true);
});

test('historical rate correction requires admin and writes an item-level audit record',async()=>{
  await pg.query("INSERT INTO documents(id,doc_type,doc_no,date,customer,items,created_by) VALUES($1,'納品書','DEL-TAX','2026-10-31','Customer',$2,$3)",[repairDocId,JSON.stringify([{name:'fish',qty:1,price:100,amount:100,taxRate:0}]),actor]);
  const before=(await pg.query('SELECT updated_at FROM documents WHERE id=$1',[repairDocId])).rows[0].updated_at;
  const result=await pg.query('SELECT repair_legacy_document_tax($1,$2,$3::jsonb) result',[repairDocId,before,'[8]']);
  assert.equal(result.rows[0].result.taxSummary.total,108);
  const audit=(await pg.query('SELECT old_items,new_items FROM historical_tax_repairs WHERE document_id=$1',[repairDocId])).rows[0];
  assert.equal(audit.old_items[0].taxRate,0);assert.equal(audit.new_items[0].taxRate,8);
  const updated=(await pg.query('SELECT updated_at FROM documents WHERE id=$1',[repairDocId])).rows[0].updated_at;
  await assert.rejects(pg.query('SELECT repair_legacy_document_tax($1,$2,$3::jsonb) result',[repairDocId,updated,'[null]']));
});

test('the user-excluded legacy document cannot be changed by the repair RPC',async()=>{
  const excludedId=randomUUID();
  await pg.query("INSERT INTO documents(id,doc_type,doc_no,date,customer,items,created_by) VALUES($1,'納品書','DEL-9102950006','2026-10-31','Excluded test record',$2,$3)",[excludedId,JSON.stringify([{name:'fish',qty:1,price:100,amount:100,taxRate:0}]),actor]);
  const before=(await pg.query('SELECT items FROM documents WHERE id=$1',[excludedId])).rows[0].items;
  const updated=(await pg.query('SELECT updated_at FROM documents WHERE id=$1',[excludedId])).rows[0].updated_at;
  await assert.rejects(pg.query('SELECT repair_legacy_document_tax($1,$2,$3::jsonb)',[excludedId,updated,'[8]']));
  assert.deepEqual((await pg.query('SELECT items FROM documents WHERE id=$1',[excludedId])).rows[0].items,before);
});

test('inventory lot RPC rejects non-finite kg before it can enter stock balances',async()=>{
  const location=(await pg.query("SELECT id FROM inventory_locations WHERE name='主倉庫'")).rows[0].id;
  await assert.rejects(pg.query("SELECT create_inventory_lot($1,$2,'NAN-LOT',current_date,NULL,'NaN'::numeric,1,'receipt',NULL)",[product,location]));
});

test('employee cannot change role, create opening inventory, or repair historical taxes',async()=>{
  const employee=randomUUID();
  await pg.query('INSERT INTO auth.users VALUES($1,$2)',[employee,'staff@example.invalid']);
  await pg.query("INSERT INTO app_private.user_roles(user_id,role) VALUES($1,'employee')",[employee]);
  await pg.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[employee]);
  assert.equal((await pg.query('SELECT public.current_user_role() role')).rows[0].role,'employee');
  await assert.rejects(pg.query("SELECT public.set_user_role($1,'admin')",[employee]));
  await assert.rejects(pg.query("SELECT public.create_inventory_lot($1,$2,'STAFF-LOT',current_date,NULL,5,1,NULL)",[product,(await pg.query("SELECT id FROM inventory_locations WHERE name='主倉庫'")).rows[0].id]));
  await assert.rejects(pg.query("SELECT public.repair_legacy_document_tax($1,$2,'[8]'::jsonb)",[docId,(await pg.query('SELECT updated_at FROM documents WHERE id=$1',[docId])).rows[0].updated_at]));
});
