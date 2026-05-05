import { useState, useEffect, useRef } from "react";
import { supabase, db, aiParse, aiChat, signInWithGoogle, signOut } from "./lib/supabase";
import { openPDF, calcTax } from "./lib/pdf";

// ── Helpers ─────────────────────────────────────────────────
const tod = () => new Date().toISOString().slice(0, 10);
const fm = (n) => Number(n || 0).toLocaleString("ja-JP");
const fd = (d) => { if (!d) return ""; try { const t = new Date(d); return isNaN(t) ? String(d) : `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`; } catch { return String(d); } };
const tid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const newDocNo = (t) => `${t==="請求書"?"INV":t==="領収書"?"REC":"DEL"}-${String(Date.now()).slice(-10).padStart(10,"0")}`;
const DOC_KW = ["納品書","請求書","領収書"];
const isDocReq = (t) => DOC_KW.some((k) => t.includes(k)) && (t.match(/[×x＊]/) || t.match(/\d+円/) || t.match(/\d+kg/i) || t.match(/[1-9]\d*\s*[枚本個パック袋箱ケース]/));

const DEFAULT_CO = { name:"株式会社 神戸大商", manager:"経理担当　秦", addr:"〒532-0011 大阪市淀川区西中島４丁目７番１８号", tel:"TEL:06-6379-3451", fax:"FAX:06-6379-3461", regNo:"T4120001218286", bankA:"りそな銀行　新大阪駅前支店　普通0436583", bankB:"三井住友銀行　神戸営業部　普通預金1663502" };

// ── Shared UI ────────────────────────────────────────────────
const N = "#1a2744";
const INP = { width:"100%", padding:"8px 10px", border:"1px solid #d1d5db", borderRadius:6, fontSize:13, fontFamily:"inherit", background:"#fff", color:"#111", outline:"none" };

function Btn({ children, onClick, variant="ghost", disabled, style={}, small }) {
  const V = { primary:{background:N,color:"#fff",border:"none"}, blue:{background:"#2563eb",color:"#fff",border:"none"}, red:{background:"#dc2626",color:"#fff",border:"none"}, green:{background:"#16a34a",color:"#fff",border:"none"}, ghost:{background:"#f3f4f6",color:"#111",border:"1px solid #e5e7eb"} };
  return <button onClick={onClick} disabled={disabled} style={{ padding:small?"5px 10px":"8px 14px", borderRadius:6, cursor:disabled?"not-allowed":"pointer", fontSize:small?12:13, fontFamily:"inherit", opacity:disabled?0.5:1, ...V[variant], ...style }}>{children}</button>;
}
function Field({ label, children, note }) {
  return <div style={{ marginBottom:12 }}><label style={{ display:"block", fontSize:12, color:"#6b7280", marginBottom:5, fontWeight:500 }}>{label}</label>{children}{note&&<div style={{ fontSize:11, color:"#9ca3af", marginTop:3 }}>{note}</div>}</div>;
}
function Modal({ title, onClose, children, maxW=540, tall }) {
  return <div onClick={(e) => e.target===e.currentTarget && onClose()} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300, padding:12 }}>
    <div style={{ background:"#fff", borderRadius:12, width:"100%", maxWidth:maxW, maxHeight:tall?"95vh":"88vh", overflow:"auto", boxShadow:"0 20px 60px rgba(0,0,0,0.3)" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"13px 18px", borderBottom:"1px solid #f0f0f0", position:"sticky", top:0, background:"#fff", zIndex:1 }}>
        <span style={{ fontWeight:600, fontSize:15 }}>{title}</span>
        <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", fontSize:22, color:"#9ca3af", lineHeight:1 }}>×</button>
      </div>
      <div style={{ padding:18 }}>{children}</div>
    </div>
  </div>;
}

