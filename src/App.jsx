import { HomeDashboard, ShipmentChoice, VoidDocumentModal } from "./components/WorkflowPanels.jsx";
import { isBillable, documentStatus } from "./lib/workflow-client.js";
import { documentTax } from "./lib/money.js";
import { useState, useEffect, useRef } from "react";
import { supabase, db, aiParse, aiChat, signInWithGoogle, autoRegisterAndStock, getStockLogs, receiveStock } from "./lib/supabase";
import { generateAndDownloadPDF, calcTax } from "./lib/pdf";
import { downloadDocumentsCSV } from "./lib/csv";
import { draftItem, localDate, validItems, validateDocument, documentTotal } from "./lib/domain";

const tod = () => localDate();
const fm = (n) => Number(n || 0).toLocaleString("ja-JP");
const fd = (d) => { if (!d) return ""; try { const t = new Date(d); return isNaN(t) ? String(d) : `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`; } catch { return String(d); } };
const totalFor = (doc) => documentTotal(doc, documentTax(doc).total);
const previewTax = items => {try{return calcTax(items);}catch(e){return {...calcTax([]),error:e.message};}};
const receiptDetailTotal = (doc) => previewTax(validItems(doc?.items)).total;
const receiptAmountMismatch = (doc) => doc?.docType === "領収書" && validItems(doc?.items).length > 0 && Number(doc?.amount || 0) > 0 && Math.abs(Number(doc.amount) - receiptDetailTotal(doc)) > 0.01;
const normalizeReceiptForSave = (doc) => {
  if (doc?.docType !== "領収書") return doc;
  const items = validItems(doc.items);
  return {
    ...doc,
    items,
    amount: Number(doc.amount || 0) > 0 ? Number(doc.amount) : calcTax(items).total,
    description: doc.description || doc.subject || "商品代として",
  };
};
const confirmReceiptAmount = (doc) => {
  if (!receiptAmountMismatch(doc)) return true;
  const detailTotal = receiptDetailTotal(doc);
  return window.confirm(`領収金額 ¥${fm(doc.amount)} と明細合計 ¥${fm(detailTotal)} が一致しません。\n手入力の領収金額を正とし、PDFでは不一致の明細を表示しません。\nこの金額で保存しますか？`);
};
const tid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,5);
const DOC_KW = ["納品書","請求書","領収書","見積書"];
const isDocReq = (t) => {
  if (!DOC_KW.some(k => t.includes(k))) return false;
  if (t.includes("見積書") || t.includes("見積り") || t.includes("見積もり")) return true;
  return !!(t.match(/作成|お願い|発行|作る|欲しい|ください/) || t.match(/[×x＊*]/) || t.match(/\d+円/) || t.match(/\d+kg/i) ||
    t.match(/[1-9]\d*\s*[枚本個パック袋箱ケース]/) || t.match(/\d+,\d+/) || t.length > 80);
};
const DEFAULT_CO = { name:"株式会社 神戸大商", manager:"経理担当　秦", addr:"〒532-0011 大阪市淀川区西中島４丁目７番１８号", tel:"TEL:06-6379-3451", fax:"FAX:06-6379-3461", regNo:"T4120001218286", bankA:"りそな銀行　新大阪駅前支店　普通0436583", bankB:"三井住友銀行　神戸営業部　普通預金1663502", adminEmails:"shin@kobedaisho.com" };
const N = "#1a2744";
const INP = { width:"100%", padding:"7px 9px", border:"1px solid #d1d5db", borderRadius:6, fontSize:13, fontFamily:"inherit", background:"#fff", color:"#111", outline:"none" };
const SEL = { ...INP };

function Btn({ children, onClick, variant="ghost", disabled, style={}, small }) {
  const V = { primary:{background:N,color:"#fff",border:"none"}, blue:{background:"#2563eb",color:"#fff",border:"none"}, red:{background:"#dc2626",color:"#fff",border:"none"}, green:{background:"#16a34a",color:"#fff",border:"none"}, ghost:{background:"#f3f4f6",color:"#111",border:"1px solid #e5e7eb"} };
  return <button onClick={onClick} disabled={disabled} style={{ padding:small?"4px 9px":"7px 13px", borderRadius:6, cursor:disabled?"not-allowed":"pointer", fontSize:small?11:13, fontFamily:"inherit", opacity:disabled?0.5:1, ...V[variant], ...style }}>{children}</button>;
}
function Field({ label, children }) {
  return <div style={{ marginBottom:10 }}><label style={{ display:"block", fontSize:11, color:"#6b7280", marginBottom:4, fontWeight:500 }}>{label}</label>{children}</div>;
}
function Modal({ title, onClose, children, maxW=560, tall }) {
  return <div onClick={e=>e.target===e.currentTarget&&onClose()} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300, padding:12 }}>
    <div style={{ background:"#fff", borderRadius:12, width:"100%", maxWidth:maxW, maxHeight:tall?"96vh":"90vh", overflow:"auto", boxShadow:"0 20px 60px rgba(0,0,0,0.3)" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 18px", borderBottom:"1px solid #f0f0f0", position:"sticky", top:0, background:"#fff", zIndex:1 }}>
        <span style={{ fontWeight:600, fontSize:15 }}>{title}</span>
        <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", fontSize:22, color:"#9ca3af", lineHeight:1 }}>×</button>
      </div>
      <div style={{ padding:16 }}>{children}</div>
    </div>
  </div>;
}

function ItemsEditor({ items, products, onChange, docType="納品書" }) {
  const upd = (i, k, v) => {
    onChange(items.map((it, j) => {
      if (j !== i) return it;
      const u = { ...it, [k]: v };
      if(k==="name"){delete u.productId;delete u.productCode;}
      if (k === "qty" || k === "price") u.amount = Number(u.qty||0) * Number(u.price||0);
      return u;
    }));
  };
  const addItem = () => onChange([...items, draftItem(tod(), docType)]);
  const remItem = (i) => onChange(items.filter((_,j)=>j!==i));
  const fill = (i, p) => {
    const u = { ...items[i], productId:p.id, productCode:p.code, name:p.name, unit:p.unit, price:p.price, origin:p.origin||"", taxRate:p.taxRate||8, taxIncluded: docType === "領収書" ? true : Boolean(items[i].taxIncluded) };
    u.amount = Number(u.qty||0) * Number(u.price||0);
    onChange(items.map((it,j)=>j===i?u:it));
  };
  const tx = previewTax(items);
  return <div>
    {tx.error&&<p role="alert" style={{color:"#b91c1c",fontSize:12}}>{"\u6570\u91cf\u30fb\u91d1\u984d\u306e\u5165\u529b\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044"}</p>}
    <div style={{ overflowX:"auto" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12, minWidth:780 }}>
        <thead><tr style={{ background:N, color:"#fff" }}>
          {["日付","品名","産地","ケース","入数","数量","単位","単価","金額","税率","税種",""].map((h,i)=><th key={i} style={{ padding:"5px 6px", fontWeight:400, whiteSpace:"nowrap" }}>{h}</th>)}
        </tr></thead>
        <tbody>
          {items.map((it,i)=><tr key={i} style={{ borderBottom:"1px solid #f0f0f0" }}>
            <td style={{ padding:"3px 4px" }}><input style={{ ...INP, width:110, fontSize:11, padding:"4px 5px" }} type="date" value={it.date||""} onChange={e=>upd(i,"date",e.target.value)}/></td>
            <td style={{ padding:"3px 4px" }}>
              <select style={{ ...SEL, width:130, fontSize:11, padding:"4px 5px" }} value={it.productId || products.find(p=>p.name===it.name)?.id || ""} onChange={e=>{ const p=products.find(x=>x.id===e.target.value); if(p) fill(i,p); else upd(i,"name",e.target.value); }}>
                <option value="">品名選択</option>
                {products.map(p=><option key={p.id} value={p.id}>{[p.code,p.name,p.origin].filter(Boolean).join(" / ")}</option>)}
              </select>
            </td>
            <td style={{ padding:"3px 4px" }}><input style={{ ...INP, width:70, fontSize:11, padding:"4px 5px" }} value={it.origin||""} onChange={e=>upd(i,"origin",e.target.value)} placeholder="韓国産"/></td>
            <td style={{ padding:"3px 4px" }}><input style={{ ...INP, width:55, fontSize:11, padding:"4px 5px" }} type="number" value={it.caseCount||""} onChange={e=>upd(i,"caseCount",e.target.value)}/></td>
            <td style={{ padding:"3px 4px" }}><input style={{ ...INP, width:50, fontSize:11, padding:"4px 5px" }} type="number" value={it.qtyPerCase||""} onChange={e=>upd(i,"qtyPerCase",e.target.value)}/></td>
            <td style={{ padding:"3px 4px" }}><input style={{ ...INP, width:60, fontSize:11, padding:"4px 5px" }} type="number" value={it.qty||""} onChange={e=>upd(i,"qty",e.target.value)}/></td>
            <td style={{ padding:"3px 4px" }}><input style={{ ...INP, width:55, fontSize:11, padding:"4px 5px" }} value={it.unit||""} onChange={e=>upd(i,"unit",e.target.value)}/></td>
            <td style={{ padding:"3px 4px" }}><input style={{ ...INP, width:72, fontSize:11, padding:"4px 5px" }} type="number" value={it.price||""} onChange={e=>upd(i,"price",e.target.value)}/></td>
            <td style={{ padding:"3px 4px" }}><input style={{ ...INP, width:78, fontSize:11, padding:"4px 5px", background:"#f3f4f6" }} type="number" value={it.amount||""} readOnly title="数量×単価から自動計算"/></td>
            <td style={{ padding:"3px 4px" }}>
              <select style={{ ...SEL, width:62, fontSize:11, padding:"4px 5px" }} value={it.taxRate||8} onChange={e=>upd(i,"taxRate",Number(e.target.value))}>
                <option value={8}>8%</option><option value={10}>10%</option>
              </select>
            </td>
            <td style={{ padding:"3px 4px" }}>
              <select style={{ ...SEL, width:60, fontSize:11, padding:"4px 5px" }} value={it.taxIncluded?"in":"ex"} onChange={e=>upd(i,"taxIncluded",e.target.value==="in")}>
                <option value="ex">外税</option><option value="in">内税</option>
              </select>
            </td>
            <td style={{ padding:"3px 4px" }}><button onClick={()=>remItem(i)} style={{ background:"none", border:"none", cursor:"pointer", color:"#9ca3af", fontSize:16 }}>×</button></td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:8 }}>
      <Btn small onClick={addItem}>＋ 品目追加</Btn>
      {items.length>0&&<div style={{ fontSize:12, color:"#6b7280" }}>
        {"小計: " + fm(tx.sub) + "円 ／ 消費税: " + fm(tx.tax) + "円 ／ "}
        <strong>{"合計: " + fm(tx.total) + "円"}</strong>
      </div>}
    </div>
  </div>;
}

function DirectDocForm({ co, products, customers, history, setHistory, setProducts, setCustomers, user, onClose }) {
  const empty = draftItem(tod(), "納品書");
  const [f, setF] = useState({ docType:"納品書", date:tod(), customer:"", subject:"", dueDate:"", expiryDate:"", conditions:"", bank:co.bankA||"", note:"", amount:"", description:"商品代として", items:[empty] });
  const [saving, setSaving] = useState(false);
  const receiptPreviewItems = validItems(f.items);
  const receiptItemsTotal = previewTax(receiptPreviewItems).total;
  const receiptPreviewAmount = Number(f.amount||0) > 0 ? Number(f.amount) : receiptItemsTotal;
  const receiptAmountIsMismatched = receiptPreviewItems.length > 0 && Number(f.amount||0) > 0 && Math.abs(Number(f.amount) - receiptItemsTotal) > 0.01;
  const upd = (k,v) => setF(x=>({...x,[k]:v}));
  const fillCust = (name) => {
    const c = customers.find(x=>x.name===name);
    upd("customer", name);
    if (c && c.bank) upd("bank", c.bank);
  };
  const handleSave = async (print) => {
    if (!f.customer) { alert("取引先を選択してください"); return; }
    const receiptItems = validItems(f.items);
    const validationError = validateDocument({ ...f, items: receiptItems });
    if (validationError) { alert(validationError); return; }
    const normalizedDoc = normalizeReceiptForSave({ ...f, items: receiptItems });
    if (!confirmReceiptAmount(normalizedDoc)) return;
    setSaving(true);
    try {
      const doc = f.docType === "領収書" ? normalizedDoc : { ...f, items: f.items };
      const saved = await db.saveDocument(doc, user);
      if (saved._duplicate) {
        // 重複検知: 出庫処理はスキップ（在庫の二重減算防止）。PDFは既存書類で生成可
        setHistory(h=>[saved,...h.filter(x=>x.id!==saved.id)]);
        if (print) await generateAndDownloadPDF(saved, co);
        alert("⚠️ 同じ内容の"+(saved.docType||"書類")+"が既に作成済みです（"+saved.docNo+"）。\n重複作成を防止しました。");
        onClose(); setSaving(false); return;
      }
      setHistory(h=>[saved,...h.filter(x=>x.id!==saved.id)]);
      const result = await autoRegisterAndStock({...saved}, user);
      if (result.newCustomer || result.newProducts.length > 0) {
        const [prods, custs] = await Promise.all([db.getProducts(), db.getCustomers()]);
        setProducts(prods); setCustomers(custs);
      } else if (result.stockLogs.length > 0) {
        setProducts(await db.getProducts());
      }
      if (print) await generateAndDownloadPDF(saved, co);
      const msgs = [];
      if (result.newCustomer) msgs.push(`顧客「${result.newCustomer}」を自動登録しました`);
      if (result.newProducts.length > 0) msgs.push(`商品「${result.newProducts.join("・")}」を自動登録しました`);
      if (result.stockLogs.length > 0) msgs.push("出庫記録: " + result.stockLogs.map(l=>l.name+"×"+l.qty).join("、"));
      if (msgs.length > 0) alert(msgs.join("\n"));
      onClose();
    } catch(e) { alert((e._duplicate ? "⚠️ " : "エラー: ") + e.message); }
    setSaving(false);
  };
  return <Modal title={`📝 ${f.docType}を直接作成`} onClose={onClose} maxW={900} tall>
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:12 }}>
      <Field label="書類種別">
        <select style={SEL} value={f.docType} onChange={e=>{ const type=e.target.value; setF(x=>({...x,docType:type,items:(x.items||[]).map(it=>({...it,taxIncluded:type==="領収書"?true:Boolean(it.taxIncluded)}))})); }}>
          <option>納品書</option><option>請求書</option><option>領収書</option><option>見積書</option>
        </select>
      </Field>
      <Field label="日付"><input style={INP} type="date" value={f.date} onChange={e=>upd("date",e.target.value)}/></Field>
      <Field label="入金期日"><input style={INP} type="date" value={f.dueDate} onChange={e=>upd("dueDate",e.target.value)}/></Field>
      <Field label="取引先">
        <select style={SEL} value={f.customer} onChange={e=>fillCust(e.target.value)}>
          <option value="">選択してください</option>
          {customers.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="件名"><input style={INP} value={f.subject} onChange={e=>upd("subject",e.target.value)} placeholder="例: さざえ"/></Field>
      {f.docType==="請求書"&&<Field label="振込先"><input style={INP} value={f.bank} onChange={e=>upd("bank",e.target.value)}/></Field>}
      {f.docType==="見積書"&&<Field label="有効期限"><input style={INP} type="date" value={f.expiryDate||""} onChange={e=>upd("expiryDate",e.target.value)}/></Field>}
      {f.docType==="見積書"&&<Field label="取引条件"><input style={INP} value={f.conditions||""} onChange={e=>upd("conditions",e.target.value)} placeholder="例: 現金払い"/></Field>}
    </div>
    {f.docType==="領収書"&&<div style={{ background:"#faf5ff", border:"1px solid #c4b5fd", borderRadius:8, padding:12, marginBottom:12 }}>
      <div style={{ fontWeight:500, fontSize:13, marginBottom:10, color:"#7c3aed" }}>🧾 領収書の金額・内容</div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
        <Field label="領収金額（税込・円）*">
          <input style={{ ...INP, fontSize:15, fontWeight:500 }} type="number" value={f.amount||""} onChange={e=>upd("amount",e.target.value)} placeholder={receiptPreviewItems.length > 0 ? "空欄なら明細合計" : "例: 50000"}/>
        </Field>
        <Field label="但し書き">
          <input style={INP} value={f.description||"商品代として"} onChange={e=>upd("description",e.target.value)} placeholder="商品代として"/>
        </Field>
      </div>
      {f.docType==="領収書"&&receiptPreviewAmount>0&&<div style={{ textAlign:"right", fontSize:14, color:"#7c3aed", fontWeight:500 }}>
        {"領収金額: ¥" + receiptPreviewAmount.toLocaleString("ja-JP") + " -"}
      </div>}
      {f.docType==="領収書"&&receiptPreviewItems.length>0&&<div style={{ fontSize:11, color:"#7c3aed", marginTop:4 }}>手入力した領収金額を優先します。金額を空欄にした場合のみ、明細合計（税込）を使用します（現在の明細合計: ¥{receiptItemsTotal.toLocaleString("ja-JP")}）。</div>}
      {f.docType==="領収書"&&receiptAmountIsMismatched&&<div style={{ fontSize:11, color:"#b45309", background:"#fffbeb", border:"1px solid #fcd34d", borderRadius:6, padding:"6px 8px", marginTop:6 }}>⚠️ 手入力金額と明細合計が不一致です。保存時に手入力金額を正とする確認を表示し、PDFでは明細を非表示にします。</div>}
    </div>}
    <>
    <div style={{ fontWeight:500, fontSize:13, marginBottom:8, color:"#374151" }}>{f.docType==="領収書"?"内容明細":"品目"}</div>
    <ShipmentChoice doc={f} onChange={v=>upd("stockManaged",v)}/>
    <ItemsEditor items={f.items} products={products} docType={f.docType} onChange={items=>upd("items",items)}/>
    </>
    <Field label="備考"><input style={{ ...INP, marginTop:10 }} value={f.note} onChange={e=>upd("note",e.target.value)} placeholder="任意"/></Field>
    <div style={{ display:"flex", gap:8, marginTop:14, justifyContent:"flex-end" }}>
      <Btn onClick={onClose}>キャンセル</Btn>
      <Btn variant="primary" onClick={()=>handleSave(false)} disabled={saving}>💾 保存</Btn>
      <Btn variant="blue" onClick={()=>handleSave(true)} disabled={saving}>📄 保存してPDF生成</Btn>
    </div>
  </Modal>;
}

