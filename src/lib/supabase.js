import { createClient } from "@supabase/supabase-js";

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

export const db = {
  // ── Documents ──────────────────────────────────────────────
  async getDocuments() {
    const { data, error } = await supabase.from("documents").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(normalizeDoc);
  },
  async saveDocument(doc, user) {
    const { data, error } = await supabase.from("documents").insert([{
      doc_type: doc.docType, doc_no: doc.docNo, date: doc.date || null,
      customer: doc.customer, subject: doc.subject || null, due_date: doc.dueDate || null,
      bank: doc.bank || null, note: doc.note || null, amount: doc.amount || null,
      description: doc.description || null, to_addr: doc.toAddr || null,
      to_contact: doc.toContact || null, items: doc.items || [],
        expiry_date: doc.expiryDate || null, conditions: doc.conditions || null,
      created_by: user.id,
      created_by_name: user.user_metadata?.full_name || user.email,
      created_by_email: user.email,
    }]).select().single();
    if (error) throw error;
    return normalizeDoc(data);
  },
  async updateDocument(id, doc) {
    const { data, error } = await supabase.from("documents").update({
      doc_type: doc.docType, date: doc.date || null, customer: doc.customer,
      subject: doc.subject || null, due_date: doc.dueDate || null, bank: doc.bank || null,
      note: doc.note || null, amount: doc.amount || null, description: doc.description || null,
      to_addr: doc.toAddr || null, to_contact: doc.toContact || null, items: doc.items || [],
        expiry_date: doc.expiryDate || null, conditions: doc.conditions || null,
    }).eq("id", id).select().single();
    if (error) throw error;
    return normalizeDoc(data);
  },
  async deleteDocument(id) {
    // 削除前に書類の品目を取得して在庫を戻す
    const { data: doc } = await supabase.from("documents").select("items, doc_type, doc_no, customer").eq("id", id).single();
    if (doc && doc.items && doc.items.length > 0 && (doc.doc_type === "納品書" || doc.doc_type === "請求書")) {
      for (const item of doc.items) {
        if (!item.name || !item.qty) continue;
        const { data: prod } = await supabase.from("products").select("id, stock").eq("name", item.name).maybeSingle();
        if (prod) {
          const qty = Number(item.qty);
          await supabase.from("products").update({ stock: Number(prod.stock || 0) + qty }).eq("id", prod.id);
          await supabase.from("stock_logs").insert([{
            product_id: prod.id, change: qty,
            reason: "書類削除による在庫戻し: " + doc.customer + " " + doc.doc_no,
            doc_id: id, created_by: null
          }]);
        }
      }
    }
    const { error } = await supabase.from("documents").delete().eq("id", id);
    if (error) throw error;
  },

  // ── Company ────────────────────────────────────────────────
  async getCompany() {
    const { data } = await supabase.from("company_settings").select("*").limit(1).maybeSingle();
    if (!data) return null;
    return { name: data.name, manager: data.manager, addr: data.addr, tel: data.tel, fax: data.fax,
      regNo: data.reg_no, bankA: data.bank_a, bankB: data.bank_b,
      sealImg: data.seal_img || "", personSealImg: data.person_seal_img || "", logoImg: data.logo_img || "", _id: data.id };
  },
  async saveCompany(co) {
    const { data: ex } = await supabase.from("company_settings").select("id").limit(1).maybeSingle();
    const payload = { name: co.name, manager: co.manager, addr: co.addr, tel: co.tel, fax: co.fax,
      reg_no: co.regNo, bank_a: co.bankA, bank_b: co.bankB,
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
        price: r.price, purchasePrice: r.purchase_price,
        taxRate: r.tax_rate, caseQty: r.case_qty, qtyPerCase: r.qty_per_case,
        stock: r.stock, note: r.note };
    });
  },
  async saveProduct(p) {
    const payload = { code: p.code, name: p.name, origin: p.origin, unit: p.unit,
      price: p.price, purchase_price: p.purchasePrice || null,
      tax_rate: p.taxRate, case_qty: p.caseQty, qty_per_case: p.qtyPerCase,
      stock: p.stock || 0, note: p.note };
    if (p.id) {
      const { error } = await supabase.from("products").update(payload).eq("id", p.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("products").insert([payload]);
      if (error) throw error;
    }
  },
  async deleteProduct(id) {
    // 先に関連するstock_logsを削除（外部キー制約対策）
    await supabase.from("stock_logs").delete().eq("product_id", id);
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) throw error;
  },
  async updateStock(id, change) {
    const { data } = await supabase.from("products").select("stock").eq("id", id).single();
    const newStock = Number(data?.stock || 0) + Number(change);
    await supabase.from("products").update({ stock: newStock }).eq("id", id);
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
export async function aiParse(text, company) {
  const { data, error } = await supabase.functions.invoke("ai", { body: { text, type: "parse", company } });
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
  const { data: prod } = await supabase.from("products").select("id, stock").eq("id", productId).single();
  if (!prod) throw new Error("商品が見つかりません");
  const newStock = Number(prod.stock || 0) + Number(qty);
  await supabase.from("products").update({ stock: newStock }).eq("id", productId);
  await supabase.from("stock_logs").insert([{
    product_id: productId,
    change: Number(qty),
    reason: "入庫" + (supplier ? ": " + supplier : "") + (note ? " " + note : ""),
    created_by: userId || null,
  }]);
  return newStock;
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
    const { data: existing } = await supabase
      .from("customers").select("id").eq("name", doc.customer).maybeSingle();
    if (!existing) {
      const { data: newCust } = await supabase.from("customers").insert([{
        name: doc.customer,
        addr: doc.toAddr || null,
        contact: doc.toContact || null,
      }]).select().single();
      if (newCust) results.newCustomer = newCust.name;
    }
  }

  // ② 商品マスター自動登録 + 出庫記録（納品書・請求書のみ）
  if (doc.items && doc.items.length > 0) {
    for (const item of doc.items) {
      if (!item.name) continue;

      // 商品マスターに存在するか確認
      const { data: existingProd } = await supabase
        .from("products").select("id, stock").eq("name", item.name).maybeSingle();

      let productId = existingProd?.id;

      // 未登録なら追加
      if (!existingProd) {
        const { data: newProd } = await supabase.from("products").insert([{
          name: item.name,
          origin: item.origin || null,
          unit: item.unit || "個",
          price: item.price || 0,
          tax_rate: item.taxRate || 8,
          stock: 0,
        }]).select().single();
        if (newProd) {
          productId = newProd.id;
          results.newProducts.push(newProd.name);
        }
      }

      // 出庫記録（在庫を減らす）
      if (productId && item.qty) {
        const qty = Number(item.qty);
        const currentStock = existingProd ? Number(existingProd.stock || 0) : 0;
        // 在庫更新
        await supabase.from("products").update({ stock: currentStock - qty }).eq("id", productId);
        // 出庫ログ
        const { data: log } = await supabase.from("stock_logs").insert([{
          product_id: productId,
          change: -qty,
          reason: doc.docType + " 出庫: " + doc.customer + " " + doc.docNo,
          doc_id: doc.id || null,
          created_by: user.id,
        }]).select().single();
        if (log) results.stockLogs.push({ name: item.name, qty });
      }
    }
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