// ── Document Card ─────────────────────────────────────────────
function DocCard({ doc, co, onEdit, onPrint, onSave, saved }) {
  const tx = calcTax(doc.items || []);
  const tc = doc.docType==="請求書"?"#1d4ed8":doc.docType==="領収書"?"#7c3aed":"#047857";
  return <div style={{ background:"#fff", border:"1.5px solid #e5e7eb", borderRadius:10, overflow:"hidden", marginTop:8, maxWidth:440, boxShadow:"0 2px 8px rgba(0,0,0,0.08)" }}>
    <div style={{ background:N, padding:"10px 14px", display:"flex", alignItems:"center", gap:10 }}>
      <span style={{ background:tc, color:"#fff", fontSize:11, padding:"2px 8px", borderRadius:4, fontWeight:500 }}>{doc.docType}</span>
      <span style={{ color:"#fff", fontWeight:500, fontSize:14 }}>{doc.customer}</span>
      <span style={{ color:"rgba(255,255,255,0.6)", fontSize:12, marginLeft:"auto" }}>{doc.date}</span>
    </div>
    <div style={{ padding:"10px 14px" }}>
      {doc.subject && <div style={{ fontSize:12, color:"#6b7280", marginBottom:6 }}>件名: {doc.subject}</div>}
      {(doc.items||[]).slice(0,4).map((it,i) => <div key={i} style={{ display:"flex", justifyContent:"space-between", fontSize:13, padding:"3px 0", borderBottom:"1px solid #f3f4f6" }}>
        <span>{it.name}{it.reduced!==false?" ※":""} × {it.qty}{it.unit}</span>
        <span style={{ fontWeight:500 }}>{fm(it.amount)}円</span>
      </div>)}
      {(doc.items||[]).length>4 && <div style={{ fontSize:12, color:"#9ca3af", padding:"3px 0" }}>...他 {doc.items.length-4}品目</div>}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:8, paddingTop:8, borderTop:"1px solid #f3f4f6" }}>
        <div>
          <div style={{ fontSize:11, color:"#6b7280" }}>小計 {fm(tx.sub)}円 / 消費税 {fm(tx.tax)}円</div>
          <div style={{ fontSize:16, fontWeight:600, marginTop:2 }}>合計 {fm(tx.total)}円</div>
        </div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", justifyContent:"flex-end" }}>
          <Btn small onClick={onEdit}>✏️ 編集</Btn>
          <Btn small variant="primary" onClick={onPrint}>🖨 PDF</Btn>
          {!saved && <Btn small variant="green" onClick={onSave}>💾 保存</Btn>}
          {saved && <span style={{ fontSize:11, color:"#16a34a", alignSelf:"center" }}>✓ 保存済</span>}
        </div>
      </div>
    </div>
  </div>;
}