function DocEditModal({ doc, onClose, onSave, co, products }) {
  const [d, setD] = useState({ ...doc });
  const [saving,setSaving]=useState(false);
  const saveLock=useRef(false);
  const editReceiptItems = validItems(d.items);
  const editReceiptItemsTotal = previewTax(editReceiptItems).total;
  const editReceiptAmountIsMismatched = editReceiptItems.length > 0 && Number(d.amount||0) > 0 && Math.abs(Number(d.amount) - editReceiptItemsTotal) > 0.01;
  const upd = (k,v) => setD(x=>({...x,[k]:v}));
  const submit = async () => {
    if(saveLock.current||!confirmReceiptAmount(d))return;
    saveLock.current=true;setSaving(true);
    try{await onSave(d);}finally{saveLock.current=false;setSaving(false);}
  };
  return <Modal title={`${d.docType} 編集`} onClose={onClose} maxW={900} tall>
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:12 }}>
      <Field label="書類種別"><select style={SEL} disabled={Boolean(d.id)} value={d.docType} onChange={e=>upd("docType",e.target.value)}><option>納品書</option><option>請求書</option><option>領収書</option><option>見積書</option></select></Field>
      <Field label="日付"><input style={INP} type="date" value={d.date||""} onChange={e=>upd("date",e.target.value)}/></Field>
      <Field label="入金期日"><input style={INP} type="date" value={d.dueDate||""} onChange={e=>upd("dueDate",e.target.value)}/></Field>
      <Field label="取引先"><input style={INP} value={d.customer||""} onChange={e=>upd("customer",e.target.value)}/></Field>
      <Field label="件名"><input style={INP} value={d.subject||""} onChange={e=>upd("subject",e.target.value)}/></Field>
      {d.docType==="請求書"&&<Field label="振込先"><input style={INP} value={d.bank||""} onChange={e=>upd("bank",e.target.value)}/></Field>}
      {d.docType==="見積書"&&<Field label="有効期限"><input style={INP} type="date" value={d.expiryDate||""} onChange={e=>upd("expiryDate",e.target.value)}/></Field>}
      {d.docType==="見積書"&&<Field label="取引条件"><input style={INP} value={d.conditions||""} onChange={e=>upd("conditions",e.target.value)}/></Field>}
    </div>
    <>
      <div style={{ fontWeight:500, fontSize:13, marginBottom:8 }}>{d.docType==="領収書"?"内容明細":"品目"}</div>
      <ShipmentChoice doc={d} onChange={v=>upd("stockManaged",v)}/>
      <ItemsEditor items={d.items||[]} products={products||[]} docType={d.docType} onChange={items=>upd("items",items)}/>
    </>
    {d.docType==="領収書"&&<>
      <Field label="金額（税込）"><input style={INP} type="number" value={d.amount||""} onChange={e=>upd("amount",e.target.value)} placeholder={editReceiptItems.length > 0 ? "空欄なら明細合計" : "例: 50000"}/></Field>
      {editReceiptItems.length > 0&&<div style={{ fontSize:11, color:"#7c3aed", marginTop:-6, marginBottom:8 }}>手入力金額を優先します。空欄の場合のみ明細合計（税込）¥{editReceiptItemsTotal.toLocaleString("ja-JP")}を使用します。</div>}
      {editReceiptAmountIsMismatched&&<div style={{ fontSize:11, color:"#b45309", background:"#fffbeb", border:"1px solid #fcd34d", borderRadius:6, padding:"6px 8px", marginBottom:8 }}>⚠️ 手入力金額と明細合計が不一致です。保存時に手入力金額を正とする確認を表示し、PDFでは明細を非表示にします。</div>}
      <Field label="但し書き"><input style={INP} value={d.description||"商品代として"} onChange={e=>upd("description",e.target.value)}/></Field>
    </>}
    <Field label="備考"><input style={{ ...INP, marginTop:8 }} value={d.note||""} onChange={e=>upd("note",e.target.value)}/></Field>
    <div style={{ display:"flex", gap:8, marginTop:14, justifyContent:"flex-end" }}>
      <Btn onClick={onClose}>キャンセル</Btn>
      <Btn variant="primary" disabled={saving} onClick={submit}>✅ 保存</Btn>
    </div>
  </Modal>;
}

