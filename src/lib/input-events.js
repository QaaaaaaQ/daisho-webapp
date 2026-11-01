import {db,isEmployeePreview} from './supabase.js';

export const inputEventLabels={
  saved:'保存',validation_invalid:'入力内容の確認',customer_missing:'取引先未入力・未登録',customer_ambiguous:'顧客名の重複',customer_code_missing:'顧客コード未入力',
  details_missing:'明細未入力',product_category_missing:'商品分類未登録',tax_rate_invalid:'税率の確認',amount_invalid:'金額の確認',
  quantity_invalid:'数量の確認',price_invalid:'数量・単価・金額の確認',date_missing:'日付の確認',item_name_missing:'品名未入力',
  receipt_amount_mismatch:'領収金額と明細の不一致',reservation_invalid:'予約情報の確認',save_failed:'保存エラー',conflict:'他の更新と競合',insufficient_stock:'在庫不足',network_error:'通信エラー',
};

export function validationEvent(message) {
  const text=String(message||'');
  if(/取引先/.test(text))return {code:'customer_missing',field:'customer'};
  if(/税率/.test(text))return {code:'tax_rate_invalid',field:'items'};
  if(/数量×単価|単価/.test(text))return {code:'price_invalid',field:'items'};
  if(/数量/.test(text))return {code:'quantity_invalid',field:'items'};
  if(/品名|商品名/.test(text))return {code:'item_name_missing',field:'items'};
  if(/日付/.test(text))return {code:'date_missing',field:'document'};
  if(/金額/.test(text))return {code:'amount_invalid',field:'amount'};
  if(/明細/.test(text))return {code:'details_missing',field:'items'};
  return {code:'validation_invalid',field:'document'};
}

export function failureEvent(error) {
  const text=String(error?.message||error||'');
  if(/不足|在庫が一致/.test(text))return {code:'insufficient_stock',field:'inventory'};
  if(/更新され|競合|再読込/.test(text))return {code:'conflict',field:'document'};
  if(/network|fetch|通信|接続/i.test(text))return {code:'network_error',field:'document'};
  return {code:'save_failed',field:'document'};
}

export async function recordInputEvents(docType,eventType,issues,documentId=null) {
  if(isEmployeePreview())return true;
  if(!['納品書','請求書','領収書','見積書'].includes(docType))docType='不明';
  try {
    for(const issue of issues) await db.recordInputEvent({docType,eventType,issueCode:issue.code,fieldName:issue.field,documentId});
    return true;
  } catch { return false; }
}
