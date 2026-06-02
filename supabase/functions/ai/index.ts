// Supabase Edge Function: ai
// deploy: supabase functions deploy ai

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY")!;
// モデル名は環境変数 GEMINI_MODEL で上書き可能（Googleのモデル廃止に備える）。
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
const YR = new Date().getFullYear();

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function callGemini(system: string, user: string, temp = 0.1): Promise<string> {
  return await callGeminiConvo(system, [{ role: "user", content: user }], temp);
}

// 会話（複数ターン）対応の呼び出し
async function callGeminiConvo(system: string, messages: {role:string, content:string}[], temp = 0.1): Promise<string> {
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));
  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { temperature: temp, maxOutputTokens: 3000 }
  };
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

function extractJSON(raw: string): string {
  let s = raw.replace(/^```[a-zA-Z]*\s*/m, "").replace(/\s*```\s*$/m, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1) s = s.slice(start, end + 1);
  return s;
}

type Prod = { name: string; origin?: string; unit?: string; price?: number };

function masterBlock(customers: string[], products: Prod[]): string {
  const custLines = (customers || []).length
    ? (customers || []).map(c => `・${c}`).join("\n")
    : "（登録なし）";
  const prodLines = (products || []).length
    ? (products || []).map(p => `・${p.name}（産地:${p.origin || "未設定"} / 単位:${p.unit || "-"} / 単価:${p.price ?? "-"}）`).join("\n")
    : "（登録なし）";
  return `# 登録済み取引先（あて先はこの中から選ぶ）\n${custLines}\n\n# 商品マスタ（品名・産地・単位・単価はここから取る）\n${prodLines}`;
}

// 質問あり/なしを返す対話型パース
const PARSE_SYSTEM_V2 = (coName: string, customers: string[], products: Prod[]) => `あなたは水産卸売業者「${coName}」の書類作成アシスタントです。ユーザーとの会話から書類データを正確に作成します。

# 出力（必ずJSONのみ。最初の文字は「{」、最後は「}」。説明文・マークダウン禁止）
{"need_info": true または false, "message": "ユーザーへの質問文（need_infoがtrueのときだけ。日本語で簡潔に）", "doc": 書類オブジェクト または null}

# doc の形式（need_infoがfalseのとき。trueのときはnull）
{"docType":"納品書|請求書|領収書|見積書","date":"YYYY-MM-DD","customer":"取引先名（様・御中なし）","subject":"件名","dueDate":null,"bank":null,"note":null,"amount":null,"description":null,"items":[{"date":null,"origin":"産地","name":"品名","qty":数量,"unit":"単位","price":単価,"amount":数量×単価,"taxRate":8,"taxIncluded":税区分}]}

${masterBlock(customers, products)}

# 進め方（重要・厳守）
1. 不足情報があれば need_info:true にして message で質問し、doc は null。質問は一度にまとめて簡潔に。
2. 作成に必須: ①書類種別 ②あて先(取引先) ③各品目の(品名・数量・単価)。これらが揃うまで doc を作らない。
3. あて先(customer)は必ず「登録済み取引先」の登録名を“そのまま”使う。敬称(様/御中)・「株式会社」等の有無・全角半角や空白の違いは無視して照合し、部分一致が1件ならその正式登録名を採用する（例「金誠」→「金誠　株式会社」）。複数該当して特定できない時だけ候補を挙げて質問する。新規取引先が明確な時のみ入力どおり。
4. 品名は「商品マスタ」の登録名を“そのまま”使う。完全一致を最優先。完全一致が無くても表記ゆれ・ひらがな/カタカナ・略称で同一と判断できる商品が1件あれば、その登録名を採用し、産地・単位・単価もマスタの値を使う（例「さざえ」→「サザエ」）。候補が複数で絞れない時だけ最大3つ「1) ◯◯ 2) ◯◯ 3) ◯◯ のどれですか？番号で」と質問する。明らかな新商品の時のみ入力どおりの品名。
5. 産地(origin)は採用した商品マスタの値を使う。マスタに産地が無い時のみ「国産」。
6. 消費税率(taxRate)は基本8%。明示があればそれに従う。
7. 税区分(taxIncluded): 請求書・納品書は外税(false)、領収書は内税(true)。ただしユーザーが「税込」「税抜」を明示した場合はそれを優先。
8. ①〜⑦がすべて揃ったら need_info:false にして doc に書類を入れる。
9. ユーザーが直前の質問に答えた場合は、その回答を反映して続行する（番号回答や「国産」などの短い返答も解釈する）。

# 変換ルール
- 今年は${YR}年。「5/12」→「${YR}-05-12」
- 「×」「x」「*」は数量×単価。amount = qty × price
- キロ→kg、尾→匹
- 「金誠様」→「金誠」（敬称を外す）。「韓国産サザエ」→ origin「韓国産」, name「サザエ」
- CSV・表形式は全行を items にする`;

