import { createClient } from "@supabase/supabase-js";
import { normalizeDocument } from "./domain";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

function normalizeDoc(row) {
  return {
    id: row.id, docType: row.doc_type, docNo: row.doc_no, date: row.date,
    customer: row.customer, subject: row.subject, dueDate: row.due_date,
    bank: row.bank, note: row.note, amount: row.amount, description: row.description,
    toAddr: row.to_addr, toContact: row.to_contact, items: row.items || [],
    expiryDate: row.expiry_date, conditions: row.conditions,
    savedAt: row.created_at, savedBy: row.created_by_name, savedByEmail: row.created_by_email,
  };
}

// 重複書類の判定用シグネチャ。帳票の意味を変える全フィールドを含める。
function docSignature(doc) {
  const items = (doc.items || [])
    .map(it => [String(it.name || "").trim(), String(it.origin || "").trim(), Number(it.qty || 0), String(it.unit || "").trim(), Number(it.price || 0), Number(it.amount || 0), Number(it.taxRate) === 10 ? 10 : 8, Boolean(it.taxIncluded)].join("~"))
    .filter((s) => s.split("~")[0] || Number(s.split("~")[2]) !== 0 || Number(s.split("~")[5]) !== 0)
    .sort()
    .join("||");
  return [doc.docType || "", String(doc.customer || "").trim(), doc.date || "", String(doc.subject || "").trim(), doc.dueDate || "", String(doc.bank || "").trim(), Number(doc.amount || 0), String(doc.description || "").trim(), items].join("##");
}

