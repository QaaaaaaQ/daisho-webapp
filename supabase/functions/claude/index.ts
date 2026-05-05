// Supabase Edge Function: claude
// Anthropic API のプロキシ（APIキーをサーバー側で管理）
// deploy: supabase functions deploy claude

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const YR = new Date().getFullYear();

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { text, messages, type, company } = await req.json();
    const coName = company?.name || "株式会社神戸大商";

    let body: Record<string, unknown>;

    if (type === "parse") {
      // 自然言語 → 書類JSON
      body = {
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: `あなたは日本の水産卸売業者「${coName}」の書類作成AIアシスタントです。
ユーザーの自然言語入力から書類情報をJSON形式で正確に抽出してください。
JSONのみ返してください（コードブロック・説明文不要）。

{
  "docType": "納品書" | "請求書" | "領収書",
  "date": "YYYY-MM-DD",
  "customer": "取引先名（御中・様なし）",
  "subject": "件名（品名や商品カテゴリ）",
  "dueDate": "YYYY-MM-DD（支払期限、任意）",
  "bank": "振込先（任意）",
  "note": "備考（任意）",
  "amount": 金額数値（領収書の場合のみ、税込み）,
  "description": "但し書き（領収書）",
  "items": [
    {
      "date": "YYYY-MM-DD（請求書の取引日、納品書は省略可）",
      "name": "品名",
      "qty": 数量,
      "unit": "単位（本/kg/KG/パック/袋/ケース/匹等）",
      "price": 単価,
      "amount": 合計金額（qty×price）,
      "reduced": true,
      "taxIncluded": true | false
    }
  ]
}

重要ルール：
- 現在年は${YR}年。「5/5」→「${YR}-05-05」
- 食品・水産物はすべてreduced:true（軽減税率8%対象）
- 「税込み」「税込」→taxIncluded:true
- 「×」「x」「＊」→数量×単価の区切り
- 書類種別が不明→「納品書」
- 真河豚/マフグ/まふぐ、さざえ、アワビ、あさり等＝水産食品→reduced:true`,
        messages: [{ role: "user", content: text }],
      };
    } else {
      // 通常チャット
      body = {
        model: "claude-sonnet-4-20250514",
        max_tokens: 600,
        system: `あなたは「${coName}」の書類作成・業務サポートAIです。日本語で丁寧に回答してください。水産業・飲食業の専門知識も活用してください。`,
        messages: messages || [],
      };
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic API error: ${res.status} ${err}`);
    }

    const data = await res.json();
    const raw = data.content?.[0]?.text || "";

    if (type === "parse") {
      const clean = raw.replace(/```[a-z]*\n?/g, "").replace(/```/g, "").trim();
      return new Response(JSON.stringify(JSON.parse(clean)), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ text: raw }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
