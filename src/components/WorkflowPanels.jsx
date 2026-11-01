import './home-dashboard.css';
import {useState, useRef} from 'react';
import {isBillable, documentStatus} from '../lib/workflow-client.js';
const labels={home:'\u4eca\u65e5\u306e\u696d\u52d9',sale:'\u8ca9\u58f2\u30fb\u66f8\u985e\u4f5c\u6210',billing:'\u672a\u8acb\u6c42\u306e\u7d0d\u54c1\u66f8',negative:'\u30de\u30a4\u30ca\u30b9\u5728\u5eab',legacy:'\u5728\u5eab\u72b6\u614b\u8981\u78ba\u8a8d',inventory:'\u5728\u5eab\u30fb\u5165\u51fa\u5eab',recent:'\u6700\u8fd1\u306e\u66f8\u985e'};
const button={padding:'10px 14px',border:'1px solid #cbd5e1',borderRadius:8,background:'#fff',cursor:'pointer',font:'inherit'};
export function HomeDashboard({history = [],products = [],onNavigate}) {
 const active=history.filter(d=>!d.voidedAt&&!d.convertedTo);
 const cards=[
  {label:labels.billing,n:active.filter(isBillable).length,tab:'history',filter:'billable',index:'01',caption:'請求待ちの納品書',tone:'ink'},
  {label:labels.negative,n:products.filter(p=>Number(p.stock)<0).length,tab:'products',filter:'negative',index:'02',caption:'残数を確認する商品',tone:'clay'},
  {label:labels.legacy,n:active.filter(d=>d.stockManaged==null).length,tab:'history',filter:'review',index:'03',caption:'過去の入出庫を確認',tone:'sage'},
 ];
 const today=new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'short'}).format(new Date());
 return <section className="home-dashboard" aria-label="今日の業務">
  <div className="home-wrap">
   <header className="home-top"><div className="home-brand"><span className="home-brand-mark" aria-hidden="true">大</span><span>神戸大商 <i /> <small>WORKSPACE</small></span></div><div className="home-date"><span className="home-live" /> {today}</div></header>
   <div className="home-intro"><div><p className="home-eyebrow"><span>01</span> DAILY OVERVIEW</p><h1>今日の業務を、<br/><em>ひと目で。</em></h1><p className="home-description">書類と在庫の状況を確認して、<br className="home-mobile-break"/>次の作業へ進みましょう。</p></div><div className="home-intro-art" aria-hidden="true"><span className="home-art-ring home-art-ring-one"/><span className="home-art-ring home-art-ring-two"/><span className="home-art-label">KOBE<br/>DAISHO <b>↗</b></span></div></div>
   <div className="home-section-heading"><div><span className="home-section-number">01 /</span><h2>確認すること</h2></div><span className="home-section-sub">YOUR PRIORITIES</span></div>
   <div className="home-cards">{cards.map(c=><button key={c.index} className={'home-card home-card--'+c.tone} onClick={()=>onNavigate(c.tab,c.filter)}><span className="home-card-top"><span>{c.index} / CHECK</span><span className="home-card-arrow" aria-hidden="true">↗</span></span><span className="home-card-label">{c.label}</span><span className="home-card-bottom"><span className="home-card-count">{String(c.n).padStart(2,'0')}<small>件</small></span><span className="home-card-caption">{c.caption}</span></span></button>)}</div>
   <div className="home-lower"><div className="home-recent"><div className="home-section-heading home-section-heading--recent"><div><span className="home-section-number">02 /</span><h2>{labels.recent}</h2></div><button className="home-link" onClick={()=>onNavigate('history')}>履歴をすべて見る <span aria-hidden="true">↗</span></button></div>
    <div className="home-list">{history.slice(0,8).map(d=><div key={d.id} className="home-record"><div className="home-record-icon" aria-hidden="true">{d.docType==='請求書'?'請':d.docType==='領収書'?'領':d.docType==='見積書'?'見':'納'}</div><div className="home-record-main"><strong>{d.customer||'取引先未設定'}</strong><span>{d.docType} <i>·</i> {d.docNo}</span></div><div className="home-record-side"><time>{d.date}</time><span>{documentStatus(d)}</span></div></div>)}{!history.length&&<p className="home-empty">まだ書類はありません。<br/>書類を作成すると、ここに表示されます。</p>}</div>
   </div><aside className="home-aside"><div className="home-section-heading home-section-heading--aside"><div><span className="home-section-number">03 /</span><h2>クイック操作</h2></div></div><p className="home-aside-copy">いつもの作業を、<br/>ここから。</p><button className="home-action home-action--primary" onClick={()=>onNavigate('chat')}><span><small>CREATE DOCUMENT</small>{labels.sale}</span><b aria-hidden="true">↗</b></button><button className="home-action" onClick={()=>onNavigate('products')}><span><small>INVENTORY</small>{labels.inventory}</span><b aria-hidden="true">↗</b></button><div className="home-note"><span aria-hidden="true">i</span><p>旧書類の在庫は自動補正されません。未確認の記録は入出庫履歴と照合してください。</p></div></aside></div>
   <footer className="home-footer"><span>DAISHO WORKSPACE</span><span>日々の仕事を、確かに。</span><span>神戸大商</span></footer>
  </div>
 </section>;
}
export function ShipmentChoice({doc,onChange,onModeChange}){
 if(!['\u7d0d\u54c1\u66f8','\u8acb\u6c42\u66f8'].includes(doc.docType))return null;
 const managed=doc.stockManaged ?? doc.docType==='\u7d0d\u54c1\u66f8';
 const mode=doc.inventoryMode || (managed?'ship':'none');
 return <div style={{padding:10,background:'#eff6ff',borderRadius:6,fontSize:12,marginBottom:12}}>
  <label style={{display:'block'}}><input type="radio" name="inventory-mode" disabled={Boolean(doc.id)} checked={mode==='ship'&&managed} onChange={()=>{onChange(true);onModeChange?.('ship');}}/>{'\u3053\u306e\u767b\u9332\u3068\u540c\u6642\u306b\u51fa\u5eab\u3092\u53cd\u6620\u3059\u308b'}</label>
  {doc.docType==='\u7d0d\u54c1\u66f8'&&<label style={{display:'block',marginTop:5}}><input type="radio" name="inventory-mode" disabled={Boolean(doc.id)} checked={mode==='reserve'} onChange={()=>{onChange(false);onModeChange?.('reserve');}}/>{'\u53d7\u6ce8\u78ba\u5b9a\u3067\u5728\u5eab\u4e88\u7d04\u3057\u3001\u5f8c\u65e5\u51fa\u8377\u3059\u308b'}</label>}
  <label style={{display:'block',marginTop:5}}><input type="radio" name="inventory-mode" disabled={Boolean(doc.id)} checked={mode==='none'&&!managed} onChange={()=>{onChange(false);onModeChange?.('none');}}/>{'\u5728\u5eab\u3092\u52d5\u304b\u3055\u306a\u3044'}</label>
  <div style={{marginTop:5,color:'#475569'}}>{'\u4e88\u7d04\u51e6\u7406\u306f\u5009\u5eab\u3068\u30ed\u30c3\u30c8\u306e\u5b9f\u5728\u5eab\u3092\u78ba\u8a8d\u3057\u307e\u3059\u3002\u898b\u7a4d\u66f8\u3084\u307e\u3068\u3081\u8acb\u6c42\u306f\u5728\u5eab\u3092\u52d5\u304b\u3057\u307e\u305b\u3093\u3002'}</div>
 </div>;
}
export function VoidDocumentModal({doc,onClose,onSubmit}){
 const [reason,setReason]=useState(''),[reverse,setReverse]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lock=useRef(false);
 const submit=async()=>{
  if(lock.current||!reason.trim())return;lock.current=true;setBusy(true);setError('');
  try{await onSubmit(reason.trim(),reverse);onClose();}catch(e){setError(e.message);}finally{lock.current=false;setBusy(false);}
 };
 return <div role="dialog" aria-modal="true" aria-label="\u66f8\u985e\u53d6\u6d88" style={{position:'fixed',inset:0,zIndex:400,background:'#0008',display:'grid',placeItems:'center',padding:20}}>
  <div style={{maxWidth:520,width:'100%',padding:24,background:'#fff',borderRadius:12,boxSizing:'border-box'}}>
   <h3 style={{marginTop:0}}>{'\u66f8\u985e\u306e\u53d6\u6d88'} / {doc.docNo}</h3>
   <p style={{fontSize:13,color:'#475569'}}>{'\u66f8\u985e\u3068\u64cd\u4f5c\u5c65\u6b74\u3092\u6b8b\u3057\u307e\u3059\u3002\u901a\u5e38\u306e\u53d6\u6d88\u3067\u306f\u5728\u5eab\u306f\u623b\u308a\u307e\u305b\u3093\u3002'}</p>
   <label style={{display:'block',fontSize:12}}>{'\u53d6\u6d88\u7406\u7531\uff08\u5fc5\u9808\uff09'}<textarea autoFocus rows={3} value={reason} onChange={e=>setReason(e.target.value)} style={{width:'100%',boxSizing:'border-box',marginTop:6,padding:8}}/></label>
   {doc.stockManaged===true&&!doc.sourceIds?.length&&<label style={{display:'block',margin:'16px 0',fontSize:12}}><input type="checkbox" checked={reverse} onChange={e=>setReverse(e.target.checked)}/>{'\u672a\u51fa\u8377\u306e\u8aa4\u767b\u9332\u306e\u305f\u3081\u3001\u8a18\u9332\u6e08\u307f\u306e\u51fa\u5eab\u3092\u623b\u3059\uff08\u5b9f\u969b\u306e\u8fd4\u54c1\u306f\u5225\u9014\u5165\u5eab\uff09'}</label>}
   {error&&<p role="alert" style={{color:'#b91c1c',fontSize:12}}>{error}</p>}
   <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:16}}><button style={button} disabled={busy} onClick={onClose}>{'\u3084\u3081\u308b'}</button><button style={{...button,background:'#b91c1c',color:'#fff'}} disabled={busy||!reason.trim()} onClick={submit}>{busy?'\u51e6\u7406\u4e2d...':'\u53d6\u6d88\u3092\u78ba\u5b9a'}</button></div>
  </div>
 </div>;
}
