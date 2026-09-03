# Cursor イベント記録

Cursor Agent Chat の操作を Hook で記録し、ローカル JSONL と PostgreSQL に保存します。

## 構成

```text
Cursor Agent Chat
  → Hook (.cursor/hooks/audit.py)
  → .cursor/cursor-events.jsonl
  → Events API（npm run events:api / localhost:8788）
  → PostgreSQL（172.16.57.201:5432 / cursor_events）
```

Hook は `sessionStart` / `sessionEnd` / `preToolUse` / `postToolUse` / `afterFileEdit` / `afterAgentResponse` / `subagentStart` / `subagentStop` を監視します。

## 日常運用

1. ターミナルで `npm run events:api` を起動したままにする
2. Cursor で Agent Chat を使う → 自動で JSONL + PostgreSQL に記録
3. 振り返りは SQL または `.cursor/cursor-events.jsonl` で確認

接続テスト: `npm run cursor-events:smoke`

## 環境変数（`.env`）

| 変数 | 例 |
|------|-----|
| `POSTGRES_HOST` | `172.16.57.201` |
| `POSTGRES_PORT` | `5432` |
| `POSTGRES_DB` | `cursor_audit` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` | （DB ユーザー） |
| `CURSOR_EVENTS_API_URL` | `http://127.0.0.1:8788/api/events` |
| `CURSOR_EVENTS_PROJECT` | `task-manager` |

## 関連ファイル

| ファイル | 役割 |
|----------|------|
| `.cursor/hooks.json` | Hook 定義 |
| `.cursor/hooks/audit.py` | ログ記録 + API 転送 |
| `.cursor/hooks/audit.cmd` | Windows UTF-8 起動 |
| `db/cursor_events.sql` | DB テーブル |
| `server/cursor-events-api.js` | Events API |
| `server/scripts/cursor-events-smoke.js` | 接続テスト |

## 確認用 SQL

```sql
-- 直近イベント
SELECT recorded_at, event_type, tool_name, session_id
FROM cursor_events
ORDER BY recorded_at DESC
LIMIT 20;

-- Tool 別利用回数（過去7日）
SELECT tool_name, COUNT(*) AS cnt
FROM cursor_events
WHERE event_type = 'postToolUse'
  AND recorded_at >= NOW() - INTERVAL '7 days'
GROUP BY tool_name
ORDER BY cnt DESC;

-- 今日のセッション数
SELECT COUNT(DISTINCT session_id)
FROM cursor_events
WHERE event_type = 'sessionStart'
  AND recorded_at >= CURRENT_DATE;
```

## 参考

- [Cursor Hooks 公式](https://cursor.com/docs/hooks)
- 作業ログ: [logs/0901.md](../logs/0901.md)
- Grafana（任意）: [grafana/README.md](../grafana/README.md)
