import {useState} from 'react';
import {db} from '../lib/supabase.js';
import {findCustomerMaster} from '../lib/pca-sales.js';
import {normalizeName, productForItem, SALES_SUBACCOUNT_BY_CATEGORY} from '../lib/pca-products.js';
import {pcaInputIssues} from '../lib/input-quality.js';

const box={padding:12,background:'#fffbeb',border:'1px solid #fcd34d',borderRadius:8,margin:'10px 0',fontSize:12,color:'#78350f'};
const input={padding:'7px 8px',font:'inherit',border:'1px solid #d1d5db',borderRadius:6,minHeight:38,maxWidth:'100%'};
const button={...input,background:'#fff',cursor:'pointer',color:'#1a2744'};

function CustomerCode({doc,customers,onCustomersChange}) {
  const match=findCustomerMaster(customers,doc.customer);
  const customer=match.customer;
  const [code,setCode]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  if(match.ambiguous || !String(doc.customer||'').trim() || (customer && String(customer.code||'').trim()))return null;
  const save=async()=>{
    if(!code.trim()||busy)return;
    setBusy(true);setError('');
    try{
      const latest=await db.getCustomers();const current=findCustomerMaster(latest,doc.customer);
      if(current.ambiguous)throw new Error('同じ取引先が複数あります。顧客マスターを確認してください。');
      if(current.customer){
        if(String(current.customer.code||'').trim())throw new Error('顧客コードが既に登録されています。最新情報を確認してください。');
        await db.setCustomerCode(current.customer.id,current.customer.code,code.trim());
      } else {
        await db.saveCustomer({name:String(doc.customer).trim(),code:code.trim(),dueDays:30});
      }
      onCustomersChange(await db.getCustomers());setCode('');
    }catch(e){setError(e.message);}finally{setBusy(false);}
  };
  return <div style={{marginTop:8,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
    <label>顧客コード <input aria-label="PCA顧客コード" style={input} value={code} onChange={e=>setCode(e.target.value)}/></label>
    <button type="button" style={button} disabled={busy||!code.trim()} onClick={save}>{customer?'顧客コードを登録':'顧客とコードを登録'}</button>
    {error&&<span role="alert">{error}</span>}
  </div>;
}

function ProductCategory({item,index,products,onProductsChange,onItemsChange}) {
  const resolved=productForItem(item,products);
  const exact=(products||[]).filter(p=>normalizeName(p.name)===normalizeName(item.name));
  const product=(item.productId && products.find(p=>p.id===item.productId)) || (exact.length===1?exact[0]:null);
  const [category,setCategory]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  if(resolved?.category && SALES_SUBACCOUNT_BY_CATEGORY[resolved.category])return null;
  if(!String(item.name||'').trim())return null;
  const canCreate=!product && exact.length===0 && !item.productId;
  const save=async()=>{
    if(!category||busy)return;
    setBusy(true);setError('');
    try{
      if(product){await db.setProductCategory(product.id,product.category,category);}
      else if(canCreate){
        const fresh=await db.getProducts();
        if(fresh.some(p=>normalizeName(p.name)===normalizeName(item.name)))throw new Error('同名の商品が登録されました。品名を選び直してください。');
        if(!item.unit || ![8,10].includes(Number(item.taxRate)) || !Number.isFinite(Number(item.price)))throw new Error('単位・単価・税率を入力してください。');
        await db.saveProduct({name:String(item.name).trim(),code:'',origin:item.origin||'',unit:item.unit,price:Number(item.price),taxRate:Number(item.taxRate),category});
      } else throw new Error('品名を商品マスターから選び直してください。');
      const fresh=await db.getProducts();onProductsChange(fresh);
      if(canCreate){
        const matches=fresh.filter(p=>normalizeName(p.name)===normalizeName(item.name));
        if(matches.length===1)onItemsChange(index,{...item,productId:matches[0].id,productCode:matches[0].code});
      }
      setCategory('');
    }catch(e){setError(e.message);}finally{setBusy(false);}
  };
  return <div style={{marginTop:8,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
    <span>明細 {index+1}：{item.name}</span>
    {(product||canCreate)?<><label>分類 <select aria-label={`明細 ${index+1} の商品分類`} style={input} value={category} onChange={e=>setCategory(e.target.value)}><option value="">選択してください</option>{Object.entries(SALES_SUBACCOUNT_BY_CATEGORY).map(([name,code])=><option key={name} value={name}>{name}（{code}）</option>)}</select></label><button type="button" style={button} disabled={busy||!category} onClick={save}>{product?'分類を登録':'商品を登録'}</button></>:<span>品名を商品マスターから選び直してください。</span>}
    {error&&<span role="alert">{error}</span>}
  </div>;
}

export function PcaReadiness({doc,customers,products,onCustomersChange,onProductsChange,onItemsChange}) {
  if(!['請求書','領収書'].includes(doc.docType))return null;
  const issues=pcaInputIssues(doc,customers,products);
  if(!issues.length)return <div role="status" style={{...box,background:'#f0fdf4',border:'1px solid #86efac',color:'#166534'}}>PCA出力に必要な項目を確認しました。</div>;
  return <div style={box} role="status"><strong>PCA出力のため保存前に確認</strong>
    <ul style={{margin:'6px 0',paddingLeft:20}}>{issues.map((issue,index)=><li key={`${issue.code}-${issue.field}-${index}`}>{issue.message}</li>)}</ul>
    {doc.docType==='請求書'&&<CustomerCode key={doc.customer} doc={doc} customers={customers} onCustomersChange={onCustomersChange}/>}
    {(doc.items||[]).map((item,index)=>item && <ProductCategory key={`${index}-${item.productId||item.name}`} item={item} index={index} products={products} onProductsChange={onProductsChange} onItemsChange={onItemsChange}/>)}
  </div>;
}
