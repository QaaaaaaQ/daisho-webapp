// Supabase Edge Function: ai
// Gemini API プロキシ（APIキーをサーバー側で管理）
// deploy: supabase functions deploy ai

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY")!;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
const YR = new Date().getFullYear();

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function callGemini(systemPrompt: string, userText: string): Promise<string> {
  const body = {
    system_instruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: [
      { role: "user", parts: [{ text: userText }] }
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 3000,
    }
  };

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function callGeminiChat(systemPrompt: string, messages: {role:string, content:string}[]): Promise<string> {
  // Geminiはuser/modelの交互が必要。systemはsystem_instructionで渡す
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 800 }
  };

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { text, messages, type, company } = await req.json();
    const coName = company?.name || "株式会社神戸大商";

    let result = "";

    if (type === "parse") {
      // 自然言語 → 書類JSON
      const systemPrompt = `あなたは日本の水産卸売業者「${coName}」の書類作成AIアシスタントです。
ユーザーの自然言語入力から書類情報をJSON形式で正確に抽出してください。
JSONのみ返してください（コードブロック・説明文・マークダウン不要）。

{
  "docType": "納品書" | "請求書" | "領収書" | "見積書",
  "date": "YYYY-MM-DD",
  "customer": "取引先名（御中・様なし）",
  "subject": "件名（品名や商品カテゴリ）",
  "dueDate": "YYYY-MM-DD（支払期限、任意）",
  "expiryDate": "YYYY-MM-DD（見積有効期限、見積書の場合）",
  "conditions": "取引条件（見積書の場合、任意）",
  "bank": "振込先（任意）",
  "note": "備考（任意）",
  "amount": 金額数値（領収書の場合のみ、税込み）,
  "description": "但し書き（領収書）",
  "items": [
    {
      "date": "YYYY-MM-DD（請求書の取引日、納品書は省略可）",
      "name": "品名",
      "qty": 数量（数値）,
      "unit": "単位（本/kg/KG/パック/袋/ケース/匹等）",
      "price": 単価（数値）,
      "amount": 合計金額（qty×price、数値）,
      "reduced": true,
      "taxIncluded": true（税込み表記の場合）| false
    }
  ]
}

重要ルール：
- 現在年は${YR}年。「5/5」→「${YR}-05-05」のように変換
- 食品・水産物はすべてreduced:true（軽減税率8%対象）
- 「税込み」「税込」→taxIncluded:true、amountは税込み合計をそのまま使用
- 「×」「x」「＊」→数量×単価の区切り
- 書類種別が不明→「納品書」
- 「見積」「お見積」「estimate」→「見積書」
- 品名,数量,単位,単価,金額 のCSV・表形式入力に完全対応すること
- カンマ区切りの数字（例: "2,500"）は数値として正しく解析すること（2500）
- 備考欄の「※」以降はitem自体のnoteフィールドには含めず無視してよい
- 数量・単価・金額が揃っている場合はamount = qty × priceで計算して検証
- 品目が10件以上あっても全て抽出すること
- 「要確認」「推測」等の注記は無視してitemの値を最善で推定する
- 真河豚/マフグ/まふぐ、さざえ、アワビ、あさり等＝水産食品→reduced:true
- ドレス＝内臓除去魚体（水産品）
- amount = qty × price（税込みの場合はそのまま）
- JSONのみ出力。マークダウン記号を絶対につけない
- 「よろしいでしょうか」「確認します」などの確認文を絶対に出力しない
- 品目リストやCSVが提供されたら、そのまま全品目をitemsに変換してJSONを返す
- ユーザーへの質問や説明文は一切不要。JSONのみ返す`;

      const raw = await callGemini(systemPrompt, text);

      // マークダウンコードブロックを除去して安全にパース
      const clean = raw
        .replace(/^```[a-zA-Z]*\s*/m, "")
        .replace(/\s*```\s*$/m, "")
        .trim();

      const parsed = JSON.parse(clean);
      return new Response(JSON.stringify(parsed), {
        headers: { ...cors, "Content-Type": "application/json" },
      });

    } else {
      // 通常チャット
      const systemPrompt = `あなたは「${coName}」の書類作成・業務サポートAIです。
日本語で丁寧かつ簡潔に回答してください。
水産業・飲食業の専門知識も活用して質問に答えてください。
書類作成の依頼には、わかりやすく内容を確認してください。`;

      result = await callGeminiChat(systemPrompt, messages || []);
      return new Response(JSON.stringify({ text: result }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

  } catch (e) {
    console.error("Edge Function error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
