import { findCustomerMaster } from './pca-sales.js';
import { productForItem, SALES_SUBACCOUNT_BY_CATEGORY } from './pca-products.js';
import { allocatePcaTax } from './pca-allocation.js';
import { validateDocument } from './domain.js';

const validDate=value=>{
  const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!match)return false;
  const d=new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0,10)===value;
};

// These stable codes also describe an input event without storing entered values.
export function pcaInputIssues(doc, customers = [], products = []) {
  if (!['請求書', '領収書'].includes(doc?.docType)) return [];
  const issues = [];
  if (validateDocument(doc)) issues.push({code:'validation_invalid',field:'document',message:validateDocument(doc)});
  if (!validDate(doc.date)) issues.push({code:'date_missing',field:'document',message:'日付を入力してください。'});
  const items = (doc.items || []).filter(item => item && !item.receiptTaxSummary &&
    (String(item.name || '').trim() || Number(item.amount || 0) !== 0));
  if (!items.length) issues.push({ code:'details_missing', field:'items', message:'PCA出力には商品明細が必要です。' });
  if (doc.docType === '請求書' && String(doc.customer || '').trim()) {
    const match = findCustomerMaster(customers, doc.customer);
    if (match.ambiguous) issues.push({ code:'customer_ambiguous', field:'customer', message:'顧客マスターの取引先が重複しています。' });
    else if (!match.customer) issues.push({ code:'customer_missing', field:'customer', message:'取引先を顧客マスターに登録してください。' });
    else if (!String(match.customer.code || '').trim()) issues.push({ code:'customer_code_missing', field:'customer_code', message:'顧客マスターのコードを入力してください。' });
  }
  items.forEach((item,index)=>{
    if(doc.docType==='請求書'&&!validDate(item.date||doc.date))
      issues.push({code:'date_missing',field:'document',message:`明細 ${index+1}: 日付を確認してください。`});
    const product=productForItem(item,products);
    if(!product?.category || !SALES_SUBACCOUNT_BY_CATEGORY[product.category])
      issues.push({code:'product_category_missing',field:`items.${index}.category`,message:`明細 ${index+1}: 商品マスターの分類を確認してください。`});
    if(![8,10].includes(Number(item.taxRate)))
      issues.push({code:'tax_rate_invalid',field:`items.${index}.taxRate`,message:`明細 ${index+1}: 税率を確認してください。`});
    if(!Number.isFinite(Number(item.amount)) || Number(item.amount)<=0)
      issues.push({code:'amount_invalid',field:`items.${index}.amount`,message:`明細 ${index+1}: 金額を確認してください。`});
  });
  if(doc.docType==='領収書' && items.length && Number(doc.amount)>0) {
    try {
      const lines=items.map(item=>({rate:Number(item.taxRate),included:Boolean(item.taxIncluded),originalAmount:Number(item.amount),tax:0,gross:0}));
      allocatePcaTax(lines);
      if(!Number.isSafeInteger(Number(doc.amount)) || Number(doc.amount)!==lines.reduce((sum,line)=>sum+line.gross,0))
        issues.push({code:'receipt_amount_mismatch',field:'amount',message:'領収金額と明細合計が一致しません。入力内容を確認してください。'});
    } catch { /* Field-specific issues are already displayed. */ }
  }
  return issues;
}
