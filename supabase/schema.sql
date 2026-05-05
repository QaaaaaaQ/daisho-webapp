-- =====================================================
-- 株式会社神戸大商 業務書類システム
-- Supabase データベース スキーマ
-- =====================================================

-- ① 会社設定（全員で共有・1行のみ）
CREATE TABLE IF NOT EXISTS company_settings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT DEFAULT '株式会社 神戸大商',
  manager     TEXT DEFAULT '経理担当　秦',
  addr        TEXT DEFAULT '〒532-0011 大阪市淀川区西中島４丁目７番１８号',
  tel         TEXT DEFAULT 'TEL:06-6379-3451',
  fax         TEXT DEFAULT 'FAX:06-6379-3461',
  reg_no      TEXT DEFAULT 'T4120001218286',
  bank_a      TEXT DEFAULT 'りそな銀行　新大阪駅前支店　普通0436583',
  bank_b      TEXT DEFAULT '三井住友銀行　神戸営業部　普通預金1663502',
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 初期データ投入（1行）
INSERT INTO company_settings (id) VALUES (gen_random_uuid())
  ON CONFLICT DO NOTHING;

-- ② 書類テーブル（納品書・請求書・領収書）
CREATE TABLE IF NOT EXISTS documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type         TEXT NOT NULL CHECK (doc_type IN ('納品書','請求書','領収書')),
  doc_no           TEXT UNIQUE,
  date             DATE,
  customer         TEXT,
  subject          TEXT,
  due_date         DATE,
  bank             TEXT,
  note             TEXT,
  amount           NUMERIC,           -- 領収書の金額
  description      TEXT,              -- 領収書の但し書き
  to_addr          TEXT,
  to_contact       TEXT,
  items            JSONB DEFAULT '[]', -- 品目リスト
  created_by       UUID REFERENCES auth.users(id),
  created_by_name  TEXT,
  created_by_email TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス（検索高速化）
CREATE INDEX IF NOT EXISTS idx_documents_customer   ON documents(customer);
CREATE INDEX IF NOT EXISTS idx_documents_date       ON documents(date DESC);
CREATE INDEX IF NOT EXISTS idx_documents_doc_type   ON documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at DESC);

-- ③ Row Level Security（RLS）有効化
ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents        ENABLE ROW LEVEL SECURITY;

-- ④ ポリシー設定（Google Workspaceでログインしたユーザー全員がアクセス可）
-- company_settings: 認証済みユーザーは読み書き可
CREATE POLICY "auth_read_company"  ON company_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_company" ON company_settings FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- documents: 認証済みユーザーは全件読み・自分の書類を編集・削除
CREATE POLICY "auth_read_docs"   ON documents FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_docs" ON documents FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "auth_update_docs" ON documents FOR UPDATE TO authenticated USING (auth.uid() = created_by);
CREATE POLICY "auth_delete_docs" ON documents FOR DELETE TO authenticated USING (auth.uid() = created_by);

-- ⑤ updated_at 自動更新トリガー
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_company_updated_at
  BEFORE UPDATE ON company_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
