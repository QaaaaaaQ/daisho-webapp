"""Exercise the real React history page offline, with synthetic legacy records."""
import copy, json, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'tmp' / 'qa'
OUT.mkdir(parents=True, exist_ok=True)
DEL = '\u7d0d\u54c1\u66f8'
HISTORY = '\u8acb\u6c42\u30fb\u767a\u884c\u5c65\u6b74'
now = '2026-10-28T00:00:00+00:00'
uid = '11111111-1111-4111-8111-111111111111'
base = dict(doc_type=DEL, date='2026-10-28', created_at=now, updated_at=now,
            created_by=uid, stock_managed=True, source_document_ids=[])
legacy = dict(base, id='legacy', doc_no='DEL-LEGACY-0', customer='Legacy buyer', amount=None,
              items=[dict(name='Legacy A',qty=1,price=68000,amount=68000,unit='kg',taxRate=0),
                     dict(name='Legacy B',qty=1,price=15000,amount=15000,unit='kg',taxRate=0)])
healthy = dict(base, id='healthy', doc_no='DEL-HEALTHY-8', customer='Healthy buyer', amount=2160,
              items=[dict(name='Item A',qty=1,price=1080,amount=1080,unit='kg',taxRate=8,taxIncluded=True),
                     dict(name='Item B',qty=1,price=1000,amount=1000,unit='kg',taxRate=8,taxIncluded=False)])
fixtures = {'session':{'user':{'id':uid,'email':'test@example.invalid','user_metadata':{'full_name':'History Test'}}},
            'docs':[legacy,healthy], 'products':[]}
errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=p.chromium.executable_path,headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1365,'height':900})
    page=context.new_page();page.set_default_timeout(7000)
    page.on('pageerror', lambda e:errors.append(str(e)))
    page.route('**/*', lambda route:route.abort())
    page.set_content('<html><body style="margin:0"><div id="root"></div></body></html>')
    page.evaluate('(d)=>{window.__fixtures=d;window.__requests=[]}',fixtures)
    page.add_script_tag(content=(OUT/'ui-test.js').read_text(encoding='utf-8'))
    page.get_by_role('heading',name='\u4eca\u65e5\u306e\u696d\u52d9',exact=True).last.wait_for()
    page.get_by_role('button',name=re.compile(HISTORY)).click()
    if '--expect-crash' in sys.argv:
        page.wait_for_timeout(300)
        assert any('Unsupported tax rate' in e for e in errors),errors
        print(json.dumps({'original_failure_reproduced':True,'errors':errors}))
    else:
        page.get_by_text('DEL-LEGACY-0',exact=False).first.wait_for()
        assert page.get_by_text('DEL-HEALTHY-8',exact=False).first.is_visible()
        assert page.get_by_text('2,160\u5186',exact=True).is_visible()
        assert page.get_by_text('\u7a0e\u533a\u5206\u30fb\u91d1\u984d\u8981\u78ba\u8a8d',exact=False).count()>0
        page.screenshot(path=str(OUT/'history-fixed.png'),full_page=True)
        page.get_by_text('DEL-LEGACY-0',exact=False).first.click()
        assert page.get_by_text('68,000\u5186',exact=True).is_visible()
        assert page.get_by_text('15,000\u5186',exact=True).is_visible()
        assert page.get_by_role('button',name=re.compile('PDF')).last.is_disabled()
        assert page.get_by_role('button',name=re.compile('\u7de8\u96c6')).last.is_disabled()
        page.screenshot(path=str(OUT/'history-legacy-detail.png'),full_page=True)
        page.get_by_role('button',name='\u00d7',exact=True).last.click()
        search=page.get_by_placeholder('\u53d6\u5f15\u5148\u30fb\u66f8\u985e\u756a\u53f7\u3067\u691c\u7d22...')
        search.fill('Healthy')
        assert page.get_by_text('DEL-LEGACY-0',exact=False).count()==0
        assert page.get_by_text('DEL-HEALTHY-8',exact=False).first.is_visible()
        search.fill('')
        page.get_by_role('button',name=re.compile('\u8907\u6570\u9078\u629e')).click()
        checks=page.locator('input[type=checkbox]')
        assert checks.count()==2
        assert checks.nth(0).is_disabled()
        assert checks.nth(1).is_enabled()
        checks.nth(1).check()
        page.get_by_role('button',name=re.compile('\u8acb\u6c42\u66f8\u307e\u3068\u3081\u767a\u884c')).click()
        assert page.get_by_text('2,160\u5186',exact=True).count()>=2
        page.get_by_role('button',name='\u30ad\u30e3\u30f3\u30bb\u30eb',exact=True).last.click()
        page.set_viewport_size({'width':390,'height':844})
        page.screenshot(path=str(OUT/'history-mobile.png'),full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert page.evaluate('window.__requests.length')==0
        assert not errors,errors
        print(json.dumps({'history_ui_checks':8,'javascript_errors':errors,'production_requests':0,'mock_write_requests':0}))
    browser.close()