export const db = {
  // ── Documents ──────────────────────────────────────────────
  async getDocuments() {
    const { data, error } = await supabase.from("documents").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(normalizeDoc);
  },
  async saveDocument(doc, user, opts = {}) {
    // ── 重複作成の防止 ──────────────────────────────────────────
    // 同じ種別・取引先・日付・品目の書類が直近10分以内にあれば、新規作成せず既存を返す。
    // （連打・同じメッセージの再送・AI再生成による重複を防ぐ。opts.allowDuplicate=true で無効化可）
    if (!opts.allowDuplicate && doc.customer) {
      const sinceIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      let q = supabase.from("documents").select("*")
        .eq("doc_type", doc.docType)
        .eq("customer", doc.customer)
        .gte("created_at", sinceIso);
      q = doc.date ? q.eq("date", doc.date) : q.is("date", null);
      const { data: recent, error: recentError } = await q;
      if (recentError) throw recentError;
      const sig = docSignature(doc);
      const existing = (recent || []).map(normalizeDoc).find(d => docSignature(d) === sig);
      if (existing) { existing._duplicate = true; return existing; }
    }

    if (!user?.id) throw new Error("ログインが必要です");
    const { data, error } = await supabase.rpc("create_document", { p_doc: {
      ...normalizeDocument(doc),
      savedBy: user.user_metadata?.full_name || user.email,
    }});
    if (error) {
      // DB側トリガー（10分以内の同一内容）に弾かれた場合は分かりやすいエラーに変換
      if (error.code === "23505") {
        const dupErr = new Error("同じ内容の書類が直近に作成済みのため、重複作成を中止しました。");
        dupErr._duplicate = true;
        throw dupErr;
      }
      throw error;
    }
    return normalizeDoc(data);
  },
  async updateDocument(id, doc) {
    const { data, error } = await supabase.rpc("update_document", { p_doc_id: id, p_doc: normalizeDocument(doc) });
    if (error) throw error;
    return normalizeDoc(data);
  },
  async deleteDocument(id) {
    const { error } = await supabase.rpc("delete_document", { p_doc_id: id });
    if (error) throw error;
  },

  // ── Company ────────────────────────────────────────────────
  async getCompany() {
    const { data, error } = await supabase.from("company_settings").select("*").limit(1).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { name: data.name, manager: data.manager, addr: data.addr, tel: data.tel, fax: data.fax,
      regNo: data.reg_no, bankA: data.bank_a, bankB: data.bank_b, adminEmails: data.admin_emails || "",
      sealImg: data.seal_img || "", personSealImg: data.person_seal_img || "", logoImg: data.logo_img || "", _id: data.id };
  },
  async saveCompany(co) {
    const { data: ex, error: findError } = await supabase.from("company_settings").select("id").limit(1).maybeSingle();
    if (findError) throw findError;
    const payload = { name: co.name, manager: co.manager, addr: co.addr, tel: co.tel, fax: co.fax,
      reg_no: co.regNo, bank_a: co.bankA, bank_b: co.bankB, admin_emails: co.adminEmails || "",
      seal_img: co.sealImg || null, person_seal_img: co.personSealImg || null, logo_img: co.logoImg || null };
    if (ex) { const { error } = await supabase.from("company_settings").update(payload).eq("id", ex.id); if (error) throw error; }
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
    const payload = { code: p.code, name: p.name, origin: p.origin, unit: p.unit,
      price: p.price, purchase_price: p.purchasePrice || null, category: p.category || null,
      tax_rate: p.taxRate, case_qty: p.caseQty, qty_per_case: p.qtyPerCase,
      note: p.note };
    if (p.id) {
      const { error } = await supabase.from("products").update(payload).eq("id", p.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("products").insert([payload]);
      if (error) throw error;
    }
  },
  async deleteProduct(id) {
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) throw error;
  },
  async updateStock(id, change) {
    const { data, error } = await supabase.rpc("adjust_stock", { p_product_id: id, p_change: Number(change), p_reason: "手動調整", p_doc_id: null });
    if (error) throw error;
    return Number(data);
  },

  // ── Customers ──────────────────────────────────────────────
  async getCustomers() {
    const { data, error } = await supabase.from("customers").select("*").order("code");
    if (error) throw error;
    return (data || []).map(function(r) {
      return { id: r.id, code: r.code, name: r.name, addr: r.addr, contact: r.contact,
        tel: r.tel, bank: r.bank, dueDays: r.due_days, note: r.note };
    });
  },
  async saveCustomer(c) {
    const payload = { code: c.code, name: c.name, addr: c.addr, contact: c.contact,
      tel: c.tel, bank: c.bank, due_days: c.dueDays, note: c.note };
    if (c.id) {
      const { error } = await supabase.from("customers").update(payload).eq("id", c.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("customers").insert([payload]);
      if (error) throw error;
    }
  },
  async deleteCustomer(id) {
    const { error } = await supabase.from("customers").delete().eq("id", id);
    if (error) throw error;
  },
};

// ── AI (Gemini Edge Function) ──────────────────────────────
// input は文字列（単発）または会話履歴の配列 [{role,content},...]
// 戻り値は対話型ラッパー { need_info:boolean, message:string, doc:object|null }
export async function aiParse(input, company, customers = [], products = []) {
  const custNames = customers.map(c => c.name);
  const prodInfo = products.map(p => ({ name: p.name, origin: p.origin, unit: p.unit, price: p.price, taxRate: p.taxRate }));
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
export async function receiveStock(productId, productName, qty, supplier, note, userId) {
  const amount = Number(qty);
  if (!(amount > 0)) throw new Error("入庫数量は0より大きくしてください");
  const reason = "入庫" + (supplier ? ": " + supplier : "") + (note ? " " + note : "");
  const { data, error } = await supabase.rpc("adjust_stock", { p_product_id: productId, p_change: amount, p_reason: reason, p_doc_id: null });
  if (error) throw error;
  return Number(data);
}

// ── 重複商品マージ ────────────────────────────────────────────
export async function mergeDuplicateProducts() {
  const { data: prods } = await supabase.from("products").select("*");
  if (!prods) return 0;
  const seen = {};
  let merged = 0;
  for (const p of prods) {
    const key = p.name + "|" + p.unit;
    if (seen[key]) {
      // 重複: stock を親にマージしてから削除
      const parentId = seen[key];
      const { data: parent } = await supabase.from("products").select("stock").eq("id", parentId).single();
      const totalStock = Number(parent?.stock || 0) + Number(p.stock || 0);
      await supabase.from("products").update({ stock: totalStock }).eq("id", parentId);
      // stock_logsの参照を親に付け替え
      await supabase.from("stock_logs").update({ product_id: parentId }).eq("product_id", p.id);
      // 削除
      await supabase.from("products").delete().eq("id", p.id);
      merged++;
    } else {
      seen[key] = p.id;
    }
  }
  return merged;
}

// ── 自動マスター登録 ──────────────────────────────────────────
// 書類保存時に顧客・商品が未登録なら自動追加し、出庫を記録する
export async function autoRegisterAndStock(doc, user) {
  const results = { newCustomer: null, newProducts: [], stockLogs: [] };

  // ① 顧客マスター自動登録
  if (doc.customer) {
    const { data: existing, error: customerLookupError } = await supabase
      .from("customers").select("id").eq("name", doc.customer).maybeSingle();
    if (customerLookupError) throw customerLookupError;
    if (!existing) {
      const { data: newCust } = await supabase.from("customers").insert([{
        name: doc.customer,
        addr: doc.toAddr || null,
        contact: doc.toContact || null,
      }]).select().single();
      if (newCust) results.newCustomer = newCust.name;
    }
  }

  // ② 商品マスター自動登録 + 出庫記録は DB の一トランザクションで行う。
  if ((doc.docType === "納品書" || doc.docType === "請求書") && doc.id && doc.items?.length > 0) {
    const { data: logs, error } = await supabase.rpc("register_document_stock", {
      p_doc_id: doc.id,
      p_doc_type: doc.docType,
      p_customer: doc.customer,
      p_doc_no: doc.docNo,
      p_items: doc.items,
    });
    if (error) throw error;
    results.stockLogs = Array.isArray(logs) ? logs : [];
    results.newProducts = results.stockLogs.filter((log) => log.newProduct).map((log) => log.name);
  }

  return results;
}

// ── 在庫ログ取得 ──────────────────────────────────────────────
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