function DocCard({ doc, co, onEdit, onPrint, saved, saving }) {
  const tx = documentTax(doc);
  const docTotal = totalFor(doc);
  const hasReceiptDetails = validItems(doc.items).length > 0;
  const tc = doc.docType==="請求書"?"#1d4ed8":doc.docType==="領収書"?"#7c3aed":doc.docType==="見積書"?"#d97706":"#047857";
  return <div style={{ background:"#fff", border:"1.5px solid #e5e7eb", borderRadius:10, overflow:"hidden", marginTop:8, maxWidth:420, boxShadow:"0 2px 8px rgba(0,0,0,0.07)" }}>
    <div style={{ background:N, padding:"9px 13px", display:"flex", alignItems:"center", gap:10 }}>
      <span style={{ background:tc, color:"#fff", fontSize:11, padding:"2px 7px", borderRadius:4, fontWeight:500 }}>{doc.docType}</span>
      <span style={{ color:"#fff", fontWeight:500, fontSize:14 }}>{doc.customer}</span>
      <span style={{ color:"rgba(255,255,255,0.6)", fontSize:11, marginLeft:"auto" }}>{doc.date}</span>
    </div>
    <div style={{ padding:"9px 13px" }}>
      {doc.subject&&<div style={{ fontSize:11, color:"#6b7280", marginBottom:5 }}>{"件名: " + doc.subject}</div>}
      {(doc.items||[]).slice(0,3).map((it,i)=><div key={i} style={{ display:"flex", justifyContent:"space-between", fontSize:12, padding:"2px 0", borderBottom:"1px solid #f3f4f6" }}>
        <span>{(it.origin?it.origin+" ":"") + it.name + (Number(it.taxRate)!==10?" ※":"") + " × " + it.qty + it.unit}</span>
        <span style={{ fontWeight:500 }}>{fm(it.amount) + "円"}</span>
      </div>)}
      {(doc.items||[]).length>3&&<div style={{ fontSize:11, color:"#9ca3af", padding:"2px 0" }}>{"...他 " + (doc.items.length-3) + "品目"}</div>}
      {doc.docType==="領収書"&&receiptAmountMismatch(doc)&&<div style={{ fontSize:11, color:"#b45309", background:"#fffbeb", borderRadius:5, padding:"4px 6px", marginTop:5 }}>⚠️ 手入力金額を優先（明細は参考）</div>}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:7, paddingTop:7, borderTop:"1px solid #f3f4f6" }}>
        <div>
          <div style={{ fontSize:11, color:"#6b7280" }}>{doc.docType==="領収書"&&!hasReceiptDetails ? "領収金額" : "小計 " + fm(tx.sub) + "円 / 消費税 " + fm(tx.tax) + "円"}</div>
          <div style={{ fontSize:15, fontWeight:600, marginTop:2 }}>{"合計 " + fm(docTotal) + "円"}</div>
        </div>
        <div style={{ display:"flex", gap:5, flexWrap:"wrap", justifyContent:"flex-end" }}>
          <Btn small onClick={onEdit}>{saved?"\u7de8\u96c6":"\u5185\u5bb9\u78ba\u8a8d\u30fb\u4fdd\u5b58"}</Btn>
          <Btn small variant="primary" disabled={!saved||saving} onClick={onPrint}>📄 PDF生成</Btn>
          {saving&&<span style={{ fontSize:11, color:"#9ca3af", alignSelf:"center" }}>保存中...</span>}
          {!saving&&saved&&<span style={{ fontSize:11, color:"#16a34a", alignSelf:"center" }}>✓ 保存済</span>}
        </div>
      </div>
    </div>
  </div>;
}

function ParseReviewCard({ result }) {
  const doc = result?.doc || {};
  const items = Array.isArray(doc.items) ? doc.items : [];
  const missing = Array.isArray(result?.missing) ? result.missing : [];
  const unrecognized = Array.isArray(result?.unrecognized) ? result.unrecognized : [];
  const recognized = [
    doc.docType && `書類: ${doc.docType}`,
    doc.date && `日付: ${doc.date}`,
    doc.customer && `取引先: ${doc.customer}`,
  ].filter(Boolean);
  return <div style={{ background:"#fff", border:"1px solid #dbeafe", borderRadius:9, padding:"9px 12px", marginTop:8, maxWidth:460, fontSize:12 }}>
    <div style={{ color:"#1d4ed8", fontWeight:600, marginBottom:6 }}>認識できた内容（未保存の下書き）</div>
    {result?.requestId&&<div style={{ color:"#9ca3af", fontSize:10, marginBottom:5 }}>AIログID: {result.requestId}</div>}
    {recognized.length>0&&<div style={{ color:"#374151", marginBottom:5 }}>{recognized.join(" / ")}</div>}
    {items.length>0&&<div style={{ borderTop:"1px solid #eff6ff", paddingTop:5 }}>
      {items.map((it,i)=><div key={i} style={{ display:"flex", justifyContent:"space-between", gap:8, padding:"2px 0" }}>
        <span>{it.name || "品名未認識"}{it.origin ? `（${it.origin}）` : ""} × {it.qty ?? "数量未認識"}{it.unit || ""}</span>
        <span>{it.price != null ? `単価 ${fm(it.price)}円` : "単価未認識"}</span>
      </div>)}
    </div>}
    {recognized.length===0&&items.length===0&&<div style={{ color:"#6b7280", marginBottom:5 }}>認識できた項目はありません。</div>}
    {missing.length>0&&<div style={{ color:"#b45309", marginTop:7 }}>不足: {missing.join("、")}</div>}
    {unrecognized.length>0&&<div style={{ color:"#b91c1c", marginTop:5 }}>
      <div>未認識・要確認:</div>
      {unrecognized.map((x,i)=><div key={i} style={{ paddingLeft:8, marginTop:2 }}>・{x.field || "項目"}{x.raw ? `「${String(x.raw).slice(0,80)}」` : ""}{x.reason ? ` — ${x.reason}` : ""}</div>)}
    </div>}
  </div>;
}

function parseReviewContext(result, question) {
  const parts = [question];
  if (result?.missing?.length) parts.push(`不足: ${result.missing.join("、")}`);
  if (result?.unrecognized?.length) parts.push(`未認識: ${result.unrecognized.map(x=>x.raw || x.field || "項目").join("、")}`);
  return parts.join("\n");
}