// ── Document Edit Modal ───────────────────────────────────────
function DocEditModal({ doc, onClose, onSave, co }) {
  const [d, setD] = useState({ ...doc });
  const upd = (k, v) => setD((x) => ({ ...x, [k]: v }));
  const updItem = (i, k, v) => setD((x) => ({
    ...x,
    items: x.items.map((it, j) => j!==i ? it : { ...it, [k]: v, amount: k==="qty"?Number(v)*Number(it.price):k==="price"?Number(it.qty)*Number(v):it.amount })
  }));
  const addItem = () => setD((x) => ({ ...x, items: [...(x.items||[]), { name:"", qty:1, unit:"個", price:0, amount:0, reduced:true, taxIncluded:x.items?.[0]?.taxIncluded||false }] }));
  const remItem = (i) => setD((x) => ({ ...x, items: x.items.filter((_, j) => j!==i) }));
  const tx = calcTax(d.items || []);
  return <Modal title={`${d.docType} 編集`} onClose={onClose} maxW={700} tall>
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:12 }}>
      <Field label="書類種別"><select style={INP} value={d.docType} onChange={(e) => upd("docType", e.target.value)}><option>納品書</option><option>請求書</option><option>領収書</option></select></Field>
      <Field label="日付"><input style={INP} type="date" value={d.date||""} onChange={(e) => upd("date", e.target.value)}/></Field>
      <Field label="取引先名"><input style={INP} value={d.customer||""} onChange={(e) => upd("customer", e.target.value)}/></Field>
      <Field label="件名"><input style={INP} value={d.subject||""} onChange={(e) => upd("subject", e.target.value)}/></Field>
      {d.docType==="請求書" && <>
        <Field label="支払期限"><input style={INP} type="date" value={d.dueDate||""} onChange={(e) => upd("dueDate", e.target.value)}/></Field>
        <Field label="振込先"><input style={INP} value={d.bank||co.bankA||""} onChange={(e) => upd("bank", e.target.value)}/></Field>
      </>}
    </div>
    {d.docType!=="領収書" && <>
      <div style={{ fontSize:12, fontWeight:600, color:"#374151", marginBottom:8 }}>品目</div>
      <div style={{ border:"1px solid #e5e7eb", borderRadius:8, overflow:"hidden", marginBottom:12 }}>
        <div style={{ display:"grid", gridTemplateColumns:"2fr 0.6fr 0.7fr 0.9fr 0.9fr auto", background:N, padding:"7px 10px" }}>
          {["品名","数量","単位","単価","金額",""].map((h,i) => <span key={i} style={{ color:"rgba(255,255,255,0.75)", fontSize:11 }}>{h}</span>)}
        </div>
        {(d.items||[]).map((it, i) => <div key={i} style={{ display:"grid", gridTemplateColumns:"2fr 0.6fr 0.7fr 0.9fr 0.9fr auto", gap:4, padding:"6px 8px", borderBottom:"1px solid #f3f4f6", alignItems:"center" }}>
          <input style={{ ...INP, padding:"5px 7px", fontSize:12 }} value={it.name||""} onChange={(e) => updItem(i,"name",e.target.value)}/>
          <input style={{ ...INP, padding:"5px 7px", fontSize:12 }} type="number" value={it.qty||""} onChange={(e) => updItem(i,"qty",e.target.value)}/>
          <input style={{ ...INP, padding:"5px 7px", fontSize:12 }} value={it.unit||""} onChange={(e) => updItem(i,"unit",e.target.value)}/>
          <input style={{ ...INP, padding:"5px 7px", fontSize:12 }} type="number" value={it.price||""} onChange={(e) => updItem(i,"price",e.target.value)}/>
          <input style={{ ...INP, padding:"5px 7px", fontSize:12 }} type="number" value={it.amount||""} onChange={(e) => updItem(i,"amount",e.target.value)}/>
          <button onClick={() => remItem(i)} style={{ background:"none", border:"none", cursor:"pointer", color:"#9ca3af", fontSize:16, padding:"0 4px" }}>×</button>
        </div>)}
        <div style={{ padding:"8px" }}><Btn small onClick={addItem}>＋ 品目追加</Btn></div>
      </div>
      <div style={{ textAlign:"right", fontSize:12, color:"#6b7280", marginBottom:12 }}>
        小計 {fm(tx.sub)}円 ／ 消費税 {fm(tx.tax)}円 ／ <strong>合計（税込） {fm(tx.total)}円</strong>
      </div>
    </>}
    {d.docType==="領収書" && <>
      <Field label="金額（税込・円）"><input style={INP} type="number" value={d.amount||""} onChange={(e) => upd("amount", e.target.value)}/></Field>
      <Field label="但し書き"><input style={INP} value={d.description||"商品代として"} onChange={(e) => upd("description", e.target.value)}/></Field>
    </>}
    <Field label="備考"><input style={INP} value={d.note||""} onChange={(e) => upd("note", e.target.value)} placeholder="任意"/></Field>
    <div style={{ display:"flex", gap:8, marginTop:16 }}>
      <Btn onClick={onClose} style={{ flex:1 }}>キャンセル</Btn>
      <Btn variant="primary" onClick={() => onSave(d)} style={{ flex:1 }}>✅ 保存して閉じる</Btn>
    </div>
  </Modal>;
}

