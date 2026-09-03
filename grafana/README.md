# Grafana — AI開発利用状況 Dashboard

`cursor_events` テーブル（PostgreSQL）を Grafana で可視化します。

## 前提

- PostgreSQL: `172.16.57.201:5432` / DB: `postgres`
- テーブル `cursor_events` にデータが入っていること
- Events API (`npm run events:api`) が動いていて Cursor からイベントが届いていること

## 手順 A: Docker で Grafana を起動（推奨）

VM（172.16.57.201）または Windows 上で:

```bash
cd grafana

# パスワードが違う場合は provisioning/datasources/postgres.yml を編集
docker compose up -d
```

ブラウザで開く: **http://172.16.57.201:3001**（ローカルなら http://localhost:3001）

- ユーザー: `admin`
- パスワード: `admin`（初回ログイン後に変更を促されます）

ダッシュボード **「AI開発利用状況 Dashboard」** が自動で読み込まれます。

### ビュー作成（任意）

クエリを簡潔にするビューを作る場合:

```bash
psql -h 172.16.57.201 -U postgres -d postgres -f ../db/cursor_events_views.sql
```

## 手順 B: 既存 Grafana にインポート

Grafana がすでに動いている場合:

1. **Connections → Data sources → Add data source → PostgreSQL**
   - Host: `172.16.57.201:5432`
   - Database: `postgres`
   - User / Password: `.env` と同じ値
   - TLS/SSL Mode: `disable`
   - **Save & test**

2. **Dashboards → New → Import**
   - `grafana/dashboards/cursor-ai-usage.json` をアップロード
   - Data source で上記 PostgreSQL を選択

## ダッシュボードの内容

| パネル | 内容 |
|--------|------|
| Agent セッション数 | `sessionStart` のユニーク session_id |
| Tool 実行回数 | `postToolUse` の件数 |
| Shell 実行回数 | tool_name = Shell |
| ファイル編集数 | `afterFileEdit` |
| 入力/出力トークン合計 | `afterAgentResponse` |
| イベント数（種別別） | 時間推移グラフ |
| Tool 利用（時間別） | Read / Write / Shell など |
| Tool 別利用回数 | 横棒グラフ |
| 直近イベント | 最新 50 件のテーブル |
| セッション一覧 | セッションごとの Tool 数・トークン |

右上の時間範囲（デフォルト: 過去 24 時間）を変えると集計が切り替わります。

## ポート一覧（VM）

| サービス | ポート |
|----------|--------|
| Grafana | 3001 |
| PostgreSQL | 5432 |
| Events API | 8788 |

## トラブルシュート

**No data と表示される**

- 時間範囲を「Last 7 days」などに広げる
- SQL で確認:

```sql
SELECT COUNT(*) FROM cursor_events;
SELECT recorded_at, event_type, tool_name FROM cursor_events ORDER BY recorded_at DESC LIMIT 5;
```

**Data source 接続エラー**

- VM のファイアウォールで 5432 が開いているか
- `pg_hba.conf` でクライアント IP からの接続が許可されているか

**ダッシュボードが空**

- Data source の UID が `postgres-cursor` か確認（手動インポート時はマッピングで選択）