function ChatView({ co, products, customers, history, setHistory, setProducts, setCustomers, user }) {
  const [msgs, setMsgs] = useState([{ role:"assistant", text:"こんにちは！\n自然な言葉で書類を作成できます。\n例：「5/5 平家茶屋 真河豚ドレス30×1,700円 税込 納品書お願いします」" }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [docStates, setDocStates] = useState({});
  const [editTarget, setEditTarget] = useState(null);
  const [showDirect, setShowDirect] = useState(false);
  const [pendingParse, setPendingParse] = useState(null); // 書類作成の質問ループ中の会話履歴
  const bottomRef = useRef(null);
  const SUGG = ["5/5 平家茶屋 真河豚ドレス30×1,700円 税込 納品書","4月分 TEN&A さざえ請求書","藤屋 まふぐ刺身6パック×6,600円 納品書"];
  useEffect(()=>{ bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs, loading]);

  const send = async (text) => {
    if (!text.trim() || loading) return;
    setMsgs(m=>[...m, { id:tid(), role:"user", text:text.trim() }]);
    setInput(""); setLoading(true);
    try {
      if (pendingParse || isDocReq(text)) {
        if (pendingParse && /^(キャンセル|中止|やめ|やめて|cancel)/i.test(text.trim())) {
          setPendingParse(null);
          setMsgs(m=>[...m,{ id:tid(), role:"assistant", text:"書類作成を中止しました。最初からやり直せます。" }]);
        } else {
        const convo = [...(pendingParse || []), { role:"user", content:text.trim() }];
        const res = await aiParse(convo, co, customers, products);
        if (res && res.need_info) {
          // 不足情報・品名候補などを質問（揃うまで作成しない）
          const q = res.message || "もう少し情報が必要です。取引先・品名・数量・単価を教えてください。";
          const review = parseReviewContext(res, q);
          setPendingParse([...convo, { role:"assistant", content:review }]);
          setMsgs(m=>[...m,{ id:tid(), role:"assistant", text:q, parseResult:res }]);
        } else {
        setPendingParse(null);
        const parsed = res.doc || res;
        const parsedValidation = validateDocument(parsed);
        if (parsedValidation) {
          setPendingParse([...convo, { role:"assistant", content:parsedValidation }]);
          setMsgs(m=>[...m,{ id:tid(), role:"assistant", text:parsedValidation }]);
          setLoading(false);
          return;
        }
        const prepared = {...normalizeReceiptForSave(parsed),stockManaged:parsed.docType==="\u7d0d\u54c1\u66f8"};
        const msgId = tid();
        setDocStates(s=>({...s,[msgId]:{doc:prepared,saved:false,saving:false}}));
        setMsgs(m=>[...m,{id:msgId,role:"assistant",text:"\u8349\u7a3f\u3092\u4f5c\u6210\u3057\u307e\u3057\u305f\u3002\u300c\u5185\u5bb9\u78ba\u8a8d\u30fb\u4fdd\u5b58\u300d\u3067\u78ba\u5b9a\u3057\u3066\u304f\u3060\u3055\u3044\u3002\u307e\u3060\u5728\u5eab\u306f\u52d5\u304b\u3057\u3066\u3044\u307e\u305b\u3093\u3002",doc:prepared}]);

        }
        }
      } else {
        const lastPending = [...msgs].reverse().find(m=>m.pendingOrigin);
        if (lastPending && /^(?:\u56fd\u7523|.{1,24}\u7523)$/.test(text.trim())) {
          const origin = text.trim();
          const { docId, items: itemNames } = lastPending.pendingOrigin;
          const targetDoc = history.find(h=>h.id===docId);
          if (targetDoc) {
            const updatedItems = (targetDoc.items||[]).map(it=>itemNames.includes(it.name)?{...it,origin}:it);
            const updated = await db.updateDocument(docId, {...targetDoc, items:updatedItems});
            setHistory(h=>h.map(x=>x.id===docId?updated:x));
            // チャット上のDocCardも更新
            setDocStates(s=>{
              const newS = {...s};
              Object.keys(newS).forEach(msgId=>{
                if (newS[msgId]?.doc?.id===docId) {
                  newS[msgId] = {...newS[msgId], doc:updated};
                }
              });
              return newS;
            });
            setMsgs(m=>m.map(msg=>msg.doc?.id===docId ? {...msg, doc:updated} : msg));
            setMsgs(m=>m.map(msg=>msg.pendingOrigin?.docId===docId?{...msg,pendingOrigin:null}:msg));
            setMsgs(m=>[...m,{ id:tid(), role:"assistant", text:`✅ 「${itemNames.join("・")}」の産地を「${origin}」に設定しました。納品書のPDFを再生成してください。` }]);
          }
        } else {
          const apiMsgs = msgs.slice(-8).map(m=>({ role:m.role, content:m.text }));
          apiMsgs.push({ role:"user", content:text });
          const reply = await aiChat(apiMsgs, co);
          setMsgs(m=>[...m,{ id:tid(), role:"assistant", text:reply }]);
        }
      }
    } catch(e) { setMsgs(m=>[...m,{ id:tid(), role:"assistant", text:"エラー: " + e.message }]); }
    setLoading(false);
  };

  const handleEditSave = async (newDoc) => {
    const prepared = normalizeReceiptForSave(newDoc);
    const validationError = validateDocument(prepared);
    if (validationError) { alert(validationError); return; }
    try {
      const saved = prepared.id ? await db.updateDocument(prepared.id, prepared) : await db.saveDocument(prepared,user);
      if (saved.id) {
        setHistory(h=>[saved,...h.filter(x=>x.id!==saved.id)]);
        setProducts(await db.getProducts());
      }
      setDocStates(s=>({...s,[editTarget.msgId]:{ ...s[editTarget.msgId], doc:saved, saved:Boolean(saved.id), saving:false }}));
      setMsgs(m=>m.map(msg=>msg.id===editTarget.msgId?{...msg,doc:saved,text:(saved.docType||"書類")+"を更新しました ✓"}:msg));
      setEditTarget(null);
    } catch (e) { alert("編集保存エラー: " + e.message); }
  };

  return <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
    <div style={{ padding:"8px 16px", borderBottom:"1px solid #f0f0f0", display:"flex", gap:8 }}>
      <Btn small variant="primary" onClick={()=>setShowDirect(true)}>📝 直接作成</Btn>
      <span style={{ fontSize:11, color:"#9ca3af", alignSelf:"center" }}>または下のチャットでAI作成</span>
    </div>
    <div style={{ flex:1, overflowY:"auto", padding:"14px 18px", display:"flex", flexDirection:"column", gap:10 }}>
      {msgs.map((msg,i)=>{
        const isUser = msg.role==="user";
        const ds = msg.id ? docStates[msg.id] : null;
        const curDoc = ds?.doc || msg.doc;
        return <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:isUser?"flex-end":"flex-start" }}>
          <div style={{ maxWidth:"78%", background:isUser?N:"#f3f4f6", color:isUser?"#fff":"#111", borderRadius:isUser?"12px 12px 3px 12px":"12px 12px 12px 3px", padding:"9px 13px", fontSize:13, lineHeight:1.6, whiteSpace:"pre-wrap" }}>{msg.text}</div>
          {curDoc&&<DocCard doc={curDoc} co={co}
            onEdit={()=>setEditTarget({ msgId:msg.id, doc:curDoc })}
            onPrint={()=>generateAndDownloadPDF(curDoc,co)}
            saved={ds?.saved||false} saving={ds?.saving||false}
          />}
          {msg.parseResult&&<ParseReviewCard result={msg.parseResult}/>}
        </div>;
      })}
      {loading&&<div style={{ display:"flex" }}><div style={{ background:"#f3f4f6", borderRadius:"12px 12px 12px 3px", padding:"9px 13px" }}><span style={{ display:"inline-flex", gap:4 }}>{[0,1,2].map(i=><span key={i} style={{ width:5, height:5, borderRadius:"50%", background:"#9ca3af", display:"inline-block", animation:"blink 1.2s infinite", animationDelay:`${i*0.2}s` }}/>)}</span></div></div>}
      <div ref={bottomRef}/>
    </div>
    {msgs.length<=1&&<div style={{ padding:"0 18px 8px", display:"flex", gap:6, flexWrap:"wrap" }}>
      {SUGG.map((s,i)=><button key={i} onClick={()=>send(s)} style={{ padding:"5px 11px", background:"#f3f4f6", border:"1px solid #e5e7eb", borderRadius:16, fontSize:11, cursor:"pointer", color:"#374151", fontFamily:"inherit" }}>{s}</button>)}
    </div>}
    <div style={{ padding:"10px 18px", borderTop:"1px solid #f0f0f0" }}>
      <div style={{ display:"flex", gap:8, alignItems:"flex-end" }}>
        <textarea value={input} onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); send(input); } }}
          placeholder="例：5/5 平家茶屋 真河豚ドレス30×1,700円 税込 納品書（Shift+Enterで改行）"
          style={{ flex:1, padding:"9px 11px", border:"1px solid #e5e7eb", borderRadius:8, fontSize:13, fontFamily:"inherit", outline:"none", resize:"none", minHeight:42, maxHeight:110, lineHeight:1.5 }}
          rows={1} onInput={e=>{ e.target.style.height="auto"; e.target.style.height=Math.min(e.target.scrollHeight,110)+"px"; }}
        />
        <button onClick={()=>send(input)} disabled={!input.trim()||loading}
          style={{ padding:"9px 14px", background:N, color:"#fff", border:"none", borderRadius:8, cursor:"pointer", fontSize:13, fontFamily:"inherit", height:42, opacity:(!input.trim()||loading)?0.5:1 }}>送信 ↑</button>
      </div>
    </div>
    {editTarget&&<DocEditModal doc={editTarget.doc} co={co} products={products} onClose={()=>setEditTarget(null)} onSave={handleEditSave}/>}
    {showDirect&&<DirectDocForm co={co} products={products} customers={customers} history={history} setHistory={setHistory} setProducts={setProducts} setCustomers={setCustomers} user={user} onClose={()=>setShowDirect(false)}/>}
    <style>{`@keyframes blink{0%,80%,100%{opacity:0}40%{opacity:1}}`}</style>
  </div>;
}

