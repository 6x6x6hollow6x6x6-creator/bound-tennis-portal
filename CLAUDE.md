# 大会情報ポータル / BTPランキング

日本バウンドテニス協会向け。全国の大会情報を集約し、その結果から日本ランキング（BTP）を算出する静的サイト。
石川県バウンドテニス協会サイト（ibta.info）と同じ構成を踏襲している。

## 絶対に崩してはいけない設計

- **`index.html` 1ファイルにHTML/CSS/JSを全部入れる。** SPA風、ページは実ファイル分割せずJSで出し分ける
- **ビルド工程なし。** npm/webpack/バンドラを導入しない。外部依存はCDN直読みのみ
  - `https://cdn.tailwindcss.com`（Tailwind、`tailwind.config` は `<head>` 内で設定）
  - `https://unpkg.com/lucide@latest/dist/umd/lucide.js`
  - `https://accounts.google.com/gsi/client`
- **データは3段フォールバック。** ① Apps Script API → ② `localStorage` → ③ コード内 `DEFAULT_DATA`
  API未設定でもオフラインでも画面が壊れないこと。この性質を壊す変更をしない
- **POSTは必ず `Content-Type: text/plain;charset=utf-8`。** Apps Scriptはプリフライトに応答できないためCORS回避。受け側で `JSON.parse`
- **書き込み権限の判定はサーバー側（`Code.gs` の `verifyIdToken_()`）が本体。** フロントの制御は目隠しにすぎない
- サーバー代・ドメイン代ゼロを維持する。有料サービスに依存する提案をしない

## ファイル

```
index.html                     サイト本体＋管理画面（約1900行）
apps-script/Code.gs            スプレッドシートAPI。Apps Scriptに貼り付けて使う
apps-script/セットアップ手順.md  初回のブラウザ操作手順（非エンジニア向け）
運用マニュアル.md               更新担当者向け。専門用語なし
docs/引き継ぎ.md                現状・残タスク・未決事項
tools/smoke-test.mjs           Playwrightの動作確認スクリプト
```

## index.html の構成（`<script>` ブロックの順番）

1. 設定定数（`SHEETS_API_URL` / `GOOGLE_CLIENT_ID` / `LS_PREFIX` / `TYPES`）
2. `DEFAULT_DATA`（サンプルデータ。1行の巨大JSON）
3. 共通ユーティリティ（`esc` / `safeUrl` / 日付 / `LS` / `toast` / モーダル）
4. マスタ定義とランキング集計（`computeRankings` / `buildHistory`）
5. データ読み込み（`loadData` / `applyData`）
6. 公開画面の描画
7. ランキング画面
8. 大会結果・お知らせ・制度・トップ
9. 認証と管理画面
10. `boot()`

## コーディング規約

- **DOMに入れる文字列は必ず `esc()` を通す。** 管理画面から入った値がそのままHTMLになる箇所が多いので例外を作らない
- **`href` に入れるURLは必ず `safeUrl()` を通す。** `https?:` 以外は空文字を返す
- `localStorage` へのアクセスは必ず `LS.get/set/del` 経由（try-catchで包んである）
- 色はTailwindのカスタムカラーを使う：`navy` `brand-red` `paper` `rule` `ink` `ink-soft` `ink-mute`
  グレードの色は `gcolor(g)` から取る（同一色相ランプ。濃いほど格上）
- インデント2スペース、セミコロンあり、シングルクォート
- コメントは日本語。「何をしているか」ではなく「なぜそうしているか」を書く
- 新しいデータ種別を足すときは `TYPES` 配列と `Code.gs` の `SCHEMA` の両方に追加する

## ランキングのルール（変えるときは慎重に）

- **公式戦（G1〜G3）だけで順位を出す。** 全国の大会の9割はクラス分けのない地方の交流大会で、
  成績を同じ物差しで比べられない。だからG4・G5は配点を0にして掲載のみとしている（2026-08-18 決定）。
  `computeRankings` は0点の結果をスキップするので、配点を0にすれば集計から完全に外れる
- **団体戦とBTラリー戦はランキングに算入しない。** 団体戦は出場していない控えにも順位が付き、
  貢献度を測れないため。対象種目は `settings.rankEvents`、掲載できる種目は `EVENTS_ALL`
- 直近52週のローリング集計。上位4大会を合計
- ポイント ＝ グレード別配点 × ドロー係数（32名以上1.00／16〜31名0.85／8〜15名0.70／4〜7名0.50）
- 区分は 種目 × 性別 × カテゴリ。ミックスダブルスは `性別='混合'` の1区分
- フリーの成績は、年齢を満たせばミドル・シニアにも算入する（逆は不可）
- 順位の変動と推移グラフは、過去12か月それぞれの時点で `computeRankings` を再実行して出している。
  **履歴シートは持たない。** この方式のおかげで担当者が「順位を確定」する操作をしなくて済む
- 配点・集計ルールはすべて `content.settings` にあり、管理画面から変更できる。ハードコードしない

## 動作確認

```bash
# ブラウザで直接開く（これで全機能が動く。サーバー不要）
open index.html

# ローカルサーバー経由で見たいとき
python3 -m http.server 8000

# 自動確認（Playwright必要）
npm i -D playwright && npx playwright install chromium
node tools/smoke-test.mjs
```

管理画面は フッター「管理者向けログイン」→「お試しモードで管理画面を開く」から入れる
（`SHEETS_API_URL` と `GOOGLE_CLIENT_ID` が空のときだけ、この入口が出る）。
**本番設定が入っている現在は、この入口は出ない。** ローカルで管理画面を触るときは
2つの定数を一時的に空にするか、`tools/smoke-test.mjs` と同じく空にした複製を開く
（テストはこれを自動でやっている）。

**変更したら必ずブラウザで実際に開いて目視確認すること。** 特に管理画面の各タブ。

## つまずきやすい点

- **`Code.gs` を直したら再デプロイが必要。** 「デプロイを管理 → 鉛筆 → バージョン=新バージョン」。
  「新しいデプロイ」を選ぶとURLが変わってしまう
- Apps Script(V8) では `instanceof Date` が効かないことがある。日付判定は
  `Object.prototype.toString.call(v) === '[object Date]'` を使う（`isDate_()`）
- OAuthの「承認済みのJavaScript生成元」はドメインまで。末尾スラッシュもリポジトリ名も付けない
- Googleドライブのファイルは共有を「リンクを知っている全員」にしないと他人が開けない。
  作った本人は開けてしまうので気づきにくい
- `DEFAULT_DATA` は1行の巨大JSON。手で編集しない。
  管理画面の「JSON書き出し」でダウンロードしたものを丸ごと差し替える

## 現在の状態

- サンプルデータで全画面が動作する。Apps Script・スプレッドシート・Driveはすべて未設定
- `Code.gs` の `GOOGLE_CLIENT_ID` と `ALLOWED_EMAILS` はプレースホルダのまま
- 掲載データはすべて架空。本番前に入れ替えが必要
- ヘッダーのロゴはプレースホルダー。協会の正規ロゴに差し替えが必要

残タスクと未決事項は `docs/引き継ぎ.md` を読むこと。
