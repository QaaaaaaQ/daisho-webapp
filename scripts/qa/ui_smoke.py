import json,time,base64,re,copy
from playwright.sync_api import sync_playwright
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'tmp'/'qa'
OUT.mkdir(parents=True,exist_ok=True)
uid='11111111-1111-4111-8111-111111111111'
pid='22222222-2222-4222-8222-222222222222'
DEL='\u7d0d\u54c1\u66f8';EST='\u898b\u7a4d\u66f8'
now='2026-10-28T00:00:00+00:00'
item={'productId':pid,'name':'Demo item','origin':'\u56fd\u7523','unit':'kg','qty':2,'price':100,'amount':200,'taxRate':8,'taxIncluded':False}
def mkdoc(n,typ=DEL):
 return {'id':f'33333333-3333-4333-8333-{n:012}','doc_type':typ,'doc_no':f'DEL-{n:06}','date':'2026-10-28','customer':'Demo buyer '+str(n),'items':[copy.deepcopy(item)],'stock_managed':True,'created_by':uid,'created_at':now,'updated_at':now,'source_document_ids':[],'workflow_version':2,'amount':216}
docs=[mkdoc(1),mkdoc(2),mkdoc(3,EST)]
docs[2]['stock_managed']=None
products=[{'id':pid,'code':'P-001','name':'Demo item','origin':'\u56fd\u7523','unit':'kg','stock':100,'price':100,'tax_rate':8,'category':'\u30b5\u30b6\u30a8'},
 {'id':'44444444-4444-4444-8444-444444444444','code':'P-002','name':'Other item','origin':'\u56fd\u7523','unit':'kg','stock':-1,'price':200,'tax_rate':8,'category':'\u30a2\u30ef\u30d3'}]
requests=[];errors=[];dialogs=[]
def b64(o):return base64.urlsafe_b64encode(json.dumps(o).encode()).decode().rstrip('=')
session={'access_token':b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':uid,'exp':int(time.time())+3600,'role':'authenticated'})+'.demo','refresh_token':'demo','expires_at':int(time.time())+3600,'expires_in':3600,'token_type':'bearer','user':{'id':uid,'email':'test@example.invalid','user_metadata':{'full_name':'Test Operator'}}}
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 context=browser.new_context(viewport={'width':1365,'height':900})

 page=context.new_page();page.set_default_timeout(10000);page.on('pageerror',lambda e:(errors.append(str(e)),print('JS_ERROR',str(e))));page.on('dialog',lambda d:(dialogs.append(d.message),print('ALERT',d.message),d.accept()))
 page.set_content('<html><head><meta charset="utf-8"></head><body style="margin:0"><div id="root"></div></body></html>')
 page.evaluate('(d)=>{window.__fixtures=d;window.__requests=[]}',{'session':session,'docs':docs,'products':products})
 page.add_script_tag(content=(OUT/'ui-test.js').read_text())
 page.get_by_role('heading',name='\u4eca\u65e5\u306e\u696d\u52d9',exact=True).last.wait_for()
 page.screenshot(path=str(OUT/'home-desktop.png'),full_page=True)
 assert page.get_by_text('DAISHO / WORKSPACE').is_visible()
 page.get_by_role('button',name=re.compile('\u5728\u5eab\u30fb\u5546\u54c1')).click()
 page.locator('td').filter(has_text=re.compile('^\u30b5\u30b6\u30a8$')).first.click()
 assert page.get_by_text('Other item',exact=True).count()==0
 page.screenshot(path=str(OUT/'inventory-filter.png'),full_page=True)
 page.get_by_role('button',name=re.compile('\u8acb\u6c42\u30fb\u767a\u884c\u5c65\u6b74')).click()
 page.get_by_text('DEL-000001',exact=False).first.click()
 page.get_by_role('button',name='\u53d6\u6d88',exact=True).click()
 page.get_by_role('dialog').get_by_role('textbox').fill('UI smoke test - no return')
 page.get_by_role('button',name='\u53d6\u6d88\u3092\u78ba\u5b9a',exact=True).click()
 page.get_by_role('dialog').wait_for(state='hidden')
 requests=page.evaluate('window.__requests');assert requests[-1]['p_action']=='void' and requests[-1]['p_payload']['reverseStock'] is False
 # Copy opens a draft without sending a create request.
 page.get_by_text('DEL-000002',exact=False).first.click();n=page.evaluate('window.__requests.length')
 page.get_by_role('button',name=re.compile('\u30b3\u30d4\u30fc\u4f5c\u6210')).click()
 assert page.evaluate('window.__requests.length')==n
 page.get_by_role('button',name='\u30ad\u30e3\u30f3\u30bb\u30eb',exact=True).last.click()
 page.get_by_role('button',name=re.compile('^.*\u8ca9\u58f2$')).click()
 page.locator('textarea').fill('\u7d0d\u54c1\u66f8\u3092\u4f5c\u6210\u3057\u3066\u304f\u3060\u3055\u3044')
 page.get_by_role('button',name=re.compile('\u9001\u4fe1')).click()
 page.get_by_role('button',name='\u5185\u5bb9\u78ba\u8a8d\u30fb\u4fdd\u5b58',exact=True).wait_for()
 assert page.evaluate('window.__requests.length')==n
 assert page.get_by_role('button',name=re.compile('PDF\u751f\u6210')).is_disabled()
 page.get_by_role('button',name='\u5185\u5bb9\u78ba\u8a8d\u30fb\u4fdd\u5b58',exact=True).click()
 page.get_by_role('button',name='\u2705 \u4fdd\u5b58',exact=True).click()
 page.get_by_text('\u2713 \u4fdd\u5b58\u6e08',exact=True).wait_for()
 requests=page.evaluate('window.__requests');assert requests[-1]['p_action']=='create' and len(requests)==n+1
 page.screenshot(path=str(OUT/'sales-confirmed.png'),full_page=True)
 page.set_viewport_size({'width':390,'height':844})
 page.get_by_role('button',name=re.compile('\u4eca\u65e5\u306e\u696d\u52d9')).click()
 page.screenshot(path=str(OUT/'home-mobile.png'),full_page=True)
 assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
 assert not errors,errors
 browser.close()
print(json.dumps({'ui_checks':7,'javascript_errors':errors,'unexpected_alerts':dialogs,'rpc_calls':len(requests)},ensure_ascii=False))