// ── Chat View ─────────────────────────────────────────────────
function ChatView({ co, history, setHistory, user }) {
  const [msgs, setMsgs] = useState([{
    role:"assistant",
    text:`こんにちは、${user?.user_metadata?.full_name?.split(" ")[0] || ""}さん！\n自然な言葉で書類を作成できます。\n\n例：「5/5 平家茶屋 真河豚ドレス30×1,700円 税込 納品書お願いします」`
  }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [docStates, setDocStates] = useState({});
  const [editTarget, setEditTarget] = useState(null);
  const bottomRef = useRef(null);

  const SUGG = ["5/5 平家茶屋 真河豚ドレス30×1,700円 税込 納品書", "4月分 TEN&A さざえ請求書", "藤屋 まふぐ刺身6パック×6,600円 納品書"];

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs, loading]);

  const send = async (text) => {
    if (!text.trim() || loading) return;
    const userMsg = { id:tid(), role:"user", text:text.trim() };
    setMsgs((m) => [...m, userMsg]);
    setInput("");
    setLoading(true);
    try {
      if (isDocReq(text)) {
        const parsed = await aiParse(text, co);
        parsed.docNo = newDocNo(parsed.docType || "納品書");
        const msgId = tid();
        setMsgs((m) => [...m, { id:msgId, role:"assistant", text:`**${parsed.docType||"納品書"}**を作成しました。内容をご確認ください。`, doc:parsed }]);
        setDocStates((s) => ({ ...s, [msgId]:{ doc:parsed, saved:false } }));
      } else {
        const apiMsgs = msgs.filter((m) => m.role==="user"||m.role==="assistant").slice(-8).map((m) => ({ role:m.role, content:m.text }));
        apiMsgs.push({ role:"user", content:text });
        const reply = await aiChat(apiMsgs, co);
        setMsgs((m) => [...m, { id:tid(), role:"assistant", text:reply }]);
      }
    } catch (e) {
      setMsgs((m) => [...m, { id:tid(), role:"assistant", text:`エラーが発生しました。\n${e.message}` }]);
    }
    setLoading(false);
  };

  const saveDoc = async (msgId, doc) => {
    try {
      const saved = await db.saveDocument(doc, user);
      setHistory((h) => [saved, ...h]);
      setDocStates((s) => ({ ...s, [msgId]:{ ...s[msgId], saved:true } }));
    } catch (e) { alert("保存エラー: " + e.message); }
  };

  const handleEditSave = (newDoc) => {
    setDocStates((s) => ({ ...s, [editTarget.msgId]:{ ...s[editTarget.msgId], doc:newDoc, saved:false } }));
    setMsgs((m) => m.map((msg) => msg.id===editTarget.msgId ? { ...msg, doc:newDoc } : msg));
    setEditTarget(null);
  };

  return <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
    <div style={{ flex:1, overflowY:"auto", padding:"16px 20px", display:"flex", flexDirection:"column", gap:12 }}>
      {msgs.map((msg, i) => {
        const isUser = msg.role==="user";
        const ds = msg.id ? docStates[msg.id] : null;
        const curDoc = ds?.doc || msg.doc;
        return <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:isUser?"flex-end":"flex-start" }}>
          <div style={{ maxWidth:"78%", background:isUser?N:"#f3f4f6", color:isUser?"#fff":"#111", borderRadius:isUser?"12px 12px 3px 12px":"12px 12px 12px 3px", padding:"10px 14px", fontSize:13, lineHeight:1.6, whiteSpace:"pre-wrap" }}>
            {msg.text}
          </div>
          {curDoc && <DocCard doc={curDoc} co={co}
            onEdit={() => setEditTarget({ msgId:msg.id, doc:curDoc })}
            onPrint={() => openPDF(curDoc, co)}
            onSave={() => saveDoc(msg.id, curDoc)}
            saved={ds?.saved||false}
          />}
        </div>;
      })}
      {loading && <div style={{ display:"flex" }}>
        <div style={{ background:"#f3f4f6", borderRadius:"12px 12px 12px 3px", padding:"10px 14px" }}>
          <span style={{ display:"inline-flex", gap:4 }}>
            {[0,1,2].map((i) => <span key={i} style={{ width:6, height:6, borderRadius:"50%", background:"#9ca3af", display:"inline-block", animation:"blink 1.2s infinite", animationDelay:`${i*0.2}s` }}/>)}
          </span>
        </div>
      </div>}
      <div ref={bottomRef}/>
    </div>
    {msgs.length<=1 && <div style={{ padding:"0 20px 8px", display:"flex", gap:6, flexWrap:"wrap" }}>
      {SUGG.map((s, i) => <button key={i} onClick={() => send(s)} style={{ padding:"6px 12px", background:"#f3f4f6", border:"1px solid #e5e7eb", borderRadius:20, fontSize:12, cursor:"pointer", color:"#374151", fontFamily:"inherit" }}>{s}</button>)}
    </div>}
    <div style={{ padding:"12px 20px", borderTop:"1px solid #f0f0f0", background:"#fff" }}>
      <div style={{ display:"flex", gap:8, alignItems:"flex-end" }}>
        <textarea value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key==="Enter"&&!e.shiftKey) { e.preventDefault(); send(input); } }}
          placeholder="例：5/5 平家茶屋 真河豚ドレス30×1,700円 税込 納品書　（Shift+Enterで改行）"
          style={{ flex:1, padding:"10px 12px", border:"1px solid #e5e7eb", borderRadius:8, fontSize:13, fontFamily:"inherit", background:"#fff", color:"#111", outline:"none", resize:"none", minHeight:44, maxHeight:120, lineHeight:1.5 }}
          rows={1} onInput={(e) => { e.target.style.height="auto"; e.target.style.height=Math.min(e.target.scrollHeight,120)+"px"; }}
        />
        <button onClick={() => send(input)} disabled={!input.trim()||loading}
          style={{ padding:"10px 16px", background:N, color:"#fff", border:"none", borderRadius:8, cursor:loading?"not-allowed":"pointer", fontSize:13, fontFamily:"inherit", height:44, whiteSpace:"nowrap", opacity:(!input.trim()||loading)?0.5:1 }}>
          送信 ↑
        </button>
      </div>
    </div>
    {editTarget && <DocEditModal doc={editTarget.doc} co={co} onClose={() => setEditTarget(null)} onSave={handleEditSave}/>}
    <style>{`@keyframes blink{0%,80%,100%{opacity:0}40%{opacity:1}}`}</style>
  </div>;
}