function HistoryView({ history, setHistory, co, products, setProducts, user, initialStatus="active" }) {
  const [voidTarget,setVoidTarget]=useState(null);
  const [batchBusy,setBatchBusy]=useState(false);
  const batchLock=useRef(false);
  const [statusFilter,setStatusFilter]=useState(initialStatus);
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState("");
  const [editTarget, setEditTarget] = useState(null);
  const [typeFilter, setTypeFilter] = useState("全て");
  const [checked, setChecked] = useState({});
  const [batchMode, setBatchMode] = useState(false);
  const [batchModal, setBatchModal] = useState(false);
  const [batchDueDate, setBatchDueDate] = useState("");
  const [batchBank, setBatchBank] = useState(co.bankA||"");
  const [bulkDownloading, setBulkDownloading] = useState(false);

  const filt = (history||[]).filter(h=>
    (statusFilter==="all"||(statusFilter==="active"&&!h.voidedAt&&!h.convertedTo)||(statusFilter==="billable"&&isBillable(h))||(statusFilter==="review"&&!h.voidedAt&&h.stockManaged==null))&&
    (typeFilter==="全て"||h.docType===typeFilter)&&
    (!q||h.customer?.includes(q)||h.docNo?.includes(q)||h.subject?.includes(q))
  );
  const tc = (t) => t==="請求書"?"#1d4ed8":t==="領収書"?"#7c3aed":t==="見積書"?"#d97706":"#047857";
  const totalToday = (history||[]).filter(h=>h.savedAt?.slice(0,10)===tod()).length;
  const checkedList = filt.filter(h=>checked[h.id] && isBillable(h));
  const bulkDocs = filt.filter(h=>!h.voidedAt&&(h.docType==="請求書"||h.docType==="領収書"));
  const checkedCustomers = [...new Set(checkedList.map(h=>h.customer))];
  const toggleCheck = (id, e) => { e.stopPropagation(); setChecked(c=>({...c,[id]:!c[id]})); };
  const clearCheck = () => setChecked({});

  const downloadAllBillingDetails = async () => {
    if (bulkDocs.length===0 || bulkDownloading) return;
    setBulkDownloading(true);
    try {
      downloadDocumentsCSV(bulkDocs);
    } catch(e) {
      alert("明細CSV生成エラー: " + e.message);
    } finally {
      setBulkDownloading(false);
    }
  };

  const batchToInvoice = async () => {
    if (checkedList.length===0||batchLock.current) return;
    if (checkedList.some(d=>d.docType!=="納品書")) { alert("納品書だけを選択してください"); return; }
    if (checkedCustomers.length>1) { alert("同じ取引先の納品書のみ選択してください"); return; }
    const customer = checkedCustomers[0];
    const allItems = checkedList
      .sort((a,b)=>a.date>b.date?1:-1)
      .flatMap(dn=>(dn.items||[]).map(it=>({...it, date:it.date||dn.date})));
    const inv = { docType:"請求書", date:tod(), customer,
      subject:checkedList.map(d=>d.subject).filter(Boolean).join("・")||"",
      dueDate:batchDueDate, bank:batchBank, items:allItems };
    const validationError = validateDocument(inv);
    if (validationError) { alert(validationError); return; }
    try {
      batchLock.current=true;setBatchBusy(true);
      const saved = await db.invoiceDeliveryNotes(checkedList.map(d=>d.id),inv);
      setHistory(await db.getDocuments());
      clearCheck(); setBatchMode(false); setBatchModal(false);
      if (saved._duplicate) {
        alert("⚠️ 同じ内容の請求書が既にあります（"+saved.docNo+"）。重複作成を防ぎました。");
      } else {
        alert("請求書を発行しました: " + saved.docNo + "\n取引先: " + customer + "\n品目数: " + String(allItems.length));
        generateAndDownloadPDF(saved, co);
      }
    } catch(e) { alert(e.message); } finally {batchLock.current=false;setBatchBusy(false);}
  };

  const asDraft = (src,type=src.docType) => ({...src,docType:type,id:undefined,docNo:undefined,
    updatedAt:undefined,date:tod(),voidedAt:null,convertedTo:null,sourceIds:[],taxSummary:null,
    stockManaged:type==="\u7d0d\u54c1\u66f8",items:(src.items||[]).map(({sourceDocumentId,sourceDocNo,...it})=>({...it,date:tod()}))});
  const convertDoc = async (fromDoc,toType) => {
    try {
      if(fromDoc.docType==="\u7d0d\u54c1\u66f8"&&toType==="\u8acb\u6c42\u66f8") {
        const saved=await db.invoiceDeliveryNotes([fromDoc.id],{date:tod(),bank:co.bankA||""});
        setHistory(await db.getDocuments());setSel(saved);
      } else {setEditTarget(asDraft(fromDoc,toType));setSel(null);}
    } catch(e){alert(e.message);}
  };
  const copyDoc = src => {setEditTarget(asDraft(src));setSel(null);};

  return <div style={{ height:"100%", display:"flex", flexDirection:"column" }}>
    <div style={{ padding:"10px 18px", borderBottom:"1px solid #f0f0f0", display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
      <input style={{ ...INP, flex:1, minWidth:120 }} placeholder="取引先・書類番号で検索..." value={q} onChange={e=>setQ(e.target.value)}/>
      <select style={{ ...SEL, width:90 }} value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}>
        <option>全て</option><option>納品書</option><option>請求書</option><option>領収書</option><option>見積書</option>
      </select>
      <select aria-label="\u72b6\u614b" style={{...SEL,width:145}} value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);clearCheck();}}>
        <option value="active">{'\u6709\u52b9\u306a\u66f8\u985e'}</option><option value="billable">{'\u672a\u8acb\u6c42\u306e\u7d0d\u54c1\u66f8'}</option><option value="review">{'\u5728\u5eab\u8981\u78ba\u8a8d'}</option><option value="all">{'\u53d6\u6d88\u30fb\u5909\u63db\u6e08\u307f\u3092\u542b\u3080'}</option>
      </select>
      <Btn small variant={batchMode?"primary":"ghost"} onClick={()=>{ setBatchMode(b=>!b); clearCheck(); }}>
        {batchMode?"✅ 選択中":"☑ 複数選択"}
      </Btn>
      {batchMode&&checkedList.length>0&&<Btn small variant="blue" onClick={()=>setBatchModal(true)}>
        {"📄 請求書まとめ発行（" + checkedList.length + "件）"}
      </Btn>}
      {batchMode&&checkedList.length>0&&<Btn small variant="red" onClick={clearCheck}>クリア</Btn>}
      <Btn small variant="green" onClick={downloadAllBillingDetails} disabled={bulkDocs.length===0||bulkDownloading}>
        {bulkDownloading?"⏳ CSV作成中...":"📥 請求書・領収書の明細CSV（"+bulkDocs.length+"件）"}
      </Btn>
      <span style={{ fontSize:11, color:"#9ca3af", whiteSpace:"nowrap" }}>{filt.length + "件 / 本日" + totalToday + "件"}</span>
    </div>
    {batchMode&&checkedList.length>0&&<div style={{ padding:"8px 18px", background:"#eff6ff", borderBottom:"1px solid #bfdbfe", fontSize:12 }}>
      {checkedCustomers.length===1
        ? <span style={{ color:"#1d4ed8" }}>{"✅ " + checkedCustomers[0] + " の納品書 " + checkedList.length + "件を選択中"}</span>
        : <span style={{ color:"#dc2626" }}>{"⚠️ 複数の取引先が混在しています（" + checkedCustomers.join("・") + "）"}</span>
      }
    </div>}
    <div style={{ flex:1, overflowY:"auto" }}>
      {filt.length===0&&<div style={{ textAlign:"center", padding:48, color:"#9ca3af" }}>書類がありません</div>}
      {filt.map(h=>{
        const tx = calcTax(h.items||[]);
        const isChecked = !!checked[h.id];
        return <div key={h.id} onClick={()=>batchMode?null:setSel(h)}
          style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 18px", borderBottom:"1px solid #f9f9f9", cursor:batchMode?"default":"pointer", background:isChecked?"#eff6ff":sel?.id===h.id?"#f9fafb":"transparent" }}>
          {batchMode&&<input type="checkbox" checked={isChecked} disabled={!isBillable(h)} onChange={e=>toggleCheck(h.id,e)} style={{ width:16, height:16, cursor:h.docType==="納品書"?"pointer":"not-allowed", flexShrink:0 }}/>}
          <span style={{ background:tc(h.docType), color:"#fff", fontSize:11, padding:"2px 6px", borderRadius:3, whiteSpace:"nowrap" }}>{h.docType}</span>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:500, fontSize:13 }}>{h.customer} <span style={{fontSize:10,color:h.voidedAt?"#b91c1c":"#64748b",fontWeight:400}}>{documentStatus(h)}</span></div>
            <div style={{ fontSize:11, color:"#9ca3af" }}>{h.docNo + " • " + h.date + (h.subject?" • "+h.subject:"")}</div>
          </div>
          <div style={{ textAlign:"right", flexShrink:0 }}>
            <div style={{ fontWeight:500, fontSize:13 }}>{fm(totalFor(h)) + "円"}</div>
            <div style={{ fontSize:11, color:"#9ca3af" }}>{h.savedBy}</div>
          </div>
        </div>;
      })}
    </div>
    {batchModal&&<Modal title={"📄 請求書まとめ発行 — " + checkedCustomers[0]} onClose={()=>setBatchModal(false)}>
      <div style={{ fontSize:13, marginBottom:12, color:"#6b7280" }}>{"選択した納品書 " + checkedList.length + "件の品目をまとめて1枚の請求書に変換します。"}</div>
      <div style={{ marginBottom:12 }}>
        {checkedList.sort((a,b)=>a.date>b.date?1:-1).map(d=>{
          const tx=calcTax(d.items||[]);
          return <div key={d.id} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:"1px solid #f3f4f6", fontSize:12 }}>
            <span>{d.date + " " + d.docNo}</span><span style={{ fontWeight:500 }}>{fm(tx.total) + "円"}</span>
          </div>;
        })}
        <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", fontWeight:600, fontSize:14 }}>
          <span>合計（税率別に再計算）</span><span>{fm(calcTax(checkedList.flatMap(d=>d.items||[])).total) + "円"}</span>
        </div>
      </div>
      <Field label="支払期限"><input style={INP} type="date" value={batchDueDate} onChange={e=>setBatchDueDate(e.target.value)}/></Field>
      <Field label="振込先"><input style={INP} value={batchBank} onChange={e=>setBatchBank(e.target.value)}/></Field>
      <div style={{ display:"flex", gap:8, marginTop:14 }}>
        <Btn onClick={()=>setBatchModal(false)} style={{ flex:1 }}>キャンセル</Btn>
        <Btn variant="primary" disabled={batchBusy} onClick={batchToInvoice} style={{ flex:1 }}>📄 請求書発行＋PDF生成</Btn>
      </div>
    </Modal>}
    {sel&&<Modal title={sel.docType + " - " + sel.customer} onClose={()=>setSel(null)}>
      {[["書類番号",sel.docNo],["日付",sel.date],["入金期日",sel.dueDate],["件名",sel.subject],["作成者",sel.savedBy]].map(([l,v])=>v?<div key={l} style={{ display:"flex", gap:8, padding:"5px 0", borderBottom:"1px solid #f3f4f6", fontSize:13 }}><span style={{ color:"#6b7280", minWidth:80 }}>{l}</span><span>{v}</span></div>:null)}
      <p style={{fontSize:12,color:'#64748b'}}>{documentStatus(sel)}{sel.voidReason ? ' / '+sel.voidReason : ''}</p>
      {sel.sourceIds?.length>0&&<p style={{fontSize:12}}>{'\u5143\u306e\u7d0d\u54c1\u66f8: '}{sel.sourceIds.map(id=>history.find(d=>d.id===id)?.docNo||id).join(', ')}</p>}
      {validItems(sel.items).map((it,i)=><div key={i} style={{ display:"flex", justifyContent:"space-between", fontSize:12, padding:"4px 0", borderBottom:"1px solid #f3f4f6" }}>
        <span>{(it.origin?it.origin+" ":"") + it.name + " × " + it.qty + it.unit}</span><span style={{ fontWeight:500 }}>{fm(it.amount) + "円"}</span>
      </div>)}
      {receiptAmountMismatch(sel)&&<div style={{ fontSize:11, color:"#b45309", background:"#fffbeb", border:"1px solid #fcd34d", borderRadius:6, padding:"6px 8px", marginTop:8 }}>⚠️ 明細合計と領収金額が不一致です。領収金額 ¥{fm(sel.amount)} を正とし、明細は参考扱いです。</div>}
      {(()=>{ const items=validItems(sel.items); const tx=calcTax(items); const total=totalFor(sel); return <div style={{ textAlign:"right", marginTop:8, fontSize:13 }}><div style={{ color:"#6b7280" }}>{items.length>0 ? "消費税: " + fm(tx.tax) + "円" : "領収金額"}</div><div style={{ fontWeight:600, fontSize:15 }}>{"合計: " + fm(total) + "円"}</div></div>; })()}
      <div style={{ display:"flex", gap:8, marginTop:14, flexWrap:"wrap" }}>
        {!sel.voidedAt&&!sel.convertedTo&&(sel.docType==="見積書"||sel.docType==="納品書")&&<Btn variant="blue" onClick={()=>convertDoc(sel,"請求書")}>📄 請求書に変換</Btn>}
        {!sel.voidedAt&&sel.docType==="見積書"&&<Btn variant="ghost" onClick={()=>convertDoc(sel,"納品書")}>📋 納品書に変換</Btn>}
        <Btn variant="green" onClick={()=>copyDoc(sel)}>📋 コピー作成（当日）</Btn>
         <Btn variant="red" disabled={Boolean(sel.voidedAt||sel.convertedTo)} onClick={()=>{setVoidTarget(sel);setSel(null);}}>{'\u53d6\u6d88'}</Btn>
        <Btn disabled={Boolean(sel.voidedAt||sel.convertedTo)} onClick={()=>{ setEditTarget(sel); setSel(null); }}>✏️ 編集</Btn>
        <Btn variant="primary" disabled={Boolean(sel.voidedAt)} onClick={()=>generateAndDownloadPDF(sel,co)} style={{ flex:1 }}>📄 PDF</Btn>
      </div>
    </Modal>}
    {voidTarget&&<VoidDocumentModal doc={voidTarget} onClose={()=>setVoidTarget(null)} onSubmit={async(reason,reverse)=>{await db.voidDocument(voidTarget.id,reason,reverse);setHistory(await db.getDocuments());setProducts(await db.getProducts());}}/>}
    {editTarget&&<DocEditModal doc={editTarget} co={co} products={products||[]} onClose={()=>setEditTarget(null)} onSave={async(nd)=>{
      const receiptItems = validItems(nd.items);
      const validationError = validateDocument({ ...nd, items: receiptItems });
      if (validationError) { alert(validationError); return; }
      const normalized = normalizeReceiptForSave({ ...nd, items:receiptItems });
      try {
        const updated = editTarget.id ? await db.updateDocument(editTarget.id, normalized) : await db.saveDocument(normalized,user);
        setHistory(await db.getDocuments());
        setProducts(await db.getProducts());
        setEditTarget(null);
      } catch (e) { alert("編集保存エラー: " + e.message); }
    }}/>}
  </div>;
}

