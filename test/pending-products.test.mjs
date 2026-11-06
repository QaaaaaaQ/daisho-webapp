import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

test('new shipment products, stock movements and retries are atomic', async () => {
  const db=new PGlite();
  try {
    await db.exec(await readFile(new URL('./fixtures/workflow-schema.sql',import.meta.url),'utf8'));
    await db.exec('ALTER TABLE public.products ADD COLUMN archived_at timestamptz');
    await db.exec(await readFile(new URL('../supabase/migrations/20261027220243_atomic_sales_workflows.sql',import.meta.url),'utf8'));
    await db.exec(`CREATE FUNCTION public.current_user_role() RETURNS text LANGUAGE sql AS $$ SELECT 'employee'::text $$;
      DO $x$ DECLARE d text; BEGIN
        d:=pg_get_functiondef('app_private.prepare_document(jsonb,boolean)'::regprocedure);
        d:=replace(d, 'WHERE btrim(name)=btrim(it->>''name'')', 'WHERE archived_at IS NULL AND btrim(name)=btrim(it->>''name'')');
        EXECUTE d;
      END $x$;`);
    await db.exec(await readFile(new URL('../supabase/migrations/20261106023139_automatic_pending_products.sql',import.meta.url),'utf8'));
    const user=randomUUID(),request=randomUUID();
    await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[user,'staff@example.invalid']);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);
    const doc={docType:'納品書',date:'2026-11-03',customer:'Test',items:[{name:'新しい刺身',unit:'切れ',qty:505,price:55,amount:27775,taxRate:8}]};
    const send=(id,body=doc)=>db.query('SELECT public.sales_workflow($1,$2::jsonb,$3::uuid) result',['create',JSON.stringify({doc:body}),id]);
    const one=(await send(request)).rows[0].result;
    const again=(await send(request)).rows[0].result;
    assert.equal(one.document.id,again.document.id);
    const products=(await db.query('SELECT name,stock,pending_review FROM products')).rows;
    assert.equal(products.length,1); assert.equal(Number(products[0].stock),-505); assert.equal(products[0].pending_review,true);
    assert.equal(Number((await db.query('SELECT count(*) n FROM stock_logs')).rows[0].n),1);
    await db.exec('SET ROLE authenticated');
    await assert.rejects(db.query("INSERT INTO public.products(name,unit,pending_review) VALUES('forged','kg',true)"));
    await db.exec('RESET ROLE');
    await assert.rejects(send(randomUUID(),{...doc,items:[{...doc.items[0],name:'取消される商品'}, {...doc.items[0],name:'',qty:0}]}));
    assert.equal(Number((await db.query("SELECT count(*) n FROM products WHERE name='取消される商品'")).rows[0].n),0);
    await assert.rejects(db.query('SELECT public.review_pending_product($1)',[one.document.items[0].productId]));
    await db.exec("CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS text LANGUAGE sql AS $$ SELECT 'admin'::text $$");
    await assert.rejects(db.query('SELECT public.review_pending_product($1)',[one.document.items[0].productId]));
    await db.query("UPDATE products SET category='ふぐ類' WHERE id=$1",[one.document.items[0].productId]);
    await db.query('SELECT public.review_pending_product($1)',[one.document.items[0].productId]);
    assert.equal((await db.query('SELECT pending_review FROM products WHERE id=$1',[one.document.items[0].productId])).rows[0].pending_review,false);
    await assert.rejects(send(randomUUID()));
    assert.equal(Number((await db.query('SELECT stock FROM products WHERE id=$1',[one.document.items[0].productId])).rows[0].stock),-505);
    await db.query("INSERT INTO products(name,unit,stock) VALUES('同名','kg',1),('同名','kg',1)");
    await assert.rejects(send(randomUUID(),{...doc,items:[{...doc.items[0],name:'同名',unit:'kg'}]}));
  } finally { await db.close(); }
});
