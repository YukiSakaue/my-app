# my-app

小規模チーム向けのタスク管理ツール。リーダーがタスクを割り振り、進捗と作業時間を記録・閲覧する。

## できること

- サインアップ / ログイン / ログアウト（パスワードは bcrypt でハッシュ化、JWT を httpOnly Cookie に保存）
- チームの作成、招待コードによるメンバー追加、権限（leader / member）の変更
- タスクの作成・編集・削除・割り当て、ステータス変更と変更履歴
- 作業時間の記録（タイマー / 手入力）
- チームダッシュボード、タスク別の見積 vs 実績、個人ビュー

## 技術構成

Node.js 22 / Express 5 / PostgreSQL（`pg` で SQL を直接記述、ORM なし） /
マイグレーションは `node-pg-migrate` / 画面は EJS のサーバーサイドレンダリング /
テストは `node:test` + `supertest`

## ローカルでの起動手順

### 1. PostgreSQL を用意する

```bash
sudo apt update && sudo apt install -y postgresql
sudo service postgresql start
sudo -u postgres psql -c "CREATE USER myapp WITH PASSWORD 'myapp' CREATEDB;" \
                      -c "CREATE DATABASE my_app OWNER myapp;" \
                      -c "CREATE DATABASE my_app_test OWNER myapp;"
```

WSL では再起動のたびに `sudo service postgresql start` が必要。

### 2. 依存関係と環境変数

```bash
npm ci
cp .env.example .env
```

`.env` を開いて `DATABASE_URL` と `JWT_SECRET` を設定する。`JWT_SECRET` は次で生成できる。

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### 3. マイグレーションと起動

```bash
npm run migrate
npm run dev
```

<http://localhost:3000> を開く。

## npm scripts

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | ファイル変更で自動再起動して起動 |
| `npm start` | 起動する |
| `npm run migrate` | `.env` の DB にマイグレーションを適用する |
| `npm run migrate:test` | `.env.test` の DB にマイグレーションを適用する |
| `npm test` | テスト用 DB にマイグレーションを適用してからテストを実行する |

## テスト

```bash
npm test
```

テストはローカルの `my_app_test` を truncate しながら実行する。誤って本番 DB を
壊さないよう、`NODE_ENV=test` で `DATABASE_URL` がローカルを指していない場合は
起動時に例外を投げる（`src/config.js`）。テスト用の設定は `.env.test` に書く。

```
NODE_ENV=test
DATABASE_URL="postgresql://myapp:myapp@localhost:5432/my_app_test"
JWT_SECRET="test-only-secret"
```

## Render へのデプロイ手順

### 1. PostgreSQL を作る

Render ダッシュボードで **New +** → **Postgres** を作成する（無料プランはリージョン
Ohio、作成から30日で失効する点に注意）。

### 2. Blueprint からサービスを作る

**New +** → **Blueprint** → このリポジトリを選ぶ。`render.yaml` が読み込まれ、
Web サービスが作られる。`JWT_SECRET` は Render 側で自動生成される。

### 3. DATABASE_URL を設定する

作成した PostgreSQL の **Connections** にある **Internal Database URL** をコピーし、
Web サービスの **Environment** で `DATABASE_URL` に設定する。

外部から接続する場合（ローカルの `psql` など）は **External Database URL** を使い、
末尾に `?sslmode=verify-full` を付ける。証明書の検証は無効化しないこと。

> ローカルの `psql` で External URL に繋ぐ場合は、ルート証明書ファイルが必要なため
> `?sslmode=require` を使う。アプリと `node-pg-migrate` は Node 内蔵の CA を使うので
> `verify-full` のままで動く。

### 4. デプロイ

デプロイのたびに起動時に `npm run migrate` が実行され、マイグレーションが適用される。
`/healthz` がヘルスチェックに使われ、DB に到達できない場合は 503 を返してデプロイが
失敗する。

## 環境変数

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `DATABASE_URL` | ○ | PostgreSQL の接続 URL。SSL の要否は `sslmode` で指定する |
| `JWT_SECRET` | ○ | JWT の署名鍵。変更すると全員のログインが切れる |
| `PORT` | | 省略時は 3000。Render では自動で設定される |
| `NODE_ENV` | | `test` のときテスト用の安全確認が有効になる |

## ディレクトリ構成

```
src/
  app.js            Express アプリの組み立て（listen はしない）
  server.js         0.0.0.0 で listen する
  config.js         環境変数の読み込みと起動時の検証
  db.js             pg の接続プールと query ヘルパ
  lib/              ハッシュ・JWT・入力検証・表示整形などの部品
  middleware/       認証・権限・エラーハンドリング
  models/           SQL によるデータアクセスと集計
  routes/           ルーティング
migrations/         node-pg-migrate のマイグレーション
views/              EJS のテンプレート
test/               node:test によるテスト
docs/spec.md        仕様書
```
