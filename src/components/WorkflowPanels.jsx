import {useState, useRef} from 'react';
import {isBillable, documentStatus} from '../lib/workflow-client.js';
const labels={home:'\u4eca\u65e5\u306e\u696d\u52d9',sale:'\u8ca9\u58f2\u30fb\u66f8\u985e\u4f5c\u6210',billing:'\u672a\u8acb\u6c42\u306e\u7d0d\u54c1\u66f8',negative:'\u30de\u30a4\u30ca\u30b9\u5728\u5eab',legacy:'\u5728\u5eab\u72b6\u614b\u8981\u78ba\u8a8d',inventory:'\u5728\u5eab\u30fb\u5165\u51fa\u5eab',recent:'\u6700\u8fd1\u306e\u66f8\u985e'};
const button={padding:'10px 14px',border:'1px solid #cbd5e1',borderRadius:8,background:'#fff',cursor:'pointer',font:'inherit'};
export function HomeDashboard({history,products,onNavigate}){
 const active=history.filter(d=>!d.voidedAt&&!d.convertedTo);
 const cards=[{label:labels.billing,n:active.filter(isBillable).length,tab:'history',filter:'billable'},
  {label:labels.negative,n:products.filter(p=>Number(p.stock)<0).length,tab:'products',filter:'negative'},
  {label:labels.legacy,n:active.filter(d=>d.stockManaged==null).length,tab:'history',filter:'review'}];
 return <section style={{padding:24,overflowY:'auto',height:'100%',boxSizing:'border-box',background:'#f8fafc'}}>
  <p style={{fontSize:12,color:'#64748b',margin:'0 0 8px'}}>DAISHO / WORKSPACE</p>
  <h1 style={{fontSize:24,margin:'0 0 8px'}}>{labels.home}</h1>
  <p style={{color:'#64748b',fontSize:13}}>{'\u5bfe\u5fdc\u304c\u5fc5\u8981\u306a\u66f8\u985e\u3068\u5728\u5eab\u3092\u78ba\u8a8d\u3057\u307e\u3059\u3002'}</p>
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:14,margin:'20px 0'}}>
   {cards.map(c=><button key={c.label} style={{...button,textAlign:'left',padding:20}} onClick={()=>onNavigate(c.tab,c.filter)}>
    <span style={{display:'block',fontSize:12,color:'#64748b'}}>{c.label}</span><strong style={{display:'block',fontSize:30,marginTop:10}}>{c.n}<small style={{fontSize:12,marginLeft:8}}>{'\u4ef6'}</small></strong>
   </button>)}
  </div>
  <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:22}}>
   <button style={{...button,background:'#1a2744',color:'#fff'}} onClick={()=>onNavigate('chat')}>{labels.sale}</button>
   <button style={button} onClick={()=>onNavigate('products')}>{labels.inventory}</button>
  </div>
  <div style={{padding:14,background:'#fff7ed',borderRadius:8,fontSize:12,color:'#9a3412',marginBottom:22}}>
   {'\u65e7\u66f8\u985e\u306e\u5728\u5eab\u306f\u81ea\u52d5\u88dc\u6b63\u3057\u307e\u305b\u3093\u3002\u672a\u78ba\u8a8d\u306e\u8a18\u9332\u306f\u5165\u51fa\u5eab\u5c65\u6b74\u3068\u7167\u5408\u3057\u3066\u304f\u3060\u3055\u3044\u3002'}
  </div>
  <h3 style={{fontSize:14}}>{labels.recent}</h3>
  <div style={{background:'#fff',border:'1px solid #e2e8f0',borderRadius:10,overflow:'hidden'}}>
   {history.slice(0,8).map(d=><div key={d.id} style={{display:'flex',justifyContent:'space-between',gap:12,padding:'12px 16px',borderBottom:'1px solid #f1f5f9',fontSize:12}}><span>{d.date} / {d.customer}<br/><span style={{color:'#64748b'}}>{d.docType} {d.docNo}</span></span><span>{documentStatus(d)}</span></div>)}
   {!history.length&&<p style={{padding:16,color:'#64748b'}}>{'\u767b\u9332\u3055\u308c\u305f\u66f8\u985e\u306f\u3042\u308a\u307e\u305b\u3093\u3002'}</p>}
  </div>
 </section>;
}
export function ShipmentChoice({doc,onChange}){
 if(!['\u7d0d\u54c1\u66f8','\u8acb\u6c42\u66f8'].includes(doc.docType))return null;
 const managed=doc.stockManaged ?? doc.docType==='\u7d0d\u54c1\u66f8';
 return <div style={{padding:10,background:'#eff6ff',borderRadius:6,fontSize:12,marginBottom:12}}>
  <label><input type="checkbox" disabled={Boolean(doc.id)} checked={managed} onChange={e=>onChange(e.target.checked)}/>{'\u3053\u306e\u767b\u9332\u3068\u540c\u6642\u306b\u5b9f\u969b\u306e\u51fa\u8377\u3092\u8a18\u9332\u3059\u308b'}</label>
  <div style={{marginTop:5,color:'#475569'}}>{'\u898b\u7a4d\u66f8\u30fb\u9818\u53ce\u66f8\u30fb\u7d0d\u54c1\u66f8\u304b\u3089\u306e\u307e\u3068\u3081\u8acb\u6c42\u3067\u306f\u51fa\u5eab\u3057\u307e\u305b\u3093\u3002'}</div>
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
