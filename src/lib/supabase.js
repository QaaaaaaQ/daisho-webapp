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
    }).eq("id", id).select().single();
    if (error) throw error;
    return normalizeDoc(data);
  },
  async deleteDocument(id) {
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
        price: r.price, taxRate: r.tax_rate, caseQty: r.case_qty, qtyPerCase: r.qty_per_case,
        stock: r.stock, note: r.note };
    });
  },
  async saveProduct(p) {
    const payload = { code: p.code, name: p.name, origin: p.origin, unit: p.unit,
      price: p.price, tax_rate: p.taxRate, case_qty: p.caseQty, qty_per_case: p.qtyPerCase,
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
