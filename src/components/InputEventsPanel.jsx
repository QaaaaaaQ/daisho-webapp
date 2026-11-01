import {useEffect,useState} from 'react';
import {inputEventLabels} from '../lib/input-events.js';

export function InputEventsPanel({db}) {
  const [users,setUsers]=useState([]),[rows,setRows]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [filter,setFilter]=useState({actorId:'',docType:'',from:'',to:''});
  const load=async(f=filter)=>{setBusy(true);setError('');try{setRows(await db.listInputEvents(f));}catch(e){setError(e.message);}finally{setBusy(false);}};
  useEffect(()=>{db.listUsers().then(setUsers).catch(e=>setError(e.message));void load();},[]);
  const field={padding:8,border:'1px solid #cbd5e1',borderRadius:6};
  return <section style={{padding:16,margin:14,border:'1px solid #e5e7eb',borderRadius:9,background:'#fff'}}>
    <h3>入力・エラー記録</h3><p>保存と保存時の確認エラーを記録します。入力内容そのものは保存しません。最新200件を表示します。</p>
    <form onSubmit={e=>{e.preventDefault();void load();}} style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      <select aria-label="担当者" style={field} value={filter.actorId} onChange={e=>setFilter({...filter,actorId:e.target.value})}><option value="">全担当者</option>{users.map(u=><option key={u.user_id} value={u.user_id}>{u.email}</option>)}</select>
      <select aria-label="書類種別" style={field} value={filter.docType} onChange={e=>setFilter({...filter,docType:e.target.value})}><option value="">全書類</option>{['請求書','領収書','納品書','見積書','不明'].map(t=><option key={t}>{t}</option>)}</select>
      <input aria-label="開始日" type="date" style={field} value={filter.from} onChange={e=>setFilter({...filter,from:e.target.value})}/><input aria-label="終了日" type="date" style={field} value={filter.to} onChange={e=>setFilter({...filter,to:e.target.value})}/><button disabled={busy}>検索</button>
    </form>
    {error&&<p role="alert">{error}</p>}{!busy&&!rows.length&&!error&&<p>記録はありません。</p>}
    <div style={{overflowX:'auto'}}><table style={{width:'100%',fontSize:12,textAlign:'left',marginTop:12}}><thead><tr>{['日時','担当者','書類','結果','理由','項目','書類番号'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{new Date(r.created_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}</td><td>{r.actor_email}</td><td>{r.doc_type}</td><td>{r.event_type==='saved'?'保存':'エラー'}</td><td>{inputEventLabels[r.issue_code]||r.issue_code}</td><td>{r.field_name}</td><td>{r.doc_no||'—'}</td></tr>)}</tbody></table></div>
  </section>;
}