// ── History View ──────────────────────────────────────────────
function HistoryView({ history, setHistory, co }) {
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState("");
  const [editTarget, setEditTarget] = useState(null);
  const filt = (history||[]).filter((h) => !q || h.customer?.includes(q) || h.docType?.includes(q) || h.docNo?.includes(q));
  const tc = (t) => t==="請求書"?"#1d4ed8":t==="領収書"?"#7c3aed":"#047857";
  return <div style={{ height:"100%", display:"flex", flexDirection:"column" }}>
    <div style={{ padding:"14px 20px", borderBottom:"1px solid #f0f0f0", display:"flex", gap:10 }}>
      <input style={{ ...INP, flex:1 }} placeholder="取引先・書類番号で検索..." value={q} onChange={(e) => setQ(e.target.value)}/>
      <span style={{ fontSize:12, color:"#9ca3af", alignSelf:"center", whiteSpace:"nowrap" }}>{filt.length}件</span>
    </div>
    <div style={{ flex:1, overflowY:"auto" }}>
      {filt.length===0 && <div style={{ textAlign:"center", padding:48, color:"#9ca3af" }}>書類がありません</div>}
      {filt.map((h) => {
        const tx = calcTax(h.items||[]);
        return <div key={h.id} onClick={() => setSel(h)} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 20px", borderBottom:"1px solid #f9f9f9", cursor:"pointer", background:sel?.id===h.id?"#f9fafb":"transparent" }}>
          <span style={{ background:tc(h.docType), color:"#fff", fontSize:11, padding:"2px 7px", borderRadius:4, whiteSpace:"nowrap" }}>{h.docType}</span>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:500, fontSize:14 }}>{h.customer}</div>
            <div style={{ fontSize:12, color:"#9ca3af" }}>{h.docNo} • {h.date}</div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontWeight:500 }}>{fm(h.docType==="領収書"?h.amount:tx.total)}円</div>
            <div style={{ fontSize:11, color:"#9ca3af" }}>{h.savedBy}</div>
          </div>
        </div>;
      })}
    </div>
    {sel && <Modal title={`${sel.docType} - ${sel.customer}`} onClose={() => setSel(null)}>
      {[["書類番号",sel.docNo],["日付",sel.date],["作成者",sel.savedBy]].map(([l,v]) => v?<div key={l} style={{ display:"flex", gap:8, padding:"5px 0", borderBottom:"1px solid #f3f4f6", fontSize:13 }}><span style={{ color:"#6b7280", minWidth:80 }}>{l}</span><span>{v}</span></div>:null)}
      {(sel.items||[]).map((it, i) => <div key={i} style={{ display:"flex", justifyContent:"space-between", fontSize:13, padding:"5px 0", borderBottom:"1px solid #f3f4f6" }}>
        <span>{it.name} × {it.qty}{it.unit}</span><span style={{ fontWeight:500 }}>{fm(it.amount)}円</span>
      </div>)}
      {(sel.items||[]).length>0 && (() => { const tx=calcTax(sel.items); return <div style={{ textAlign:"right", marginTop:8, fontSize:13 }}><div style={{ color:"#6b7280" }}>消費税: {fm(tx.tax)}円</div><div style={{ fontWeight:600, fontSize:15 }}>合計: {fm(tx.total)}円</div></div>; })()}
      <div style={{ display:"flex", gap:8, marginTop:16 }}>
        <Btn variant="red" onClick={async()=>{ if(!confirm("削除しますか？"))return; await db.deleteDocument(sel.id); setHistory((h)=>h.filter((x)=>x.id!==sel.id)); setSel(null); }}>🗑 削除</Btn>
        <Btn onClick={() => { setEditTarget(sel); setSel(null); }}>✏️ 編集</Btn>
        <Btn variant="primary" onClick={() => openPDF(sel, co)} style={{ flex:1 }}>🖨 PDF再発行</Btn>
      </div>
    </Modal>}
    {editTarget && <DocEditModal doc={editTarget} co={co} onClose={() => setEditTarget(null)} onSave={async(nd) => {
      const updated = await db.updateDocument(editTarget.id, nd);
      setHistory((h) => h.map((x) => x.id===editTarget.id ? updated : x));
      setEditTarget(null);
    }}/>}
  </div>;
}

