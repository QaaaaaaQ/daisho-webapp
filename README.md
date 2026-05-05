# 神戸大商 業務書類AIシステム　セットアップ手順

**所要時間：約30分**  
必要なもの：PC・Googleアカウント・Anthropic APIキー

---

## 全体の流れ

```
① Supabase設定（DB + 認証）
    ↓
② Edge Function デプロイ（AI機能）
    ↓
③ Vercel デプロイ（Webサイト公開）
    ↓
④ 完成！URLを全員に共有するだけ
```

---

## ① Supabase 設定

### 1-1. プロジェクト作成

1. https://supabase.com にアクセス → 「Start your project」
2. GitHubアカウントでサインイン（無料）
3. 「New project」をクリック
4. 設定：
   - **Name**: `daisho-webapp`
   - **Database Password**: 任意（メモしておく）
   - **Region**: `Northeast Asia (Tokyo)` を選択
5. 「Create new project」→ 2〜3分待つ

### 1-2. データベーステーブル作成

1. 左メニュー「SQL Editor」をクリック
2. 「New query」をクリック
3. `supabase/schema.sql` の内容を**すべてコピー**して貼り付け
4. 右上「Run」ボタンをクリック
5. 「Success」と表示されれば完了

### 1-3. Google OAuth 設定（Google Workspaceでログイン）

**Google Cloud Console側の設定：**

1. https://console.cloud.google.com にアクセス
2. 既存のプロジェクトを選択 or 新規作成
3. 左メニュー「APIとサービス」→「認証情報」
4. 「認証情報を作成」→「OAuthクライアントID」
5. 設定：
   - **アプリの種類**: ウェブアプリケーション
   - **名前**: `神戸大商書類システム`
   - **承認済みのリダイレクトURI**: 後で追加（⑥で説明）
6. 「作成」→ **クライアントID** と **クライアントシークレット** をメモ

**Supabase側の設定：**

1. Supabaseの左メニュー「Authentication」→「Providers」
2. 「Google」をクリック
3. 「Enable Sign in with Google」をオン
4. **Client ID** と **Client Secret** を入力（Google Cloudからコピー）
5. 「Save」をクリック
6. **Callback URL** をコピー（`https://xxxx.supabase.co/auth/v1/callback`）

**Google Cloud Consoleに戻る：**
7. 先ほどのOAuthクライアントに、コピーしたCallback URLを「承認済みのリダイレクトURI」に追加
8. 「保存」

> **💡 Google Workspace制限**（任意）  
> Google Cloudの「OAuth同意画面」→「範囲を追加」で  
> `hd: yourdomain.co.jp` を設定すると、自社ドメインのみログイン可能になります。

---

## ② Edge Function デプロイ（AI機能）

### 2-1. Supabase CLI インストール

**Mac:**
```bash
brew install supabase/tap/supabase
```

**Windows (PowerShell):**
```powershell
# まず Node.js (https://nodejs.org) をインストール後
npm install -g supabase
```

### 2-2. Anthropic APIキーを取得

1. https://console.anthropic.com にアクセス
2. 「API Keys」→「Create Key」
3. キーをコピー（`sk-ant-...`で始まる文字列）

### 2-3. Edge Function をデプロイ

```bash
# このフォルダ（daisho-webapp）に移動
cd daisho-webapp

# Supabaseにログイン
supabase login

# プロジェクトとリンク（Project Reference IDはSupabaseの「Project Settings > General」に記載）
supabase link --project-ref あなたのプロジェクトID

# Edge Functionをデプロイ
supabase functions deploy claude

# Anthropic APIキーをセット
supabase secrets set ANTHROPIC_API_KEY=sk-ant-あなたのAPIキー
```

---

## ③ Vercel デプロイ（Webサイト公開）

### 3-1. GitHubにアップロード

1. https://github.com にアクセス → 「New repository」
2. Repository name: `daisho-webapp`
3. 「Private」を選択 → 「Create repository」
4. 画面の指示に従ってファイルをアップロード

### 3-2. Vercelでデプロイ

1. https://vercel.com にアクセス → Googleでログイン
2. 「Add New Project」→ GitHubのリポジトリを選択
3. 「Environment Variables」に以下を追加：

| キー | 値 |
|-----|-----|
| `VITE_SUPABASE_URL` | SupabaseのProject URL（`https://xxxx.supabase.co`） |
| `VITE_SUPABASE_ANON_KEY` | SupabaseのAnon Key |

   > 値は Supabase「Project Settings → API」からコピー

4. 「Deploy」をクリック → 2〜3分で完了
5. **公開URL**が表示される（例：`https://daisho-webapp.vercel.app`）

### 3-3. Supabaseにデプロイ先URLを登録

1. Supabase「Authentication → URL Configuration」
2. **Site URL**: `https://daisho-webapp.vercel.app` を入力
3. **Redirect URLs**: 同じURLを追加
4. 「Save」

---

## ④ 使い始める

1. 公開URLにアクセス
2. 「Googleでログイン」
3. 初回：⚙️設定タブで自社情報を入力・保存
4. 💬AIチャットで書類作成！

**URLを社内全員に共有するだけで、複数人が同時に使えます。**

---

## コスト目安

| サービス | 費用 |
|---------|------|
| Supabase | **無料**（月500MB・50,000リクエストまで） |
| Vercel | **無料**（個人・チームプロジェクト） |
| Anthropic API | 書類1枚あたり **約1〜3円** |

月100枚発行しても **約100〜300円/月** のAI費用のみ。

---

## トラブルシューティング

**Q: ログインできない**  
→ Supabase「Authentication → URL Configuration」のSite URLが正しいか確認

**Q: 書類作成でエラーが出る**  
→ Edge FunctionのANTHROPIC_API_KEYが正しく設定されているか確認  
　 `supabase secrets list` で確認できます

**Q: データが保存されない**  
→ Supabase「Table Editor」でdocumentsテーブルが作成されているか確認

---

## ファイル構成

```
daisho-webapp/
├── README.md              ← この手順書
├── package.json           ← 依存パッケージ定義
├── vite.config.js         ← ビルド設定
├── index.html             ← HTMLエントリポイント
├── .env.example           ← 環境変数テンプレート
├── src/
│   ├── main.jsx           ← Reactエントリポイント
│   ├── App.jsx            ← メインアプリ
│   └── lib/
│       ├── supabase.js    ← Supabase接続・DB操作
│       └── pdf.js         ← PDF生成
└── supabase/
    ├── schema.sql         ← DBテーブル定義
    └── functions/
        └── claude/
            └── index.ts   ← AI処理（Edge Function）
```

---

*株式会社神戸大商 様専用 | Powered by Supabase + Anthropic Claude + Vercel*
# daisho-webapp