function ProductsView({ products, setProducts, user, initialNegative=false }) {
  const [m, setM] = useState(null);
  const [f, setF] = useState({});
  const [logs, setLogs] = useState([]);
  const [logProduct, setLogProduct] = useState(null);
  const [onlyNegative,setOnlyNegative]=useState(initialNegative);
  const [sortKey, setSortKey] = useState("code");
  const [sortDir, setSortDir] = useState(1);
  const [catFilter, setCatFilter] = useState("全て");
  const [cellFilter, setCellFilter] = useState(null);
  const [receiving, setReceiving] = useState({ qty:"", supplier:"", note:"" });
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustReason,setAdjustReason]=useState("");
  const [stockBusy,setStockBusy]=useState(false);
  const stockLock=useRef(false);
  const categories = [...new Set(products.map(p=>p.category).filter(Boolean))].sort();
  const upd = (k,v) => setF(x=>({...x,[k]:v}));
  const updR = (k,v) => setReceiving(x=>({...x,[k]:v}));
  const selectCell = (key, value) => setCellFilter(prev => prev?.key === key && prev?.value === String(value ?? "") ? null : { key, value: String(value ?? "") });
  const filterableCell = (key, value, children, style={}) => <td title="クリックしてこの内容で絞り込み（再クリックで解除）" onClick={()=>selectCell(key,value)} style={{ padding:"6px 10px", cursor:"pointer", background:cellFilter?.key===key&&cellFilter?.value===String(value??"")?"#dbeafe":undefined, ...style }}>{children}</td>;
  const sort = (key) => { if(sortKey===key) setSortDir(d=>-d); else { setSortKey(key); setSortDir(1); } };
  const filtered = products.filter(p => (!onlyNegative||Number(p.stock)<0) && (catFilter==="全て" || p.category===catFilter) && (!cellFilter || String(p[cellFilter.key]??"")===cellFilter.value));
  const sorted = [...filtered].sort((a,b)=>{
    const av=a[sortKey]||"", bv=b[sortKey]||"";
    if(!isNaN(Number(av))&&!isNaN(Number(bv))) return (Number(av)-Number(bv))*sortDir;
    return String(av).localeCompare(String(bv),"ja")*sortDir;
  });
  const open = (p) => { setF(p||{ name:"", code:"", category:"", origin:"", unit:"kg", price:"", purchasePrice:"", taxRate:8, caseQty:"", qtyPerCase:"", stock:0, note:"" }); setM("edit"); };
  const openLogs = async (p) => { try { setLogProduct(p); setLogs(await getStockLogs(p.id)); setM("logs"); } catch (e) { alert("在庫履歴の取得エラー: " + e.message); } };
  const save = async () => {
    if (!f.name) { alert("商品名は必須です"); return; }
    try { await db.saveProduct(f); setProducts(await db.getProducts()); setM(null); }
    catch(e) { alert("保存エラー: " + e.message); }
  };
  const del = async (id) => {
    if (!confirm("削除しますか？")) return;
    try { await db.deleteProduct(id); setProducts(products.filter(p=>p.id!==id)); }
    catch(e) { alert("削除エラー: " + e.message); }
  };
  const doReceive = async () => {
    if(stockLock.current)return;
    if (!logProduct || !receiving.qty) { alert("数量を入力してください"); return; }
    try {
      stockLock.current=true;setStockBusy(true);
      const newStock = await receiveStock(logProduct.id, logProduct.name, Number(receiving.qty), receiving.supplier, receiving.note, user?.id);
      const prods = await db.getProducts(); setProducts(prods);
      const updated = prods.find(p=>p.id===logProduct.id);
      if (updated) setLogProduct(updated);
      setLogs(await getStockLogs(logProduct.id));
      setReceiving({ qty:"", supplier:"", note:"" });
      alert("入庫完了。現在庫: " + newStock + " " + logProduct.unit);
    } catch(e) { alert("入庫エラー: " + e.message); } finally {stockLock.current=false;setStockBusy(false);}
  };
  const SortTh = ({k, label}) => <th onClick={()=>sort(k)} style={{ padding:"7px 10px", fontWeight:400, textAlign:"left", cursor:"pointer", whiteSpace:"nowrap", userSelect:"none" }}>
    {label + (sortKey===k?(sortDir===1?"▲":"▼"):"")}
  </th>;
  return <div style={{ height:"100%", display:"flex", flexDirection:"column" }}>
    <div style={{ padding:"10px 16px", borderBottom:"1px solid #f0f0f0", display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
      <span style={{ fontWeight:500, fontSize:14 }}>{"商品マスター（" + products.length + "件）"}</span>
      <select style={{ ...SEL, width:110 }} value={catFilter} onChange={e=>setCatFilter(e.target.value)}>
        <option>全て</option>
        {categories.map(c=><option key={c} value={c}>{c}</option>)}
      </select>
      <span style={{ fontSize:11, color:"#9ca3af" }}>▲▼ヘッダーで並び替え・内容をクリックで絞り込み（{filtered.length}件表示）</span>
      {(cellFilter || catFilter!=="全て") && <Btn small onClick={()=>{setCellFilter(null);setCatFilter("全て");}}>✕ フィルタ解除{cellFilter ? `（${({code:"コード",category:"分類",name:"商品名",origin:"産地",unit:"単位",taxRate:"税率"})[cellFilter.key] || cellFilter.key}: ${cellFilter.value}）` : ""}</Btn>}
      <div style={{ marginLeft:"auto", display:"flex", gap:6 }}>
        <Btn variant="primary" small onClick={()=>open(null)}>＋ 新規登録</Btn>
      </div>
    </div>
    <label style={{fontSize:12,display:"block",padding:8}}><input type="checkbox" checked={onlyNegative} onChange={e=>setOnlyNegative(e.target.checked)}/>{"\u30de\u30a4\u30ca\u30b9\u5728\u5eab\u306e\u307f"}</label>
    <div style={{ flex:1, overflowX:"auto", overflowY:"auto" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
        <thead><tr style={{ background:N, color:"#fff" }}>
          <SortTh k="code" label="コード"/>
          <SortTh k="category" label="分類"/>
          <SortTh k="name" label="商品名"/>
          <SortTh k="origin" label="産地"/>
          <SortTh k="unit" label="単位"/>
          <SortTh k="purchasePrice" label="仕入単価"/>
          <SortTh k="price" label="販売単価"/>
          <th style={{ padding:"7px 10px", fontWeight:400 }}>利益率</th>
          <SortTh k="taxRate" label="税率"/>
          <SortTh k="stock" label="在庫"/>
          <th style={{ padding:"7px 10px", fontWeight:400 }}>操作</th>
        </tr></thead>
        <tbody>
          {sorted.map((p,i)=>{
            const margin = (p.purchasePrice&&p.price&&Number(p.price)>0) ? Math.round((1-Number(p.purchasePrice)/Number(p.price))*100) : null;
            return <tr key={p.id} style={{ background:i%2===0?"#fff":"#f9fafb", borderBottom:"1px solid #f0f0f0" }}>
              {filterableCell("code",p.code,p.code,{ color:"#9ca3af" })}
              {filterableCell("category",p.category,p.category&&<span style={{ fontSize:11, background:"#eef2ff", color:"#3730a3", padding:"1px 7px", borderRadius:10 }}>{p.category}</span>)}
              {filterableCell("name",p.name,p.name,{ fontWeight:500 })}
              {filterableCell("origin",p.origin,p.origin)}
              {filterableCell("unit",p.unit,p.unit)}
              <td style={{ padding:"6px 10px", textAlign:"right", color:"#6b7280" }}>{p.purchasePrice?fm(p.purchasePrice)+"円":"-"}</td>
              <td style={{ padding:"6px 10px", textAlign:"right" }}>{p.price?fm(p.price)+"円":"-"}</td>
              <td style={{ padding:"6px 10px", textAlign:"right", color:margin!==null?(margin>=20?"#16a34a":margin>=0?"#d97706":"#dc2626"):"#9ca3af", fontWeight:500 }}>
                {margin!==null ? margin+"%" : "-"}
              </td>
              {filterableCell("taxRate",p.taxRate,p.taxRate + "%")}
              <td style={{ padding:"6px 10px", textAlign:"right", color:Number(p.stock)<0?"#dc2626":"inherit", fontWeight:500 }}>{fm(p.stock)}</td>
              <td style={{ padding:"6px 8px" }}>
                <div style={{ display:"flex", gap:4 }}>
                  <Btn small onClick={()=>openLogs(p)}>📊 履歴/入庫</Btn>
                  <Btn small onClick={()=>open(p)}>編集</Btn>
                  <Btn small variant="red" onClick={()=>del(p.id)}>削除</Btn>
                </div>
              </td>
            </tr>;
          })}
          {sorted.length===0&&<tr><td colSpan={11} style={{ textAlign:"center", padding:32, color:"#9ca3af" }}>{products.length===0?"商品を登録してください":"該当する商品がありません。フィルタを解除してください。"}</td></tr>}
        </tbody>
      </table>
    </div>
    {m==="logs"&&logProduct&&<Modal title={"📦 履歴・入庫: " + logProduct.name} onClose={()=>setM(null)} maxW={540}>
      <div style={{ marginBottom:12, display:"flex", justifyContent:"space-between" }}>
        <span style={{ fontSize:14 }}>{"現在庫: "}<strong style={{ fontSize:18, color:Number(logProduct.stock)<0?"#dc2626":"#111" }}>{fm(logProduct.stock) + " " + logProduct.unit}</strong></span>
      </div>
      <div style={{ background:"#f0fdf4", border:"1px solid #86efac", borderRadius:8, padding:12, marginBottom:14 }}>
        <div style={{ fontWeight:500, fontSize:13, marginBottom:8 }}>📥 入庫登録</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
          <Field label="入庫数量 *"><input style={INP} type="number" value={receiving.qty} onChange={e=>updR("qty",e.target.value)} placeholder="例: 50"/></Field>
          <Field label="仕入先"><input style={INP} value={receiving.supplier} onChange={e=>updR("supplier",e.target.value)} placeholder="〇〇水産"/></Field>
        </div>
        <Field label="備考"><input style={INP} value={receiving.note} onChange={e=>updR("note",e.target.value)} placeholder="任意"/></Field>
        <Btn variant="green" disabled={stockBusy} onClick={doReceive} style={{ marginTop:8 }}>✅ 入庫確定</Btn>
      </div>
      <div style={{ fontWeight:500, fontSize:12, color:"#6b7280", marginBottom:6 }}>入出庫履歴</div>
      <div style={{ maxHeight:260, overflowY:"auto", border:"1px solid #f0f0f0", borderRadius:6 }}>
        {logs.length===0&&<div style={{ textAlign:"center", padding:20, color:"#9ca3af", fontSize:13 }}>履歴がありません</div>}
        {logs.map((log,i)=><div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"7px 10px", borderBottom:"1px solid #f9f9f9", fontSize:12 }}>
          <div>
            <span style={{ color:log.change<0?"#dc2626":"#16a34a", fontWeight:600 }}>{(log.change>0?"+":"") + log.change + " " + logProduct.unit}</span>
            <span style={{ color:"#9ca3af", marginLeft:8 }}>{log.reason}</span>
          </div>
          <span style={{ color:"#9ca3af" }}>{log.created_at?.slice(0,16).replace("T"," ")}</span>
        </div>)}
      </div>
      <div style={{ marginTop:10 }}>
        <Field label="手動調整（±数量）">
          <div style={{ display:"flex", gap:8 }}>
            <input aria-label="\u8abf\u6574\u7406\u7531" style={{...INP,flex:1}} value={adjustReason} onChange={e=>setAdjustReason(e.target.value)} placeholder="\u8abf\u6574\u7406\u7531\uff08\u5fc5\u9808\uff09"/>
            <input id="adj-qty" type="number" value={adjustQty} onChange={e=>setAdjustQty(e.target.value)} placeholder="例: -5 または +10" style={{ ...INP, flex:1 }}/>
            <Btn small variant="primary" onClick={async()=>{
              const v = Number(adjustQty);
              if (!v) { alert("調整数量を入力してください"); return; }
              try {
                if(stockLock.current)return;stockLock.current=true;setStockBusy(true);
                 await db.updateStock(logProduct.id, v,adjustReason);
                const prods = await db.getProducts(); setProducts(prods);
                const updated = prods.find(p=>p.id===logProduct.id);
                if(updated) setLogProduct(updated);
                setLogs(await getStockLogs(logProduct.id));
                setAdjustQty("");setAdjustReason("");
              } catch (e) { alert("在庫調整エラー: " + e.message); } finally{stockLock.current=false;setStockBusy(false);}
            }}>調整</Btn>
          </div>
        </Field>
      </div>
    </Modal>}
    {m==="edit"&&<Modal title={f.id?"商品編集":"商品登録"} onClose={()=>setM(null)}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
        <Field label="商品コード"><input style={INP} value={f.code||""} onChange={e=>upd("code",e.target.value)} placeholder="FG-001"/></Field>
        <Field label="分類">
          <input style={INP} list="product-category-list" value={f.category||""} onChange={e=>upd("category",e.target.value)} placeholder="ふぐ類 / アワビ など"/>
          <datalist id="product-category-list">{[...new Set([...categories,"ふぐ類","赤貝","サザエ","蛤","アサリ","アワビ","ホタテ","蟹類","あんこう","うなぎ"])].map(c=><option key={c} value={c}/>)}</datalist>
        </Field>
        <Field label="商品名 *"><input style={INP} value={f.name||""} onChange={e=>upd("name",e.target.value)} placeholder="韓国産養殖活アワビ"/></Field>
        <Field label="産地"><input style={INP} value={f.origin||""} onChange={e=>upd("origin",e.target.value)} placeholder="韓国産"/></Field>
        <Field label="単位"><input style={INP} value={f.unit||""} onChange={e=>upd("unit",e.target.value)} placeholder="kg"/></Field>
        <Field label="仕入単価（円）"><input style={INP} type="number" value={f.purchasePrice||""} onChange={e=>upd("purchasePrice",e.target.value)}/></Field>
        <Field label="販売単価（円）"><input style={INP} type="number" value={f.price||""} onChange={e=>upd("price",e.target.value)}/></Field>
        <Field label="税率"><select style={SEL} value={f.taxRate||8} onChange={e=>upd("taxRate",Number(e.target.value))}><option value={8}>8%（軽減税率）</option><option value={10}>10%（標準税率）</option></select></Field>
        <Field label="ケース入数"><input style={INP} type="number" value={f.qtyPerCase||""} onChange={e=>upd("qtyPerCase",e.target.value)}/></Field>
        <Field label="現在庫（在庫操作から変更）"><input style={{ ...INP, background:"#f3f4f6" }} type="number" value={f.stock||0} readOnly/></Field>
      </div>
      <Field label="備考"><input style={{ ...INP, marginTop:4 }} value={f.note||""} onChange={e=>upd("note",e.target.value)}/></Field>
      <div style={{ display:"flex", gap:8, marginTop:14, justifyContent:"flex-end" }}>
        <Btn onClick={()=>setM(null)}>キャンセル</Btn>
        <Btn variant="primary" onClick={save}>保存</Btn>
      </div>
    </Modal>}
  </div>;
}

function CustomersView({ customers, setCustomers }) {
  const [m, setM] = useState(null);
  const [f, setF] = useState({});
  const upd = (k,v) => setF(x=>({...x,[k]:v}));
  const open = (c) => { setF(c||{ name:"", code:"", addr:"", contact:"", tel:"", bank:"", dueDays:30, note:"" }); setM("edit"); };
  const save = async () => {
    if (!f.name) { alert("顧客名は必須です"); return; }
    try { await db.saveCustomer(f); setCustomers(await db.getCustomers()); setM(null); }
    catch(e) { alert("保存エラー: " + e.message); }
  };
  const del = async (id) => {
    if (!confirm("削除しますか？")) return;
    try { await db.deleteCustomer(id); setCustomers(customers.filter(c=>c.id!==id)); }
    catch(e) { alert("削除エラー: " + e.message); }
  };
  return <div style={{ height:"100%", display:"flex", flexDirection:"column" }}>
    <div style={{ padding:"12px 18px", borderBottom:"1px solid #f0f0f0", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
      <span style={{ fontWeight:500 }}>{"顧客マスター（" + customers.length + "件）"}</span>
      <Btn variant="primary" small onClick={()=>open(null)}>＋ 新規登録</Btn>
    </div>
    <div style={{ flex:1, overflowY:"auto" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
        <thead><tr style={{ background:N, color:"#fff" }}>
          {["コード","顧客名","住所","担当者","TEL",""].map((h,i)=><th key={i} style={{ padding:"7px 10px", fontWeight:400, textAlign:"left" }}>{h}</th>)}
        </tr></thead>
        <tbody>
          {customers.map((c,i)=><tr key={c.id} style={{ background:i%2===0?"#fff":"#f9fafb", borderBottom:"1px solid #f0f0f0" }}>
            <td style={{ padding:"7px 10px", color:"#9ca3af" }}>{c.code}</td>
            <td style={{ padding:"7px 10px", fontWeight:500 }}>{c.name}</td>
            <td style={{ padding:"7px 10px", fontSize:12, color:"#6b7280" }}>{c.addr}</td>
            <td style={{ padding:"7px 10px" }}>{c.contact}</td>
            <td style={{ padding:"7px 10px" }}>{c.tel}</td>
            <td style={{ padding:"7px 10px" }}>
              <div style={{ display:"flex", gap:5 }}>
                <Btn small onClick={()=>open(c)}>編集</Btn>
                <Btn small variant="red" onClick={()=>del(c.id)}>削除</Btn>
              </div>
            </td>
          </tr>)}
          {customers.length===0&&<tr><td colSpan={6} style={{ textAlign:"center", padding:32, color:"#9ca3af" }}>顧客を登録してください</td></tr>}
        </tbody>
      </table>
    </div>
    {m==="edit"&&<Modal title={f.id?"顧客編集":"顧客登録"} onClose={()=>setM(null)}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
        <Field label="顧客コード"><input style={INP} value={f.code||""} onChange={e=>upd("code",e.target.value)} placeholder="C001"/></Field>
        <Field label="顧客名 *"><input style={INP} value={f.name||""} onChange={e=>upd("name",e.target.value)} placeholder="平家茶屋"/></Field>
        <Field label="住所"><input style={INP} value={f.addr||""} onChange={e=>upd("addr",e.target.value)}/></Field>
        <Field label="担当者"><input style={INP} value={f.contact||""} onChange={e=>upd("contact",e.target.value)}/></Field>
        <Field label="TEL"><input style={INP} value={f.tel||""} onChange={e=>upd("tel",e.target.value)}/></Field>
        <Field label="支払いサイト（日）"><input style={INP} type="number" value={f.dueDays||30} onChange={e=>upd("dueDays",e.target.value)}/></Field>
      </div>
      <Field label="振込先（請求書デフォルト）"><input style={{ ...INP, marginTop:4 }} value={f.bank||""} onChange={e=>upd("bank",e.target.value)} placeholder="りそな銀行..."/></Field>
      <Field label="備考"><input style={{ ...INP, marginTop:4 }} value={f.note||""} onChange={e=>upd("note",e.target.value)}/></Field>
      <div style={{ display:"flex", gap:8, marginTop:14, justifyContent:"flex-end" }}>
        <Btn onClick={()=>setM(null)}>キャンセル</Btn>
        <Btn variant="primary" onClick={save}>保存</Btn>
      </div>
    </Modal>}
  </div>;
}

function SealUploader({ label, value, onChange }) {
  const ref = useRef(null);
  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2*1024*1024) { alert("2MB以下の画像を選択してください"); return; }
    const reader = new FileReader();
    reader.onload = (ev) => onChange(ev.target.result);
    reader.readAsDataURL(file);
  };
  return <div style={{ marginBottom:16 }}>
    <label style={{ display:"block", fontSize:12, color:"#6b7280", marginBottom:8, fontWeight:500 }}>{label}</label>
    <div style={{ display:"flex", alignItems:"center", gap:14 }}>
      <div style={{ width:72, height:72, border:"1px dashed #d1d5db", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", background:"#f9fafb", flexShrink:0, overflow:"hidden" }}>
        {value?<img src={value} style={{ width:"100%", height:"100%", objectFit:"contain" }} alt="印鑑"/>:<span style={{ fontSize:11, color:"#9ca3af", textAlign:"center" }}>未設定</span>}
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        <input ref={ref} type="file" accept="image/png,image/jpeg,image/gif" style={{ display:"none" }} onChange={handleFile}/>
        <Btn small onClick={()=>ref.current?.click()}>📁 画像を選択</Btn>
        {value&&<Btn small variant="red" onClick={()=>onChange("")}>削除</Btn>}
        <div style={{ fontSize:11, color:"#9ca3af" }}>PNG推奨 / 2MB以下<br/>背景透過PNGが綺麗です</div>
      </div>
    </div>
  </div>;
}

function SettingsView({ co, setCo }) {
  const [c, setC] = useState({ ...co });
  const save = async () => { try { await db.saveCompany(c); setCo(c); alert("保存しました"); } catch (e) { alert("設定保存エラー: " + e.message); } };
  const f = (label, key, ph) => <Field label={label}><input style={INP} value={c[key]||""} onChange={e=>setC(x=>({...x,[key]:e.target.value}))} placeholder={ph}/></Field>;
  return <div style={{ padding:20, maxWidth:560, overflowY:"auto", height:"100%" }}>
    <div style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:10, padding:18, marginBottom:14 }}>
      <div style={{ fontWeight:600, fontSize:14, marginBottom:14, paddingBottom:8, borderBottom:"1px solid #f0f0f0" }}>🏢 自社情報</div>
      {f("会社名","name","株式会社 神戸大商")}
      {f("担当者名","manager","経理担当　秦")}
      {f("住所","addr","〒532-0011 大阪市淀川区...")}
      {f("TEL","tel","TEL:06-6379-3451")}
      {f("FAX","fax","FAX:06-6379-3461")}
      {f("適格請求書登録番号","regNo","T4120001218286")}
      {f("振込先A（主）","bankA","りそな銀行 新大阪駅前支店 普通0436583")}
      {f("振込先B（副）","bankB","三井住友銀行 神戸営業部 普通預金1663502")}
      {f("管理者メール（カンマ区切り）","adminEmails","shin@kobedaisho.com")}
      <div style={{ fontSize:11, color:"#6b7280", marginBottom:10 }}>管理者は全員の発行履歴・明細CSVを閲覧できます。普通ユーザーは自分の作成分のみです。</div>
      <Btn variant="primary" onClick={save} small>保存</Btn>
    </div>
    <div style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:10, padding:18, marginBottom:14 }}>
      <div style={{ fontWeight:600, fontSize:14, marginBottom:4, paddingBottom:8, borderBottom:"1px solid #f0f0f0" }}>🖼️ 会社ロゴ（左上に表示）</div>
      <div style={{ fontSize:12, color:"#6b7280", marginBottom:12, paddingTop:6 }}>サイドバーのDAISHO文字の代わりに表示されます。</div>
      <SealUploader label="会社ロゴ" value={c.logoImg||""} onChange={v=>setC(x=>({...x,logoImg:v}))}/>
      <Btn variant="primary" onClick={save} small>ロゴを保存</Btn>
    </div>
    <div style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:10, padding:18 }}>
      <div style={{ fontWeight:600, fontSize:14, marginBottom:4, paddingBottom:8, borderBottom:"1px solid #f0f0f0" }}>🔴 印鑑設定（PDFに自動印刷）</div>
      <div style={{ fontSize:12, color:"#6b7280", marginBottom:12, paddingTop:6 }}>社印は書類右上の会社情報横に、担当印は書類下部に印刷されます。</div>
      <SealUploader label="社印（丸印・角印）" value={c.sealImg||""} onChange={v=>setC(x=>({...x,sealImg:v}))}/>
      <SealUploader label="担当者印" value={c.personSealImg||""} onChange={v=>setC(x=>({...x,personSealImg:v}))}/>
      <div style={{ background:"#fef9ec", border:"1px solid #fcd34d", borderRadius:6, padding:"8px 12px", fontSize:12, color:"#92400e", marginBottom:12 }}>
        ⚠️ 印鑑画像はSupabaseのDBに保存されます。
      </div>
      <Btn variant="primary" onClick={save} small>印鑑を保存</Btn>
    </div>
  </div>;
}

