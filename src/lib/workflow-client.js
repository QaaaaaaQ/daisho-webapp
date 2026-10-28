// Retry identifiers survive a page reload without storing business data.
export function createWorkflowClient(rpc, getActor, storage = null) {
  const running = new Map();
  const pending = new Map();
  return async function workflow(action, payload) {
    const actor = await getActor();
    if (!actor) throw new Error('\u30ed\u30b0\u30a4\u30f3\u304c\u5fc5\u8981\u3067\u3059');
    const bytes = new TextEncoder().encode(JSON.stringify([actor, action, payload]));
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2,'0')).join('');
    const key = 'daisho-workflow-v2:' + hash;
    if (running.has(key)) return running.get(key);
    let id = pending.get(key);
    try { id ||= storage?.getItem(key); } catch { /* Storage may be disabled. */ }
    id ||= crypto.randomUUID();
    pending.set(key,id);
    try { storage?.setItem(key,id); } catch { /* In-memory retry remains safe. */ }
    const clear = () => { pending.delete(key); try { storage?.removeItem(key); } catch {} };
    const promise = (async()=>{
      const {data,error} = await rpc('sales_workflow',{p_action:action,p_payload:payload,p_request_id:id});
      if (error) {
        // An HTTP/database rejection is definitive. Transport failures are ambiguous.
        if (error.code && !String(error.code).startsWith('FETCH')) clear();
        if (error.code === 'PGRST202') throw new Error('\u30b5\u30fc\u30d0\u30fc\u306e\u66f4\u65b0\u304c\u672a\u9069\u7528\u3067\u3059\u3002\u4fdd\u5b58\u3092\u4e2d\u6b62\u3057\u307e\u3057\u305f');
        throw error;
      }
      if (!data || (action === 'adjust' ? !Number.isFinite(Number(data.stock)) : !data.document?.id)) {
        throw new Error('\u4fdd\u5b58\u7d50\u679c\u3092\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093\u3002\u518d\u8a66\u884c\u3057\u3066\u304f\u3060\u3055\u3044');
      }
      clear();
      return data;
    })().finally(()=>running.delete(key));
    running.set(key,promise);
    return promise;
  };
}
export function mapDocument(row) {
  return {
    id:row.id,docType:row.doc_type,docNo:row.doc_no,date:row.date,customer:row.customer,
    subject:row.subject,dueDate:row.due_date,bank:row.bank,note:row.note,amount:row.amount,
    description:row.description,toAddr:row.to_addr,toContact:row.to_contact,items:row.items||[],
    expiryDate:row.expiry_date,conditions:row.conditions,savedAt:row.created_at,
    savedBy:row.created_by_name,savedByEmail:row.created_by_email,createdBy:row.created_by,
    updatedAt:row.updated_at,stockManaged:row.stock_managed ?? null,voidedAt:row.voided_at,
    voidReason:row.void_reason,convertedTo:row.converted_to_document_id,convertedAt:row.converted_at,
    sourceIds:row.source_document_ids||[],taxSummary:row.tax_summary,workflowVersion:row.workflow_version
  };
}
export function isBillable(doc) {
  return doc.docType==='\u7d0d\u54c1\u66f8' && !doc.voidedAt && !doc.convertedTo;
}
export function documentStatus(doc) {
  if(doc.voidedAt) return '\u53d6\u6d88\u6e08';
  if(doc.convertedTo) return '\u8acb\u6c42\u66f8\u306b\u307e\u3068\u3081\u6e08';
  if(doc.stockManaged==null) return '\u65e7\u66f8\u985e\u30fb\u5728\u5eab\u8981\u78ba\u8a8d';
  return doc.stockManaged ? '\u51fa\u5eab\u8a18\u9332\u3042\u308a' : '\u5728\u5eab\u79fb\u52d5\u306a\u3057';
}
