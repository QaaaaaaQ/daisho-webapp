import { createClient } from "@supabase/supabase-js";
import { normalizeDocument, validateDocument } from "./domain.js";
import { createWorkflowClient, mapDocument } from "./workflow-client.js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const normalizeDoc = mapDocument;
const workflow = createWorkflowClient(
  (name,args)=>supabase.rpc(name,args),
  async()=>{const {data,error}=await supabase.auth.getSession();if(error)throw error;return data.session?.user?.id;},
  typeof sessionStorage === 'undefined' ? null : sessionStorage
);
function documentPayload(doc) {
  const n=normalizeDocument(doc);
  const error=validateDocument(n);if(error)throw new Error(error);
  const fields=['docType','date','customer','subject','dueDate','bank','note','amount','description',
    'toAddr','toContact','items','expiryDate','conditions','stockManaged','inventoryMode'];
  return Object.fromEntries(fields.filter(k=>n[k]!==undefined).map(k=>[k,n[k]]));
}
function resultDocument(result) {
  return {...normalizeDoc(result.document),_effects:{newCustomer:result.newCustomer,newProducts:result.newProducts||[],stockLogs:result.stockLogs||[]}};
}

export const db = {
  // ── Documents ──────────────────────────────────────────────
  async getDocuments() {
    const { data, error } = await supabase.from("documents").select("*,inventory_reservations(status)").order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(normalizeDoc);
  },
  async saveDocument(doc, user) {
    if(!user?.id)throw new Error("\u30ed\u30b0\u30a4\u30f3\u304c\u5fc5\u8981\u3067\u3059");
    return resultDocument(await workflow('create',{doc:documentPayload(doc)}));
  },
  async updateDocument(id, doc) {
    return resultDocument(await workflow('update',{id,expectedUpdatedAt:doc.updatedAt,doc:documentPayload(doc)}));
  },
  async voidDocument(id, reason, reverseStock=false) {
    return resultDocument(await workflow('void',{id,reason,reverseStock}));
  },
  async invoiceDeliveryNotes(sourceIds, doc) {
    const fields=['date','dueDate','bank','subject','note'];
    return resultDocument(await workflow('invoice',{sourceIds:[...sourceIds].sort(),doc:Object.fromEntries(fields.filter(k=>doc[k]!==undefined).map(k=>[k,doc[k]]))}));
  },

  // ── Company ────────────────────────────────────────────────
  async getCompany() {
    const { data, error } = await supabase.from("company_settings").select("*").limit(1).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { name: data.name, manager: data.manager, addr: data.addr, tel: data.tel, fax: data.fax,
      regNo: data.reg_no, bankA: data.bank_a, bankB: data.bank_b, adminEmails: data.admin_emails || "",
      pcaBankAccountCode:data.pca_bank_account_code||"", pcaBankSubaccountCode:data.pca_bank_subaccount_code||"", pcaReceivableAccountCode:data.pca_receivable_account_code||"",
      sealImg: data.seal_img || "", personSealImg: data.person_seal_img || "", logoImg: data.logo_img || "", _id: data.id };
  },
  async saveCompany(co) {
    const { data: ex, error: findError } = await supabase.from("company_settings").select("id").limit(1).maybeSingle();
    if (findError) throw findError;
    const payload = { name: co.name, manager: co.manager, addr: co.addr, tel: co.tel, fax: co.fax,
      reg_no: co.regNo, bank_a: co.bankA, bank_b: co.bankB, admin_emails: co.adminEmails || "",
      pca_bank_account_code:co.pcaBankAccountCode||"", pca_bank_subaccount_code:co.pcaBankSubaccountCode||"", pca_receivable_account_code:co.pcaReceivableAccountCode||"",
      seal_img: co.sealImg || null, person_seal_img: co.personSealImg || null, logo_img: co.logoImg || null };
    if (ex) { const { error } = await supabase.from("company_settings").update(payload).eq("id", ex.id).select("id").single(); if (error) throw error; }
    else { const { error } = await supabase.from("company_settings").insert([payload]); if (error) throw error; }
  },

  // ── Products ───────────────────────────────────────────────
  async getProducts() {
    const { data, error } = await supabase.from("products").select("*").order("code");
    if (error) throw error;
    return (data || []).map(function(r) {
      return { id: r.id, code: r.code, name: r.name, origin: r.origin, unit: r.unit,
        price: r.price, purchasePrice: r.purchase_price, category: r.category,
        taxRate: r.tax_rate, caseQty: r.case_qty, qtyPerCase: r.qty_per_case,
        stock: r.stock, note: r.note };
    });
  },
  async saveProduct(p) {
    const nullableInteger = (value) => value === "" || value == null ? null : Number(value);
    const payload = { code: p.code, name: p.name, origin: p.origin, unit: p.unit,
      price: p.price, purchase_price: p.purchasePrice || null, category: p.category || null,
      tax_rate: p.taxRate, case_qty: nullableInteger(p.caseQty), qty_per_case: nullableInteger(p.qtyPerCase),
      note: p.note };
    if (p.id) {
      const { error } = await supabase.from("products").update(payload).eq("id", p.id).select("id").single();
      if (error) throw error;
    } else {
      const { error } = await supabase.from("products").insert([payload]);
      if (error) throw error;
    }
  },
  async deleteProduct(id) {
    const { error } = await supabase.from("products").delete().eq("id", id).select("id").single();
    if (error) throw error;
  },
  async updateStock(id, change, reason) {
    if(!Number.isFinite(Number(change))||!Number(change)||!String(reason||'').trim())throw new Error("\u6570\u91cf\u3068\u7406\u7531\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044");
    const result=await workflow('adjust',{productId:id,change:Number(change),reason:String(reason).trim()});
    return Number(result.stock);
  },
  async getUserRole() {
    const {data,error}=await supabase.rpc('current_user_role'); if(error)throw error; return data;
  },
  async listUsers() {
    const {data,error}=await supabase.rpc('list_app_users'); if(error)throw error; return data||[];
  },
  async setUserRole(userId,role) {
    const {error}=await supabase.rpc('set_user_role',{p_user_id:userId,p_role:role}); if(error)throw error;
  },
  async getInventory() {
    const [locations,lots,reservations]=await Promise.all([
      supabase.from('inventory_locations').select('*').eq('active',true).order('name'),
      supabase.from('inventory_lots').select('*,products(id,code,name,unit),inventory_locations(id,name)').order('expires_on',{ascending:true,nullsFirst:false}),
      supabase.from('inventory_reservations').select('*,documents(doc_no,customer),products(name,code),inventory_locations(name)').order('created_at',{ascending:false})
    ]);
    for(const result of [locations,lots,reservations])if(result.error)throw result.error;
    return {locations:locations.data||[],lots:lots.data||[],reservations:reservations.data||[]};
  },
  async createInventoryLocation(name) {
    const {data,error}=await supabase.rpc('create_inventory_location',{p_name:name}); if(error)throw error; return data;
  },
  async createInventoryLot(values) {
    const {data,error}=await supabase.rpc('create_inventory_lot',{p_product_id:values.productId,p_location_id:values.locationId,
      p_lot_code:values.lotCode,p_received_on:values.receivedOn||null,p_expires_on:values.expiresOn||null,p_kg:Number(values.kg),p_cases:Number(values.cases),p_event:values.event||'opening_balance',p_note:values.note||null});
    if(error)throw error; return data;
  },
  async inventoryWorkflow(action,documentId,locationId,note) {
    const {data,error}=await supabase.rpc('inventory_workflow',{p_action:action,p_document_id:documentId,p_location_id:locationId||null,p_note:note||null});
    if(error)throw error; return data;
  },
  async getPayments() {
    const {data,error}=await supabase.from('payments').select('*,payment_allocations(id,document_id,amount,documents(doc_no,customer))').order('payment_date',{ascending:false});
    if(error)throw error; return data||[];
  },
  async createManualPayment(payment) {
    const key=`daisho-manual-payment:${payment.date}:${String(payment.payer).trim().normalize('NFKC')}:${Number(payment.amount)}:${String(payment.reference||'').trim().normalize('NFKC')}`;
    let requestId;try{requestId=sessionStorage.getItem(key);}catch{}
    requestId||=crypto.randomUUID();try{sessionStorage.setItem(key,requestId);}catch{}
    const {data,error}=await supabase.rpc('create_manual_payment',{p_payment_date:payment.date,p_payer:payment.payer,p_amount:Number(payment.amount),p_reference:payment.reference||'',p_request_id:requestId});
    if(error)throw error;try{sessionStorage.removeItem(key);}catch{} return data;
  },
  async allocatePayment(paymentId,documentId,amount) {
    const key=`daisho-payment-allocation:${paymentId}:${documentId}:${Number(amount)}`;
    let requestId;try{requestId=sessionStorage.getItem(key);}catch{}
    requestId||=crypto.randomUUID();try{sessionStorage.setItem(key,requestId);}catch{}
    const {data,error}=await supabase.rpc('allocate_payment',{p_payment_id:paymentId,p_document_id:documentId,p_amount:Number(amount),p_request_id:requestId});
    if(error)throw error;try{sessionStorage.removeItem(key);}catch{} return data;
  },
  async repairLegacyTax(documentId,expectedUpdatedAt,rates) {
    const {data,error}=await supabase.rpc('repair_legacy_document_tax',{p_document_id:documentId,p_expected_updated_at:expectedUpdatedAt,p_rates:rates});
    if(error)throw error; return data;
  },

  // ── Customers ──────────────────────────────────────────────
  async getCustomers() {
    const { data, error } = await supabase.from("customers").select("*").order("code");
    if (error) throw error;
    return (data || []).map(function(r) {
      return { id: r.id, code: r.code, name: r.name, addr: r.addr, contact: r.contact,
        tel: r.tel, bank: r.bank, dueDays: r.due_days, note: r.note, documentCategory:r.document_category, pcaSubaccountCode:r.pca_subaccount_code };
    });
  },
  async saveCustomer(c) {
    const payload = { code: c.code, name: c.name, addr: c.addr, contact: c.contact,
      tel: c.tel, bank: c.bank, due_days: c.dueDays, note: c.note, pca_subaccount_code:c.pcaSubaccountCode||"" };
    if (c.id) {
      const { error } = await supabase.from("customers").update(payload).eq("id", c.id).select("id").single();
      if (error) throw error;
    } else {
      const { error } = await supabase.from("customers").insert([payload]);
      if (error) throw error;
    }
  },
  async deleteCustomer(id) {
    const { error } = await supabase.from("customers").delete().eq("id", id).select("id").single();
    if (error) throw error;
  },
};