// 旧フォーマット（質問なし・docをそのまま返す）。後方互換用。
const PARSE_SYSTEM_LEGACY = (coName: string) => `あなたは水産卸売業者「${coName}」の書類作成AIです。

# 厳守事項
- 出力はJSONのみ。最初の文字は「{」、最後は「}」
- 説明文・確認文・質問・挨拶・マークダウンを一切含めない
- 情報が不完全でも推測してJSONを返す。絶対に質問しない

# JSONフォーマット
{"docType":"納品書|請求書|領収書|見積書","date":"YYYY-MM-DD","customer":"取引先名（様・御中なし）","subject":"件名","dueDate":null,"bank":null,"note":null,"items":[{"date":null,"origin":"産地","name":"品名","qty":数量,"unit":"単位","price":単価,"amount":数量x単価,"taxRate":8,"taxIncluded":false}]}

# 変換ルール
- 今年: ${YR}年。「5/12」→「${YR}-05-12」
- 「税抜」→taxIncluded:false、「税込」→taxIncluded:true、請求書/納品書は外税、領収書は内税
- 「×」「x」「*」→数量×単価
- 書類種別不明→「納品書」、「見積」→「見積書」
- 水産物・食品→taxRate:8
- 「韓国産サザエ」→origin:「韓国産」、name:「サザエ」（産地を分離）
- キロ→kg、尾→匹`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { text, messages, type, company, customers, products } = await req.json();
    const coName = company?.name || "株式会社神戸大商";

    if (type === "parse") {
      // messages（会話履歴）があれば対話型(新)。無ければ従来型(旧フロント互換)。
      const interactive = Array.isArray(messages) && messages.length > 0;

      if (interactive) {
        const system = PARSE_SYSTEM_V2(coName, customers || [], products || []);
        let parsed: any;
        try {
          parsed = JSON.parse(extractJSON(await callGeminiConvo(system, messages, 0.1)));
        } catch {
          parsed = { need_info: true, message: "うまく読み取れませんでした。もう一度、取引先・品名・数量・単価を教えてください。", doc: null };
        }
        // 形を整える
        if (typeof parsed.need_info !== "boolean") parsed.need_info = !parsed.doc;
        if (parsed.need_info) parsed.doc = null;
        return new Response(JSON.stringify(parsed), { headers: { ...cors, "Content-Type": "application/json" } });
      }

      // ── 従来型（質問せず doc をそのまま返す） ──
      const raw = await callGemini(PARSE_SYSTEM_LEGACY(coName), text);
      let parsed: unknown;
      try {
        parsed = JSON.parse(extractJSON(raw));
      } catch {
        const raw2 = await callGemini("JSONのみ返す。説明不要。",
          `次の入力から書類JSONを生成: ${text}\n形式: {"docType":"納品書","date":"${YR}-05-12","customer":"顧客名","items":[{"name":"品名","qty":数量,"unit":"kg","price":単価,"amount":合計,"taxRate":8,"taxIncluded":false}]}`);
        parsed = JSON.parse(extractJSON(raw2));
      }
      return new Response(JSON.stringify(parsed), { headers: { ...cors, "Content-Type": "application/json" } });

    } else {
      const system = `あなたは「${coName}」の業務サポートAIです。日本語で簡潔に回答してください。水産業の専門知識を活用してください。`;
      const result = await callGeminiConvo(system, messages || [], 0.7);
      return new Response(JSON.stringify({ text: result }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

  } catch (e) {
    console.error("Edge Function error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