// ── Settings View ─────────────────────────────────────────────
function SealUploader({ label, value, onChange }) {
  const ref = useRef(null);
  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert("2MB以下の画像を選択してください"); return; }
    const reader = new FileReader();
    reader.onload = (ev) => onChange(ev.target.result);
    reader.readAsDataURL(file);
  };
  return <div style={{ marginBottom:16 }}>
    <label style={{ display:"block", fontSize:12, color:"#6b7280", marginBottom:8, fontWeight:500 }}>{label}</label>
    <div style={{ display:"flex", alignItems:"center", gap:14 }}>
      <div style={{ width:72, height:72, border:"1px dashed #d1d5db", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", background:"#f9fafb", flexShrink:0, overflow:"hidden" }}>
        {value
          ? <img src={value} style={{ width:"100%", height:"100%", objectFit:"contain" }} alt="印鑑"/>
          : <span style={{ fontSize:11, color:"#9ca3af", textAlign:"center", lineHeight:1.4 }}>未設定</span>}
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        <input ref={ref} type="file" accept="image/png,image/jpeg,image/gif" style={{ display:"none" }} onChange={handleFile}/>
        <Btn small onClick={() => ref.current?.click()}>📁 画像を選択</Btn>
        {value && <Btn small variant="red" onClick={() => onChange("")}>削除</Btn>}
        <div style={{ fontSize:11, color:"#9ca3af" }}>PNG推奨 / 2MB以下<br/>背景透過PNGが綺麗です</div>
      </div>
    </div>
  </div>;
}

function SettingsView({ co, setCo }) {
  const [c, setC] = useState({ ...co });
  const save = async () => { await db.saveCompany(c); setCo(c); alert("保存しました"); };
  const f = (label, key, placeholder) => <Field label={label}><input style={INP} value={c[key]||""} onChange={(e) => setC((x) => ({ ...x, [key]:e.target.value }))} placeholder={placeholder}/></Field>;
  return <div style={{ padding:24, maxWidth:560, overflowY:"auto", height:"100%" }}>
    <div style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:10, padding:20, marginBottom:16 }}>
      <div style={{ fontWeight:600, fontSize:15, marginBottom:16, paddingBottom:10, borderBottom:"1px solid #f0f0f0" }}>🏢 自社情報（書類に印刷されます）</div>
      {f("会社名","name","株式会社 神戸大商")}
      {f("担当者名","manager","経理担当　秦")}
      {f("住所","addr","〒532-0011 大阪市淀川区...")}
      {f("TEL","tel","TEL:06-6379-3451")}
      {f("FAX","fax","FAX:06-6379-3461")}
      {f("適格請求書登録番号","regNo","T4120001218286")}
      {f("振込先A（主）","bankA","りそな銀行 新大阪駅前支店 普通0436583")}
      {f("振込先B（副）","bankB","三井住友銀行 神戸営業部 普通預金1663502")}
      <Btn variant="primary" onClick={save}>保存</Btn>
    </div>
    <div style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:10, padding:20 }}>
      <div style={{ fontWeight:600, fontSize:15, marginBottom:4, paddingBottom:10, borderBottom:"1px solid #f0f0f0" }}>🔴 印鑑設定（PDFに自動印刷）</div>
      <div style={{ fontSize:12, color:"#6b7280", marginBottom:16, paddingTop:8 }}>
        設定した印鑑画像は納品書・請求書・領収書のPDFに自動で入ります。
      </div>
      <SealUploader label="社印（丸印・角印）" value={c.sealImg||""} onChange={(v) => setC((x) => ({ ...x, sealImg:v }))}/>
      <SealUploader label="担当者印（個人印・担当印）" value={c.personSealImg||""} onChange={(v) => setC((x) => ({ ...x, personSealImg:v }))}/>
      <div style={{ background:"#fef9ec", border:"1px solid #fcd34d", borderRadius:8, padding:"10px 14px", fontSize:12, color:"#92400e", marginBottom:16 }}>
        ⚠️ 印鑑画像はSupabaseのDBに保存されます。社内限定のアクセスのみ可能です。
      </div>
      <Btn variant="primary" onClick={save}>印鑑を保存</Btn>
    </div>
  </div>;
}