// ── AI (Gemini Edge Function) ──────────────────────────────
// input は文字列（単発）または会話履歴の配列 [{role,content},...]
// 戻り値は対話型ラッパー { need_info:boolean, message:string, doc:object|null }
export async function aiParse(input, company, customers = [], products = []) {
  const custNames = customers.map(c => c.name);
  const prodInfo = products.map(p => ({ id:p.id, code:p.code, name: p.name, origin: p.origin, unit: p.unit, price: p.price, taxRate: p.taxRate }));
  const messages = Array.isArray(input) ? input : [{ role: "user", content: String(input) }];
  const { data, error } = await supabase.functions.invoke("ai", { body: { messages, type: "parse", company, customers: custNames, products: prodInfo } });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}
export async function aiChat(messages, company) {
  const { data, error } = await supabase.functions.invoke("ai", { body: { messages, type: "chat", company } });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data?.text || "";
}

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
  if (error) throw error;
}

// ── 入庫処理 ─────────────────────────────────────────────────
export async function receiveStock(productId, productName, qty, supplier, note) {
  if(!Number.isFinite(Number(qty))||Number(qty)<=0)throw new Error("\u5165\u5eab\u6570\u91cf\u306f0\u3088\u308a\u5927\u304d\u304f\u3057\u3066\u304f\u3060\u3055\u3044");
  return db.updateStock(productId,Number(qty),"\u5165\u5eab: "+(supplier||'')+' '+(note||''));
}
// Compatibility with callers: the transaction has already registered stock.
// This function deliberately performs NO additional writes.
export async function autoRegisterAndStock(doc) {
  return doc._effects || {newCustomer:null,newProducts:[],stockLogs:[]};
}

export async function getStockLogs(productId) {
  const { data, error } = await supabase
    .from("stock_logs")
    .select("*")
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}
