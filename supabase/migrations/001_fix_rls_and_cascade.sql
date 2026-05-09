-- Migration: RLS ポリシー修正 + stock_logs 級聯削除
-- Supabase Dashboard > SQL Editor で実行してください

-- 1. documents テーブル: 自分の書類のみ読み取り可能に変更
DROP POLICY IF EXISTS "auth_read_docs" ON documents;
CREATE POLICY "auth_read_docs" ON documents FOR SELECT TO authenticated USING (auth.uid() = created_by);

-- 2. stock_logs の外部キーに CASCADE を追加（商品削除時に自動削除）
ALTER TABLE stock_logs DROP CONSTRAINT IF EXISTS stock_logs_product_id_fkey;
ALTER TABLE stock_logs ADD CONSTRAINT stock_logs_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
