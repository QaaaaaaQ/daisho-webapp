-- AI応答の診断ログ。raw_response/input_messages には取引情報が含まれる可能性があるため、
-- RLSで本人のログだけ参照可能にする。Edge Functionのservice role insertはRLSを迂回する。
CREATE TABLE IF NOT EXISTS ai_parse_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      TEXT NOT NULL,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  operation       TEXT NOT NULL,
  input_messages  JSONB,
  raw_response    TEXT,
  parsed_response JSONB,
  status          TEXT NOT NULL,
  error_message   TEXT,
  finish_reason   TEXT,
  usage_metadata  JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_parse_logs_created_at ON ai_parse_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_parse_logs_request_id ON ai_parse_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_ai_parse_logs_user_id ON ai_parse_logs(user_id);

ALTER TABLE ai_parse_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read_own_ai_parse_logs" ON ai_parse_logs;
CREATE POLICY "auth_read_own_ai_parse_logs"
  ON ai_parse_logs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