// ── Login Screen ──────────────────────────────────────────────
function LoginScreen({ onSignIn }) {
  const [loading, setLoading] = useState(false);
  return <div style={{ minHeight:"100vh", background:`linear-gradient(135deg,#0f1f44 0%,#1a3a6e 100%)`, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
    <div style={{ width:"100%", maxWidth:400, textAlign:"center" }}>
      <div style={{ border:"3px solid #2a6a2a", borderRadius:6, display:"inline-block", padding:"6px 20px", marginBottom:16 }}>
        <span style={{ fontSize:24, fontWeight:"bold", color:"#4ade80", letterSpacing:4 }}>DAISHO</span>
      </div>
      <h1 style={{ color:"#fff", fontSize:20, fontWeight:300, letterSpacing:2, marginBottom:6 }}>業務書類 AIシステム</h1>
      <p style={{ color:"rgba(255,255,255,0.4)", fontSize:13, marginBottom:32 }}>株式会社神戸大商</p>
      <div style={{ background:"rgba(255,255,255,0.06)", border:"0.5px solid rgba(255,255,255,0.15)", borderRadius:12, padding:28 }}>
        <p style={{ color:"rgba(255,255,255,0.5)", fontSize:13, marginBottom:20 }}>Google Workspaceアカウントでログインしてください</p>
        <button onClick={async () => { setLoading(true); try { await onSignIn(); } finally { setLoading(false); } }} disabled={loading}
          style={{ display:"flex", alignItems:"center", gap:12, width:"100%", padding:"13px 16px", background:"#fff", border:"none", borderRadius:8, cursor:loading?"wait":"pointer", fontSize:14, fontFamily:"inherit", fontWeight:500, justifyContent:"center", opacity:loading?0.7:1 }}>
          <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/></svg>
          {loading ? "ログイン中..." : "Googleでログイン"}
        </button>
        <p style={{ color:"rgba(255,255,255,0.25)", fontSize:11, marginTop:14 }}>Google Workspaceの組織アカウントでのみログイン可能です</p>
      </div>
    </div>
  </div>;
}

// ── Main App ──────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState([]);
  const [co, setCo] = useState(DEFAULT_CO);
  const [tab, setTab] = useState("chat");
  const [sideOpen, setSideOpen] = useState(window.innerWidth > 600);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        const [docs, company] = await Promise.all([db.getDocuments(), db.getCompany()]);
        setHistory(docs || []);
        if (company) setCo({ ...DEFAULT_CO, ...company });
      } catch (e) { console.error(e); }
    })();
  }, [session]);

  useEffect(() => {
    const h = () => setSideOpen(window.innerWidth > 600);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  if (loading) return <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", fontFamily:"sans-serif", color:"#6b7280", fontSize:14 }}>読み込み中...</div>;
  if (!session) return <LoginScreen onSignIn={signInWithGoogle}/>;

  const user = session.user;
  const name = user.user_metadata?.full_name || user.email;
  const avatar = (user.user_metadata?.avatar_url) ? <img src={user.user_metadata.avatar_url} style={{ width:30, height:30, borderRadius:"50%" }}/> : <div style={{ width:30, height:30, borderRadius:"50%", background:"rgba(37,99,235,0.5)", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:13, fontWeight:600 }}>{name.charAt(0)}</div>;

  const TABS = [["chat","💬","AI書類作成"],["history","📋","発行履歴"],["settings","⚙️","設定"]];
  const todayCount = (history||[]).filter((h) => h.savedAt?.slice(0,10)===tod()).length;

  return <div style={{ display:"flex", height:"100vh", fontFamily:'"Hiragino Sans","Yu Gothic UI","Meiryo",sans-serif', background:"#f9fafb" }}>
    <aside style={{ width:sideOpen?192:52, background:N, display:"flex", flexDirection:"column", flexShrink:0, transition:"width .2s", overflow:"hidden" }}>
      <div style={{ padding:"12px 10px", borderBottom:"0.5px solid rgba(255,255,255,0.1)", minWidth:192 }}>
        {sideOpen && <div>
          <div style={{ border:"2px solid #2a6a2a", borderRadius:4, display:"inline-block", padding:"2px 8px", marginBottom:4 }}>
            <span style={{ fontSize:13, fontWeight:"bold", color:"#4ade80", letterSpacing:2 }}>DAISHO</span>
          </div>
          <div style={{ color:"rgba(255,255,255,0.35)", fontSize:10 }}>業務書類 AIシステム</div>
        </div>}
      </div>
      {sideOpen && <div style={{ padding:"8px 10px", borderBottom:"0.5px solid rgba(255,255,255,0.1)", display:"flex", alignItems:"center", gap:8 }}>
        {avatar}
        <div style={{ overflow:"hidden" }}>
          <div style={{ color:"rgba(255,255,255,0.8)", fontSize:12, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{name}</div>
          <div style={{ color:"rgba(255,255,255,0.35)", fontSize:10, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{user.email}</div>
        </div>
      </div>}
      <nav style={{ flex:1, padding:"6px 0" }}>
        {TABS.map(([id, icon, label]) => <button key={id} onClick={() => setTab(id)} style={{ display:"flex", alignItems:"center", gap:10, width:"100%", padding:"11px 12px", border:"none", cursor:"pointer", fontSize:13, background:tab===id?"rgba(255,255,255,0.12)":"transparent", color:tab===id?"#fff":"rgba(255,255,255,0.5)", borderLeft:tab===id?"3px solid #60a5fa":"3px solid transparent", textAlign:"left", fontFamily:"inherit", position:"relative" }}>
          <span style={{ fontSize:16, flexShrink:0 }}>{icon}</span>
          {sideOpen && <span style={{ whiteSpace:"nowrap" }}>{label}</span>}
          {id==="history" && todayCount>0 && <span style={{ position:"absolute", top:8, right:8, background:"#dc2626", color:"#fff", borderRadius:10, fontSize:10, padding:"1px 5px" }}>{todayCount}</span>}
        </button>)}
      </nav>
      <div style={{ padding:10, borderTop:"0.5px solid rgba(255,255,255,0.1)" }}>
        <button onClick={() => supabase.auth.signOut()} style={{ width:"100%", padding:"7px", border:"0.5px solid rgba(255,255,255,0.15)", borderRadius:6, background:"transparent", color:"rgba(255,255,255,0.4)", cursor:"pointer", fontSize:11, fontFamily:"inherit", whiteSpace:"nowrap" }}>
          {sideOpen ? "ログアウト" : "→"}
        </button>
      </div>
    </aside>
    <main style={{ flex:1, overflow:"hidden", display:"flex", flexDirection:"column", background:"#fff" }}>
      <div style={{ padding:"11px 20px", borderBottom:"1px solid #f0f0f0", display:"flex", alignItems:"center", gap:8 }}>
        <button onClick={() => setSideOpen((x) => !x)} style={{ background:"none", border:"none", cursor:"pointer", color:"#9ca3af", fontSize:18, padding:4, flexShrink:0 }}>☰</button>
        <h2 style={{ fontSize:15, fontWeight:500 }}>
          {tab==="chat" && "💬 AI書類作成"}
          {tab==="history" && `📋 発行履歴（${(history||[]).length}件）`}
          {tab==="settings" && "⚙️ 設定"}
        </h2>
        {tab==="chat" && <span style={{ fontSize:11, color:"#9ca3af", marginLeft:"auto", background:"#f3f4f6", padding:"3px 8px", borderRadius:4 }}>軽減税率8%対応</span>}
      </div>
      <div style={{ flex:1, overflow:"hidden" }}>
        {tab==="chat" && <ChatView co={co} history={history} setHistory={setHistory} user={user}/>}
        {tab==="history" && <HistoryView history={history} setHistory={setHistory} co={co}/>}
        {tab==="settings" && <SettingsView co={co} setCo={setCo}/>}
      </div>
    </main>
  </div>;
}
