# sea-style-calendar

SEA-STYLE クラブ艇空き情報まとめ表示ツール

ヤマハマリンクラブ・シースタイルの「クラブ艇空き情報」ページから、指定した月の空き枠を一括取得して表示するシンプルなクライアントサイドアプリです。

> **注意**
> - 本ツールは公式 API を使用していないため、将来的にサイト構成や API が変更された場合は動作しなくなる可能性があります。
> - CORS 制限やアクセス制限により、ブラウザから直接データを取得できない場合があります。付属のローカルプロキシ（`server/proxy-server.js`）を利用するか、同等の中継手段を用意してください。

## 機能概要

- マリーナ名から候補を検索して選択し、表示したい月を指定すると、月内すべての日付の空き枠をまとめて一覧表示します。
- 表示月はプルダウンから選択でき、最大で当月から 5 ヵ月先まで切り替えられます。
- 取得した各日の空き枠は、艇ごとのグループで時系列に表示します。
- デバッグ用途として、取得した元データ（JSON もしくは HTML）を確認できるようにしています。

## 使い方

1. リポジトリをクローンしたディレクトリで、任意の静的ファイルサーバーを起動します。

   ```bash
   # 例: Python を利用する場合
   python -m http.server 5173
   ```

   `npm` や `pnpm` を利用している場合は、`serve` などのユーティリティを使っても構いません。

2. ブラウザで `http://localhost:5173/` にアクセスします。ローカルプロキシを利用する場合は、URL の末尾に `?apiBase=http://localhost:8787` などプロキシのベース URL を指定してください。
3. マリーナ名を入力すると候補が表示されるので、目的のマリーナを選択し、表示月を選んで「表示する」をクリックします。初期状態では「勝どきマリーナ」が選択されています。
4. 各日の空き状況がカード形式で表示されます。

URL パラメーター `?marinaCd=XXXX&month=YYYY-MM` や `?marinaName=マリーナ名` を指定すると、初期表示時に自動で検索が実行されます。

### CORS 制限の回避（最小構成のローカルプロキシ）

Sea-Style の本番ドメインは CORS を許可していないため、ブラウザから直接アクセスすると `TypeError: Failed to fetch` などのエラーが発生します。リポジトリには最小構成の Node.js 製リバースプロキシを同梱しているので、以下の手順で中継してください。

1. 依存関係は不要です。Node.js 18 以上がインストールされていることを確認します。
2. リポジトリのルートで以下を実行し、ポート `8787` でプロキシを起動します。

   ```bash
   node server/proxy-server.js
   ```

   必要に応じて `PORT` や `SEA_STYLE_TARGET_ORIGIN` 環境変数で設定を上書きできます。

3. 別ターミナルで静的ファイルサーバー（例: `python -m http.server 5173`）を起動し、ブラウザから `http://localhost:5173/index.html?apiBase=http://localhost:8787` にアクセスします。

4. プロキシ経由で取得が行われ、ブラウザのコンソールに CORS エラーが表示されなくなります。

`?apiBase=` パラメーターを指定する代わりに、`window.__SEA_STYLE_API_BASE_URL__` グローバル変数や `<meta name="sea-style-api-base">` を利用してベース URL を設定することも可能です。

## GitHub から最新の変更を取り込む

リポジトリにリモートが設定されていない場合でも、`scripts/update-from-github.sh` を使うと GitHub 上の任意のリポジトリから最新の変更を取り込めます。ネットワーク接続と GitHub へのアクセス権がある環境で、以下のように実行してください。

```bash
# 例: openai/sea-style-calendar リポジトリの main ブランチを取得する場合
scripts/update-from-github.sh openai/sea-style-calendar main
```

スクリプトは `upstream` というリモートを追加（または更新）し、指定したブランチをフェッチして現在のブランチを高速進行（fast-forward）で同期します。fast-forward ができない場合はマージが必要となるため、出力に従って手動で解決してください。

GitHub への直接アクセスが制限されている環境では、`--base-url` オプションまたは `GITHUB_BASE_URL` 環境変数でミラーを指定できます。また、`--remote-name` や `--branch` オプションを使ってリモート名や対象ブランチを切り替えることも可能です。

それでも `git fetch` が失敗する場合は、GitHub (またはミラー) が提供するアーカイブ (`https://github.com/<owner>/<repo>/archive/refs/heads/<branch>.tar.gz` 形式) をダウンロードし、環境変数 `SEA_STYLE_ARCHIVE` にローカルパスを指定してスクリプトを実行すると、アーカイブの内容が作業ツリーに展開されます。

```bash
# 例: アーカイブを自分でダウンロード済みの場合
curl -L -o /tmp/sea-style-calendar.tar.gz \
  https://github.com/openai/sea-style-calendar/archive/refs/heads/main.tar.gz
SEA_STYLE_ARCHIVE=/tmp/sea-style-calendar.tar.gz \
  scripts/update-from-github.sh openai/sea-style-calendar main
```

アーカイブ展開時は `.git/` ディレクトリを除いて上書きするため、既存ファイルは最新状態に置き換えられます。`git status` で差分を確認し、必要に応じてコミットしてください。

```bash
# 例: hub.fastgit.org ミラー経由で remote 名を mirror に変更する
scripts/update-from-github.sh \
  --base-url https://hub.fastgit.org \
  --remote-name mirror \
  openai/sea-style-calendar main
```

ミラーでも取得できない場合は、利用可能なプロキシ設定を確認するか、GitHub へ到達できるネットワークで同期を実行して成果物を持ち込む方法をご検討ください。

## ローカルプレビューの例

Python の簡易サーバーを使用した場合は、以下のようにアクセスできます。

1. `python -m http.server 8000` を実行する。
2. ブラウザで `http://localhost:8000/index.html` にアクセスする。
3. 勝どきマリーナを初期値とした一覧が読み込まれます。そのまま他のマリーナ名を入力すると候補がサジェストされるので、任意のマリーナを選んで月を切り替えてください。

## 実装メモ

- `src/api/seaStyleApi.js` に、日単位の空き枠を取得する `SeaStyleApi` クラスを実装しています。
  - まず JSON API（`/api/Reserve/GetClubBoatEmptyList`）への POST を試行し、失敗した場合は HTML 断片の取得を試みます。
  - 取得したレスポンスから空き枠を抽出する際は、さまざまなフィールド名に対応できるようヒューリスティックに解析しています。
- `src/main.js` では、月内の各日を逐次リクエストしながら結果を描画します。取得処理は `AbortController` を使って中断可能です。
- CSS は `styles/main.css` にまとめており、スマートフォンでも見やすいようレスポンシブなレイアウトを採用しています。

## カスタマイズ

- 取得する API やヘッダー値を調整したい場合は、`SeaStyleApi` のコンストラクターにオプションを渡すか、`DEFAULT_STRATEGIES` を書き換えてください。
- 表示対象の月数を変更したい場合は、`createMonthOptions` の引数を調整します。
- 状態ラベルや色分けを変更したい場合は、`STATUS_LABELS` や CSS 内のスタイルを編集してください。

## ライセンス

このリポジトリは MIT License の下で提供されています。