function LoginScreen({ onSignIn }) {
  const [loading, setLoading] = useState(false);
  return <div style={{ minHeight:"100vh", background:"linear-gradient(135deg,#0f1f44 0%,#1a3a6e 100%)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
    <div style={{ width:"100%", maxWidth:400, textAlign:"center" }}>
      <div style={{ border:"3px solid #2a6a2a", borderRadius:6, display:"inline-block", padding:"6px 20px", marginBottom:16 }}>
        <span style={{ fontSize:24, fontWeight:"bold", color:"#4ade80", letterSpacing:4 }}>DAISHO</span>
      </div>
      <h1 style={{ color:"#fff", fontSize:18, fontWeight:300, letterSpacing:2, marginBottom:6 }}>業務書類 AIシステム</h1>
      <p style={{ color:"rgba(255,255,255,0.4)", fontSize:13, marginBottom:28 }}>株式会社神戸大商</p>
      <div style={{ background:"rgba(255,255,255,0.06)", border:"0.5px solid rgba(255,255,255,0.15)", borderRadius:12, padding:26 }}>
        <p style={{ color:"rgba(255,255,255,0.5)", fontSize:13, marginBottom:18 }}>Google Workspaceアカウントでログイン</p>
        <button onClick={async()=>{ setLoading(true); try { await onSignIn(); } catch (e) { alert("ログインエラー: " + e.message); } finally { setLoading(false); } }} disabled={loading}
          style={{ display:"flex", alignItems:"center", gap:12, width:"100%", padding:"12px 16px", background:"#fff", border:"none", borderRadius:8, cursor:loading?"wait":"pointer", fontSize:14, fontFamily:"inherit", fontWeight:500, justifyContent:"center", opacity:loading?0.7:1 }}>
          <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/></svg>
          {loading?"ログイン中...":"Googleでログイン"}
        </button>
      </div>
    </div>
  </div>;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [appLoading, setAppLoading] = useState(true);
  const [history, setHistory] = useState([]);
  const [co, setCo] = useState(DEFAULT_CO);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [tab, setTab] = useState("home");
  const [masterTab,setMasterTab]=useState("customers");
  const [routeFilter,setRouteFilter]=useState("");
  const [loadError,setLoadError]=useState("");
  const [sideOpen, setSideOpen] = useState(window.innerWidth > 600);

  useEffect(()=>{
    supabase.auth.getSession().then(({ data:{ session }, error })=>{ if (error) console.error(error); setSession(session); setAppLoading(false); }).catch((error)=>{ console.error(error); setAppLoading(false); });
    const { data:{ subscription } } = supabase.auth.onAuthStateChange((_e,s)=>setSession(s));
    return ()=>subscription.unsubscribe();
  }, []);

  useEffect(()=>{
    if (!session) return;
    (async()=>{
      try {
        const [docs, company, prods, custs] = await Promise.all([db.getDocuments(), db.getCompany(), db.getProducts(), db.getCustomers()]);
        setHistory(docs||[]);
        if (company) setCo({...DEFAULT_CO,...company});
        setProducts(prods||[]);
        setCustomers(custs||[]);
      } catch(e) { setLoadError(e.message); }
    })();
  }, [session]);

  useEffect(()=>{ const h=()=>setSideOpen(window.innerWidth>600); window.addEventListener("resize",h); return()=>window.removeEventListener("resize",h); },[]);

  if (appLoading) return <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", fontFamily:"sans-serif", color:"#6b7280", fontSize:14 }}>読み込み中...</div>;
  if (!session) return <LoginScreen onSignIn={signInWithGoogle}/>;

  const user = session.user;
  const name = user.user_metadata?.full_name || user.email;
  const avatar = user.user_metadata?.avatar_url
    ? <img src={user.user_metadata.avatar_url} style={{ width:28, height:28, borderRadius:"50%" }} alt="avatar"/>
    : <div style={{ width:28, height:28, borderRadius:"50%", background:"rgba(37,99,235,0.5)", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:12, fontWeight:600 }}>{name.charAt(0)}</div>;

  const todayCount = (history||[]).filter(h=>h.savedAt?.slice(0,10)===tod()).length;
  const TABS = [["home","\u2302","\u4eca\u65e5\u306e\u696d\u52d9"],["chat","\u270e","\u8ca9\u58f2"],["history","\u2261","\u8acb\u6c42\u30fb\u767a\u884c\u5c65\u6b74"],["products","\u25a6","\u5728\u5eab\u30fb\u5546\u54c1"],["masters","\u2699","\u30de\u30b9\u30bf\u30fc\u30fb\u8a2d\u5b9a"]];

  return <div style={{ display:"flex", height:"100vh", fontFamily:'"Hiragino Sans","Yu Gothic UI","Meiryo","Noto Sans CJK JP",sans-serif', background:"#f9fafb" }}>
    <aside style={{ width:sideOpen?190:50, background:N, display:"flex", flexDirection:"column", flexShrink:0, transition:"width .18s", overflow:"hidden" }}>
      <div style={{ padding:"12px 10px", borderBottom:"0.5px solid rgba(255,255,255,0.1)", minWidth:190 }}>
        {sideOpen&&<div>
          {co.logoImg
            ? <img src={co.logoImg} style={{ height:34, maxWidth:140, objectFit:"contain", display:"block", marginBottom:4 }} alt="logo"/>
            : <div style={{ border:"2px solid #2a6a2a", borderRadius:4, display:"inline-block", padding:"2px 8px", marginBottom:4 }}><span style={{ fontSize:12, fontWeight:"bold", color:"#4ade80", letterSpacing:2 }}>DAISHO</span></div>
          }
          <div style={{ color:"rgba(255,255,255,0.35)", fontSize:10 }}>業務書類 AIシステム</div>
        </div>}
      </div>
      {sideOpen&&<div style={{ padding:"7px 10px", borderBottom:"0.5px solid rgba(255,255,255,0.1)", display:"flex", alignItems:"center", gap:8 }}>
        {avatar}
        <div style={{ overflow:"hidden" }}>
          <div style={{ color:"rgba(255,255,255,0.8)", fontSize:12, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{name}</div>
          <div style={{ color:"rgba(255,255,255,0.35)", fontSize:10 }}>{user.email}</div>
        </div>
      </div>}
      <nav style={{ flex:1, padding:"5px 0", overflowY:"auto" }}>
        {TABS.map(([id,icon,label])=><button key={id} onClick={()=>{setRouteFilter("");setTab(id);}} style={{ display:"flex", alignItems:"center", gap:10, width:"100%", padding:"10px 11px", border:"none", cursor:"pointer", fontSize:12, background:tab===id?"rgba(255,255,255,0.12)":"transparent", color:tab===id?"#fff":"rgba(255,255,255,0.5)", borderLeft:tab===id?"3px solid #60a5fa":"3px solid transparent", textAlign:"left", fontFamily:"inherit", position:"relative" }}>
          <span style={{ fontSize:15, flexShrink:0 }}>{icon}</span>
          {sideOpen&&<span style={{ whiteSpace:"nowrap" }}>{label}</span>}
          {id==="history"&&todayCount>0&&<span style={{ position:"absolute", top:8, right:8, background:"#dc2626", color:"#fff", borderRadius:10, fontSize:10, padding:"1px 5px" }}>{todayCount}</span>}
        </button>)}
      </nav>
      <div style={{ padding:8, borderTop:"0.5px solid rgba(255,255,255,0.1)" }}>
        <button onClick={()=>supabase.auth.signOut()} style={{ width:"100%", padding:"7px", border:"0.5px solid rgba(255,255,255,0.15)", borderRadius:6, background:"transparent", color:"rgba(255,255,255,0.4)", cursor:"pointer", fontSize:11, fontFamily:"inherit", whiteSpace:"nowrap" }}>
          {sideOpen?"ログアウト":"→"}
        </button>
        {sideOpen&&<div title={"ビルド日時(UTC): " + __BUILD_TIME__} style={{ marginTop:6, textAlign:"center", color:"rgba(255,255,255,0.28)", fontSize:9, lineHeight:1.5, whiteSpace:"nowrap" }}>
          {"v" + __APP_VERSION__ + " · " + __GIT_COMMIT__}<br/>{__BUILD_TIME__ + " UTC"}
        </div>}
      </div>
    </aside>
    <main style={{ flex:1, overflow:"hidden", display:"flex", flexDirection:"column", background:"#fff" }}>
      <div style={{ padding:"10px 18px", borderBottom:"1px solid #f0f0f0", display:"flex", alignItems:"center", gap:8 }}>
        <button onClick={()=>setSideOpen(x=>!x)} style={{ background:"none", border:"none", cursor:"pointer", color:"#9ca3af", fontSize:18, padding:4, flexShrink:0 }}>☰</button>
        <h2 style={{ fontSize:14, fontWeight:500 }}>
          {tab==="home"&&"\u4eca\u65e5\u306e\u696d\u52d9"}
          {tab==="masters"&&"\u30de\u30b9\u30bf\u30fc\u30fb\u8a2d\u5b9a"}
          {tab==="chat"&&"💬 書類作成（AI + 直接入力）"}
          {tab==="history"&&("📋 発行履歴（計" + (history||[]).length + "件）")}
          {tab==="products"&&"📦 商品マスター"}
          {tab==="customers"&&"👥 顧客マスター"}
          {tab==="settings"&&"⚙️ 設定"}
        </h2>
      </div>
      {loadError&&<div role="alert" style={{padding:14,background:'#fef2f2',color:'#b91c1c'}}>{'\u30c7\u30fc\u30bf\u53d6\u5f97\u5931\u6557: '}{loadError} <button onClick={()=>window.location.reload()}>{'\u518d\u8aad\u8fbc'}</button></div>}
      <div style={{ flex:1, overflow:"hidden" }}>
        {tab==="home"&&<HomeDashboard history={history} products={products} onNavigate={(tab,filter="")=>{setRouteFilter(filter);setTab(tab);}}/>}
        {tab==="masters"&&<div style={{display:'flex',flexDirection:'column',height:'100%'}}><div style={{padding:10,display:'flex',gap:8}}><Btn onClick={()=>setMasterTab('customers')}>{'\u9867\u5ba2\u30de\u30b9\u30bf\u30fc'}</Btn><Btn onClick={()=>setMasterTab('settings')}>{'\u4f1a\u793e\u30fb\u8a2d\u5b9a'}</Btn></div><div style={{flex:1,overflow:'auto'}}>{masterTab==='customers'?<CustomersView customers={customers} setCustomers={setCustomers}/>:<SettingsView co={co} setCo={setCo}/>}</div></div>}

        {tab==="chat"&&<ChatView co={co} products={products} customers={customers} history={history} setHistory={setHistory} setProducts={setProducts} setCustomers={setCustomers} user={user}/>}
        {tab==="history"&&<HistoryView initialStatus={routeFilter||"active"} history={history} setHistory={setHistory} co={co} products={products} setProducts={setProducts} user={user}/>}
        {tab==="products"&&<ProductsView initialNegative={routeFilter==="negative"} products={products} setProducts={setProducts} user={user}/>}
        {tab==="customers"&&<CustomersView customers={customers} setCustomers={setCustomers}/>}
        {tab==="settings"&&<SettingsView co={co} setCo={setCo}/>}
      </div>
    </main>
  </div>;
}
