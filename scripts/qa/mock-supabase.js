import {mapDocument} from '../../src/lib/workflow-client.js';
const data=()=>window.__fixtures;
const clone=v=>JSON.parse(JSON.stringify(v));
export const supabase={auth:{getSession:async()=>({data:{session:data().session}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>{}},from:()=>({update:()=>({eq:async()=>({})})})};
export const db={
 getDocuments:async()=>clone(data().docs).map(mapDocument),getProducts:async()=>clone(data().products).map(p=>({...p,taxRate:p.tax_rate})),
 getCustomers:async()=>[{id:'c1',name:'Demo buyer 1',code:'C-001'}],getCompany:async()=>({name:'DAISHO / TEST DATA',adminEmails:'test@example.invalid',logoImg:'',sealImg:'',personSealImg:''}),
 voidDocument:async(id,reason,reverseStock=false)=>{
  window.__requests.push({p_action:'void',p_payload:{id,reason,reverseStock}});
  const d=data().docs.find(d=>d.id===id);d.voided_at=new Date().toISOString();d.void_reason=reason;return mapDocument(d);
 },
 saveDocument:async(doc)=>{
  window.__requests.push({p_action:'create',p_payload:{doc}});
  const d={id:'55555555-5555-4555-8555-'+String(data().docs.length+1).padStart(12,'0'),doc_type:doc.docType,date:doc.date,customer:doc.customer,items:doc.items,doc_no:'DEL-NEW',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),stock_managed:doc.stockManaged};
  data().docs.unshift(d);return {...mapDocument(d),_effects:{newProducts:[],stockLogs:[{name:'Demo item',qty:2}]}};
 }
};
export const signInWithGoogle=async()=>{};
export const aiParse=async()=>({need_info:false,doc:{docType:'\u7d0d\u54c1\u66f8',date:'2026-10-28',customer:'Demo buyer 1',items:clone(data().docs[1].items)}});
export const aiChat=async()=>'';
export const getStockLogs=async()=>[];
export const receiveStock=async()=>100;
export const autoRegisterAndStock=async(doc)=>doc._effects||{newProducts:[],stockLogs:[]};
