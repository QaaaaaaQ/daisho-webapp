import { useEffect, useMemo, useState } from 'react';
import { documentsToCSV } from '../lib/csv.js';

const fieldStyle={padding:'7px 9px',border:'1px solid #d1d5db',borderRadius:6,fontSize:12,fontFamily:'inherit'};
const buttonStyle={padding:'7px 11px',border:0,borderRadius:6,background:'#1a2744',color:'#fff',cursor:'pointer',fontSize:12};
const cardStyle={background:'#fff',border:'1px solid #e5e7eb',borderRadius:9,padding:16,margin:14};
function downloadCsv(name, content) { const a=document.createElement('a');const url=URL.createObjectURL(new Blob(['\uFEFF',content],{type:'text/csv;charset=utf-8'}));a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),500); }

export function OperationsView({db,products,documents,role,onDocumentsRefresh}) {
  const [inventory,setInventory]=useState({locations:[],lots:[],reservations:[]});
  const [payments,setPayments]=useState([]);
  const [users,setUsers]=useState([]);
  const [locationId,setLocationId]=useState('');const [docId,setDocId]=useState('');const [lot,setLot]=useState({});
  const [paymentId,setPaymentId]=useState('');const [invoiceId,setInvoiceId]=useState('');const [allocation,setAllocation]=useState('');
  const [newPayment,setNewPayment]=useState({date:new Date().toLocaleDateString('sv-SE'),payer:'',amount:'',reference:''});
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  const admin=role==='admin';
  const load=async()=>{try{const [i,p]=await Promise.all([db.getInventory(),db.getPayments()]);setInventory(i);setPayments(p);if(!locationId)setLocationId(i.locations[0]?.id||'');}catch(e){setMessage(e.message);}};
  useEffect(()=>{load();},[]);
  const availableDocuments=useMemo(()=>documents.filter(d=>d.docType==='納品書'&&d.inventoryMode==='reserve'&&!d.voidedAt),[documents]);
  const selectedReservations=inventory.reservations.filter(r=>r.document_id===docId);
  const hasActiveReservation=selectedReservations.some(r=>r.status==='reserved');
  const hasShippedReservation=selectedReservations.some(r=>r.status==='shipped');
  const totalAllocated=p=>Number((p.payment_allocations||[]).reduce((n,a)=>n+Number(a.amount||0),0));
  const action=async fn=>{setBusy(true);setMessage('');try{await fn();setMessage('処理が完了しました');await load();}catch(e){setMessage(e.message||'処理に失敗しました');}finally{setBusy(false);}};
  const exportPayments=()=>{const rows=[['入金日','振込人','入金額','摘要','請求書番号','取引先','割当額','未割当額']];for(const p of payments){const allocs=p.payment_allocations||[];if(!allocs.length)rows.push([p.payment_date,p.payer,p.amount,p.reference,'','','',p.amount]);for(const a of allocs)rows.push([p.payment_date,p.payer,p.amount,p.reference,a.documents?.doc_no||'',a.documents?.customer||'',a.amount,Number(p.amount)-totalAllocated(p)]);}const esc=v=>'"'+String(v??'').replaceAll('"','""')+'"';downloadCsv('入金照合一覧.csv',rows.map(r=>r.map(esc).join(',')).join('\r\n'));};
  const createLocation=()=>{const name=window.prompt('倉庫名');if(name)action(()=>db.createInventoryLocation(name));};
  const createLot=()=>action(async()=>{if(!lot.productId||!locationId)throw new Error('商品と倉庫を選択してください');await db.createInventoryLot({...lot,locationId});setLot({});});
  const setRole=async(userId,next)=>{await action(()=>db.setUserRole(userId,next));setUsers(await db.listUsers());};
  const fetchUsers=()=>action(async()=>setUsers(await db.listUsers()));
  return <div style={{height:'100%',overflowY:'auto',background:'#f9fafb',paddingBottom:20}}>
    <div style={cardStyle}>
      <h3 style={{margin:'0 0 8px',fontSize:15}}>在庫・ロット管理（箱数 + kg実重量）</h3>
      <p style={{fontSize:12,color:'#64748b'}}>確認済み納品書を予約し、出庫時に予約分を引き落とします。納品書の取消は未出庫予約だけを自動解放します。重量と箱数は独立して記録されます。</p>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
        <select style={fieldStyle} value={docId} onChange={e=>setDocId(e.target.value)}><option value="">予約出庫方式の納品書</option>{availableDocuments.map(d=><option key={d.id} value={d.id}>{d.docNo} · {d.customer}</option>)}</select>
        <select style={fieldStyle} value={locationId} onChange={e=>setLocationId(e.target.value)}>{inventory.locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select>
        <button style={buttonStyle} disabled={busy||!docId||hasActiveReservation||hasShippedReservation} onClick={()=>action(async()=>{await db.inventoryWorkflow('reserve',docId,locationId,'受注確定');await onDocumentsRefresh?.();})}>受注確定・在庫予約</button>
        <button style={buttonStyle} disabled={busy||!docId||!hasActiveReservation} onClick={()=>action(async()=>{await db.inventoryWorkflow('ship',docId,null,'出庫');await onDocumentsRefresh?.();})}>出庫・予約引落し</button>
        {admin&&<button style={{...buttonStyle,background:'#475569'}} onClick={createLocation}>倉庫追加</button>}
      </div>
      {admin&&<div style={{display:'flex',gap:7,flexWrap:'wrap',marginTop:12}}>
        <p style={{flexBasis:'100%',fontSize:11,color:'#92400e',margin:'2px 0'}}>期首ロットのkg合計は商品マスターの現在庫と一致させてください。箱数は実数を登録してください。既存在庫は自動で変更されません。</p>
        <select style={fieldStyle} value={lot.productId||''} onChange={e=>setLot(x=>({...x,productId:e.target.value}))}><option value="">商品</option>{products.filter(p=>!p.archivedAt).map(p=><option key={p.id} value={p.id}>{p.code||''} {p.name}</option>)}</select>
        <select style={fieldStyle} value={lot.event||'opening_balance'} onChange={e=>setLot(x=>({...x,event:e.target.value}))}><option value="opening_balance">既存在庫の期首ロット化</option><option value="receipt">新規入庫</option></select>
        <input style={fieldStyle} placeholder="ロット番号" value={lot.lotCode||''} onChange={e=>setLot(x=>({...x,lotCode:e.target.value}))}/>
        <input style={fieldStyle} type="date" aria-label="入庫日" value={lot.receivedOn||''} onChange={e=>setLot(x=>({...x,receivedOn:e.target.value}))}/>
        <input style={fieldStyle} type="date" aria-label="賞味期限" value={lot.expiresOn||''} onChange={e=>setLot(x=>({...x,expiresOn:e.target.value}))}/>
        <input style={fieldStyle} type="number" min="0.000001" step="0.001" placeholder="kg実重量" value={lot.kg||''} onChange={e=>setLot(x=>({...x,kg:e.target.value}))}/>
        <input style={fieldStyle} type="number" min="0" step="1" placeholder="箱数" value={lot.cases||''} onChange={e=>setLot(x=>({...x,cases:e.target.value}))}/>
        <button style={buttonStyle} disabled={busy} onClick={createLot}>ロット・初期在庫登録</button>
      </div>}
      <div style={{marginTop:12,fontSize:12}}>{inventory.lots.map(l=><div key={l.id} style={{padding:'5px 0',borderTop:'1px solid #f1f5f9'}}>{l.products?.name} · {l.inventory_locations?.name} · {l.lot_code} · {l.on_hand_cases-l.reserved_cases}箱 / {(Number(l.on_hand_kg)-Number(l.reserved_kg)).toLocaleString()}kg使用可能 {l.expires_on?`· 期限 ${l.expires_on}`:''}</div>)}</div>
      <div style={{marginTop:14}}><h4 style={{fontSize:13,margin:'0 0 6px'}}>予約・出庫状況</h4>{inventory.reservations.length?inventory.reservations.map(r=><div key={r.id} style={{padding:'5px 0',borderTop:'1px solid #f1f5f9',fontSize:11}}>{r.documents?.doc_no||'書類'} · {r.products?.name||'商品'} · {Number(r.quantity_kg).toLocaleString()}kg / {r.case_count}箱 · {{reserved:'予約中',shipped:'出庫済み',released:'解放済み'}[r.status]||r.status}</div>):<div style={{fontSize:11,color:'#64748b'}}>予約履歴はありません</div>}</div>
    </div>
    <div style={cardStyle}>
      <h3 style={{margin:'0 0 8px',fontSize:15}}>入金登録・手動照合</h3>
      <p style={{fontSize:12,color:'#64748b'}}>入金は手入力し、請求書へ手動で割り当てて照合します。PCA売上仕訳は発行履歴から請求書明細を出力してください。</p>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
        <input style={fieldStyle} type="date" aria-label="入金日" value={newPayment.date} onChange={e=>setNewPayment(x=>({...x,date:e.target.value}))}/>
        <input style={fieldStyle} placeholder="振込人" value={newPayment.payer} onChange={e=>setNewPayment(x=>({...x,payer:e.target.value}))}/>
        <input style={fieldStyle} type="number" min="1" step="1" placeholder="入金額（円）" value={newPayment.amount} onChange={e=>setNewPayment(x=>({...x,amount:e.target.value}))}/>
        <input style={fieldStyle} placeholder="摘要（任意）" value={newPayment.reference} onChange={e=>setNewPayment(x=>({...x,reference:e.target.value}))}/>
        <button style={buttonStyle} disabled={busy||!newPayment.date||!newPayment.payer||!newPayment.amount} onClick={()=>action(async()=>{await db.createManualPayment(newPayment);setNewPayment(x=>({...x,payer:'',amount:'',reference:''}));})}>入金を登録</button>
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginTop:12}}>
        <button style={{...buttonStyle,background:'#475569'}} onClick={exportPayments}>照合一覧CSVを出力</button>
        <button style={{...buttonStyle,background:'#475569'}} onClick={()=>downloadCsv('請求書明細.csv',documentsToCSV(documents.filter(d=>!d.voidedAt)))}>請求書明細CSVを出力</button>
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginTop:12}}><select style={fieldStyle} value={paymentId} onChange={e=>setPaymentId(e.target.value)}><option value="">入金を選択</option>{payments.map(p=><option key={p.id} value={p.id}>{p.payment_date} · {p.payer} · ¥{Number(p.amount).toLocaleString()}（未割当 ¥{(Number(p.amount)-totalAllocated(p)).toLocaleString()}）</option>)}</select><select style={fieldStyle} value={invoiceId} onChange={e=>setInvoiceId(e.target.value)}><option value="">請求書を選択</option>{documents.filter(d=>d.docType==='請求書'&&!d.voidedAt).map(d=><option key={d.id} value={d.id}>{d.docNo} · {d.customer} · ¥{Number(d.taxSummary?.total??d.amount??0).toLocaleString()}</option>)}</select><input style={fieldStyle} type="number" min="1" placeholder="割当額" value={allocation} onChange={e=>setAllocation(e.target.value)}/><button style={buttonStyle} disabled={busy||!paymentId||!invoiceId||!allocation} onClick={()=>action(async()=>{await db.allocatePayment(paymentId,invoiceId,allocation);setAllocation('');await load();})}>手動で割当・照合</button></div>
    </div>
    {admin&&<div style={cardStyle}><h3 style={{margin:'0 0 8px',fontSize:15}}>ユーザー権限</h3><button style={buttonStyle} onClick={fetchUsers}>ユーザー一覧</button>{users.map(u=><div key={u.user_id} style={{display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:'1px solid #f1f5f9',fontSize:12}}><span>{u.email}</span><select style={fieldStyle} value={u.role} onChange={e=>setRole(u.user_id,e.target.value)}><option value="employee">普通员工</option><option value="admin">管理员</option></select></div>)}</div>}
    {message&&<div role="status" style={{margin:'0 14px 14px',padding:10,background:'#eff6ff',color:'#1e3a8a',fontSize:12}}>{message}</div>}
  </div>;
}
