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

type GeminiResult = {
  text: string;
  finishReason?: string;
  usageMetadata?: unknown;
  promptFeedback?: unknown;
};

type AiLog = {
  requestId: string;
  userId: string | null;
  operation: string;
  inputMessages?: unknown;
  rawResponse?: string;
  parsedResponse?: unknown;
  status: string;
  errorMessage?: string;
  finishReason?: string;
  usageMetadata?: unknown;
};

const MAX_LOG_TEXT = 20000;

function truncate(value: string, max = MAX_LOG_TEXT): string {
  return value.length <= max ? value : value.slice(0, max) + "…[truncated]";
}

function getJwtSub(req: Request): string | null {
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return null;
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.sub === "string" ? json.sub : null;
  } catch {
    return null;
  }
}

// DB保存に失敗してもAI処理自体は止めない。環境変数未設定時はEdgeログへ退避する。
async function saveAiLog(log: AiLog): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  let serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  try {
    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    serviceKey = secretKeys.default || serviceKey;
  } catch {
    // 旧環境ではSUPABASE_SERVICE_ROLE_KEYを使う。
  }
  const payload = {
    request_id: log.requestId,
    user_id: log.userId,
    operation: log.operation,
    input_messages: log.inputMessages ?? null,
    raw_response: log.rawResponse ? truncate(log.rawResponse) : null,
    parsed_response: log.parsedResponse ?? null,
    status: log.status,
    error_message: log.errorMessage ? truncate(log.errorMessage, 4000) : null,
    finish_reason: log.finishReason || null,
    usage_metadata: log.usageMetadata ?? null,
  };

  if (!url || !serviceKey) {
    console.log("[ai-parse-log]", JSON.stringify(payload));
    return;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${url}/rest/v1/ai_parse_logs`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) console.error("[ai-parse-log] DB保存失敗", res.status, await res.text());
  } catch (e) {
    console.error("[ai-parse-log] DB保存例外", String(e));
  }
}

async function callGemini(system: string, user: string, temp = 0.1, jsonMode = false): Promise<GeminiResult> {
  return await callGeminiConvo(system, [{ role: "user", content: user }], temp, jsonMode);
}

// 会話（複数ターン）対応の呼び出し
async function callGeminiConvo(system: string, messages: {role:string, content:string}[], temp = 0.1, jsonMode = false): Promise<GeminiResult> {
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));
  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      temperature: temp,
      maxOutputTokens: jsonMode ? 5000 : 800,
      ...(jsonMode ? { responseMimeType: "application/json" } : {}),
    }
  };
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return {
    text: data?.candidates?.[0]?.content?.parts?.[0]?.text || "",
    finishReason: data?.candidates?.[0]?.finishReason,
    usageMetadata: data?.usageMetadata,
    promptFeedback: data?.promptFeedback,
  };
}

function extractJSON(raw: string): string {
  let s = raw.replace(/^```[a-zA-Z]*\s*/m, "").replace(/\s*```\s*$/m, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1) s = s.slice(start, end + 1);
  return s;
}

function normalizeParseResult(value: any): any {
  const result = value && typeof value === "object" ? value : {};
  result.need_info = typeof result.need_info === "boolean" ? result.need_info : !result.doc;
  result.doc = result.doc && typeof result.doc === "object" ? result.doc : null;
  result.missing = Array.isArray(result.missing) ? result.missing.filter(Boolean).slice(0, 20) : [];
  result.unrecognized = Array.isArray(result.unrecognized)
    ? result.unrecognized.filter(Boolean).slice(0, 20)
    : [];
  if (result.need_info && !result.message) {
    result.message = "不足情報または確認が必要な項目があります。下書きの内容を確認してください。";
  }
  return result;
}

function jsonResponse(payload: unknown, requestId: string, status = 200): Response {
  return new Response(JSON.stringify({ ...(payload as Record<string, unknown>), requestId }), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
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
{"need_info": true または false, "message": "ユーザーへの質問文", "missing": ["不足項目"], "unrecognized": [{"field":"項目", "raw":"入力された表記", "reason":"認識できない理由"}], "doc": 書類オブジェクト または null}

# doc の形式。need_infoがtrueでも、認識できた項目・明細を必ず下書きとして入れる。認識できない行はdocに推測で入れず、unrecognizedへ移す。
{"docType":"納品書|請求書|領収書|見積書","date":"YYYY-MM-DD","customer":"取引先名（様・御中なし）","subject":"件名","dueDate":null,"bank":null,"note":null,"amount":null,"description":null,"items":[{"date":null,"origin":"産地","name":"品名","qty":数量,"unit":"単位","price":単価,"amount":数量×単価,"taxRate":8,"taxIncluded":税区分}]}

${masterBlock(customers, products)}

# 進め方（重要・厳守）
1. 不足情報があれば need_info:true にして message で質問する。認識できた分はdocに残し、missingとunrecognizedにも具体的に記録する。docを丸ごとnullにしてはいけない。
2. 作成に必須: ①書類種別 ②あて先(取引先)。納品書・請求書・見積書は③各品目の(品名・数量・単価)も必須。領収書は「領収金額(amount)」と「但し書き(description)」を優先し、品目明細(items)は入力された場合だけ付ける。領収書の金額が品目明細から計算できる場合はその合計を使う。
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
- 「8.000円」「40.000円」のようにドットの後が3桁の金額は桁区切りとして8000円、40000円に変換する（小数金額が明示された場合を除く）。
- 「TAX」「＋TAX」「外税」はtaxIncluded:false、「税込」「税込み」「内税」はtaxIncluded:true。
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

  const requestId = crypto.randomUUID();
  const userId = getJwtSub(req);

  try {
    const { text, messages, type, company, customers, products } = await req.json();
    const coName = company?.name || "株式会社神戸大商";

    if (type === "parse") {
      // messages（会話履歴）があれば対話型(新)。無ければ従来型(旧フロント互換)。
      const interactive = Array.isArray(messages) && messages.length > 0;

      if (interactive) {
        const system = PARSE_SYSTEM_V2(coName, customers || [], products || []);
        let parsed: any = null;
        let raw = "";
        let finishReason: string | undefined;
        let usageMetadata: unknown;
        let errorMessage = "";
        try {
          const first = await callGeminiConvo(system, messages, 0.1, true);
          raw = first.text;
          finishReason = first.finishReason;
          usageMetadata = first.usageMetadata;
          try {
            parsed = JSON.parse(extractJSON(raw));
          } catch (firstParseError) {
            // JSONモードでも崩れた場合は、同じ応答を短い修復プロンプトで1回だけ再処理する。
            const repair = await callGeminiConvo(
              "次のAI応答をJSONとして修復してください。JSONのみ返し、入力から認識できた項目はdocに残し、missingとunrecognizedも返してください。",
              [{ role: "user", content: `元の応答:\n${truncate(raw, 12000)}` }],
              0,
              true,
            );
            raw = `${raw}\n--- repair ---\n${repair.text}`;
            finishReason = repair.finishReason || finishReason;
            usageMetadata = repair.usageMetadata || usageMetadata;
            parsed = JSON.parse(extractJSON(repair.text));
          }
        } catch (e) {
          errorMessage = String(e);
          parsed = {
            need_info: true,
            message: "AIの応答を完全には解析できませんでした。認識できた内容を確認し、未認識項目を入力し直してください。",
            missing: ["AI応答の解析"],
            unrecognized: [{
              field: "AI応答",
              raw: truncate(raw, 500),
              reason: errorMessage.includes("Gemini API error") ? "AI APIエラー" : "JSON形式ではありませんでした",
            }],
            doc: null,
          };
        }
        parsed = normalizeParseResult(parsed);
        await saveAiLog({
          requestId,
          userId,
          operation: "parse",
          inputMessages: messages,
          rawResponse: raw,
          parsedResponse: parsed,
          status: errorMessage ? "error" : parsed.need_info ? "partial" : "complete",
          errorMessage: errorMessage || undefined,
          finishReason,
          usageMetadata,
        });
        return jsonResponse(parsed, requestId);
      }

      // ── 従来型（質問せず doc をそのまま返す） ──
      const gemini = await callGemini(PARSE_SYSTEM_LEGACY(coName), text, 0.1, true);
      const raw = gemini.text;
      let parsed: unknown;
      try {
        parsed = JSON.parse(extractJSON(raw));
      } catch {
        const raw2 = await callGemini("JSONのみ返す。説明不要。",
          `次の入力から書類JSONを生成: ${text}\n形式: {"docType":"納品書","date":"${YR}-05-12","customer":"顧客名","items":[{"name":"品名","qty":数量,"unit":"kg","price":単価,"amount":合計,"taxRate":8,"taxIncluded":false}]}`,
          0.1,
          true,
        );
        parsed = JSON.parse(extractJSON(raw2.text));
      }
      await saveAiLog({ requestId, userId, operation: "parse-legacy", inputMessages: [{ role: "user", content: text }], rawResponse: raw, parsedResponse: parsed, status: "complete", finishReason: gemini.finishReason, usageMetadata: gemini.usageMetadata });
      return jsonResponse(parsed, requestId);

    } else {
      const system = `あなたは「${coName}」の業務サポートAIです。日本語で簡潔に回答してください。水産業の専門知識を活用してください。`;
      const result = await callGeminiConvo(system, messages || [], 0.7);
      await saveAiLog({ requestId, userId, operation: "chat", inputMessages: messages || [], rawResponse: result.text, status: "complete", finishReason: result.finishReason, usageMetadata: result.usageMetadata });
      return jsonResponse({ text: result.text }, requestId);
    }

  } catch (e) {
    console.error("Edge Function error:", e);
    await saveAiLog({ requestId, userId, operation: "error", status: "error", errorMessage: String(e) });
    return jsonResponse({ error: String(e) }, requestId, 500);
  }
});
