# CLAUDE.md

このファイルは Claude Code（claude.ai/code）がこのリポジトリで作業する際のガイダンスを提供します。

## アーキテクチャ概要

これは**プロジェクト軸 × 日付軸を同時に見る**ための Tauri v2 デスクトップタスク管理アプリです。React フロントエンドと SQLite バックエンドで構成されています。

**技術スタック:**
- **フロントエンド**: React 18 + Vite + Tailwind CSS
- **デスクトップランタイム**: Tauri v2（Rust バックエンド）
- **データベース**: SQLite（`@tauri-apps/plugin-sql` + sqlx 経由）
- **状態管理**: React `useReducer` + Context（Redux なし）
- **AI 機能**: Node.js サイドカーサーバー → OpenAI API
- **データマイグレーション**: `/src-tauri/migrations/` に格納

**主要な設計判断:**
- `StoreContext` で useReducer を使用して全状態管理（`/src/store/StoreContext.jsx` 約 1200 行）
- 2 つの UI レイアウト：デスクトップ（2 ペイン Dashboard + SlideOver）と モバイル（タブ切り替え）
- 2 つのメインビュー：**コンソール**（カレンダー軸）と **WBS**（ガント図 + タスク階層）
- タスクは単日または複数日。プロジェクト + 日付で整理
- カスタムデザイン言語：和紙（背景）+ 墨（文字）+ 朱（完了の朱印）

## ディレクトリ構造

```
src/                          # React フロントエンド
├─ App.jsx                    # ルートコンポーネント、レスポンシブレイアウトロジック
├─ main.jsx                   # Vite エントリーポイント
├─ index.css                  # Tailwind + カスタムスタイル
├─ store/
│  └─ StoreContext.jsx        # useReducer による中央状態管理（最大ファイル、約 1200 行）
├─ screens/
│  ├─ Today.jsx               # 本日のタスク表示 + クイック追加
│  ├─ Calendar.jsx            # 月カレンダー（日ごとのタスク数表示）
│  ├─ Log.jsx                 # 月次統計 + 完了履歴
│  ├─ Inbox.jsx               # 日付未定タスク（scheduled_date なし）
│  └─ Wbs.jsx                 # ガント図 + 階層的タスクツリー（約 1900 行）
├─ components/                # 再利用可能な UI コンポーネント
│  ├─ TaskItem.jsx            # 単一タスク行（インライン編集、約 700 行）
│  ├─ AddTaskBar.jsx          # クイック追加 + AI 自然言語入力
│  ├─ SettingsModal.jsx       # 設定、バックアップ、カテゴリ/タグ管理（約 600 行）
│  ├─ ScheduleOverviewDialog.jsx  # WBS 時間軸オーバーレイ
│  ├─ TaskPicker.jsx          # 依存タスク選択用ツリーピッカー
│  └─ ui/                     # Radix UI ベースの低レベルコンポーネント
└─ lib/
   ├─ date.js                 # 複雑な日付ロジック（start_date/end_date 同期、約 400 行）
   ├─ db.js                   # Tauri SQL プラグインラッパー
   ├─ wbs.js                  # ガント図レンダリング + ツリートラバーサル（約 400 行）
   ├─ dependencies.js         # タスク依存グラフ チェック
   ├─ ganttDepPath.js         # 依存線の SVG パス描画
   ├─ ganttBarColor.js        # ガント図バーの色割り当て
   ├─ exportExcel.js          # ExcelJS 経由の Excel 出力
   ├─ holidays.js             # 日本の祝日データ
   ├─ ai/                     # AI 関連ユーティリティ
   ├─ id.js                   # UID 生成（プレフィックス: "t_", "c_" など）
   ├─ tauri.js                # Tauri API ヘルパー
   └─ appConfig.js            # アプリレベルの定数

src-tauri/                    # Rust バックエンド
├─ src/
│  ├─ main.rs                 # Tauri セットアップ、プラグイン登録
│  └─ lib.rs                  # Tauri コマンドハンドラー
├─ migrations/                # SQL マイグレーション（001_init.sql → 008_add_task_times.sql）
├─ tauri.conf.json            # Tauri アプリ設定（version は package.json と同期）
└─ Cargo.toml                 # Rust 依存（version は tauri.conf.json と同期）

server/                       # Node.js AI サイドカー
├─ index.js                   # Express サーバー（ポート 8787）
└─ scripts/
   └─ smoke-test.js           # AI 機能のクイックテスト

.cursor/
└─ rules/
   └─ release-bump.mdc        # Cursor ルール：patch バンプ + コミット + プッシュ + タグを自動化
```

## よく使う開発タスク

### 開発環境セットアップ

```bash
# 依存ライブラリのインストール
npm install

# Tauri アプリ開発（DB + デスクトップ機能のテスト推奨）
npm run tauri dev
# デスクトップアプリウィンドウが開きます。ホットリロード有効。Rust 変更時のみビルド。

# ブラウザのみ開発（localStorage バックエンド、Tauri API なし）
npm run dev
# http://localhost:5173 で起動。UI の素早い反復に最適。

# AI サイドカー（別ターミナル、AI 機能をテストする場合）
# 1. .env.example を .env にコピー、OPENAI_API_KEY を設定
# 2. npm run dev:ai         # ポート 8787 で Express を起動
# 3. npm run dev (別ターミナル)  # Vite が /api/ai リクエストをプロキシ
```

### ビルド・リリース

```bash
# 本番ビルド
npm run build
npm run preview  # ビルド出力をローカルテスト

# リリース（Cursor ルールが自動処理）
# 「バンプ」または「リリース」と入力すれば Cursor が以下を実行：
# 1. package.json, Cargo.toml, tauri.conf.json で patch バージョンを上げる
# 2. コミット + プッシュ
# 3. git tag vX.Y.Z + プッシュ
# 4. GitHub Actions ワークフロー（release.yml）が Windows バイナリをビルド、
#    Release を公開、auto-updater 用 latest.json を更新

# 手動でやる場合：
#   npm run build
#   git add package.json Cargo.toml src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/Cargo.lock
#   git commit -m "feat: ... し vX.Y.Z にバンプ"
#   git tag vX.Y.Z
#   git push origin HEAD vX.Y.Z
```

### AI 機能のテスト

```bash
# ワンライナー（.env に OPENAI_API_KEY が必要）
npm run ai:smoke "明日までにレポート提出"
```

## 状態管理とデータフロー

### 状態形（`StoreContext` 内）

```javascript
{
  tasks: [
    {
      id, title, status: 'TODO' | 'DONE',
      scheduled_date,          // 単日タスク用
      start_date, end_date,    // 複数日タスク用（WBS）
      completed_at,            // 完了時のタイムスタンプ
      category_id, tag_id,     // カテゴリ/タグへの参照
      is_today_top3,           // 「今日の 3 つ」にピン留め
      parent_id,               // WBS 階層（null = トップレベル）
      sort_order,              // 同一親内の表示順
      start_time, end_time,    // WBS 時間軸（HH:MM:SS）
      created_at, updated_at
    }
  ],
  categories: [{ id, name, sort_order, color, created_at, updated_at }],
  tags: [{ id, name, color, sort_order, created_at, updated_at }],
  projects: [],  // 予約済み、このバージョンではまだ未使用
  activities: [],  // アクティビティログエントリ
  checklistItems: [],  // チェックリスト子タスク
  dependencies: []  // タスク依存グラフ
}
```

### Reducer アクション（`StoreContext` 内）

主なアクションタイプ: `ADD_TASK`, `UPDATE_TASK`, `DELETE_TASK`, `COMPLETE_TASK`, `ADD_CATEGORY`, `BULK_UPDATE` など。詳細は `StoreContext.jsx` を参照。

**注意:** 大型 reducer であり、変更時は状態更新と DB アップサート の両方をトリガーすることが多い。

### データベース・同期

- **Tauri ビルド**: SQLite データベースファイルは `tauri::api::path::AppLocalDataDir`（通常 `%APPDATA%/task-manager/`）に保存
- **ブラウザビルド**: localStorage にフォールバック（キー: `taskmanager.v1`）
- **同期**: `StoreContext` reducer が `dbUpsert*()` ヘルパーを呼び出し、Tauri SQL プラグインコマンドを実行
- **マイグレーション**: アプリ起動時に Tauri SQL プラグインで自動適用

## 重要なパターンと特異性

### 日付処理（src/lib/date.js）

複雑です。タスクは以下のいずれかを持つことができます：
- `scheduled_date`（コンソールビューの単日）
- `start_date` + `end_date`（WBS ビューの複数日）
- 両方を持つタスクもあり、同期ロジックが一貫性を保つ

重要な関数:
- `normalizeConsoleDateRange()` — コンソール開始/終了を WBS 日付と調整
- `syncedDateFields()` — パッチオブジェクトで両方の日付スキーム を同期
- `unifyTaskDates()` — フォーマット間を変換
- `syncDatePatch()` — 日付変更を依存タスクに適用

### WBS 階層・レンダリング（src/lib/wbs.js）

- タスクは `parent_id` 参照でツリーを形成
- レンダリングは深さ優先トラバーサルと兄弟順序追跡を使用
- `seedSortOrderFromStartDate()` — 子を start_date で自動順序付け
- ガント図バーは `start_date` から `end_date` にまたがる；依存線は SVG パスで描画
- 時間軸（start_time / end_time）はガント図上にオーバーレイ；「営業時間」フォーカスモード可能

### レスポンシブレイアウト（src/App.jsx）

- `useMediaQuery('(min-width: 1024px)')` で `<Dashboard />`（並列）と `<Tabbed />`（タブ）を切り替え
- デスクトップ: Today ペイン + Calendar ペイン + Inbox/Log/Settings を SlideOver として表示
- モバイル: タブベースナビゲーション（Today, Calendar, Log, Inbox）
- ビュー切り替え: コンソール（カレンダー）対 WBS（ガント）

### タスク完了・アンドゥ

- 完了マーク → `completed_at` タイムスタンプを設定、status → 'DONE'、UI はフェード
- 削除 → アンドゥキューに移動、トースト表示、約 5 秒後に自動戻す
- `UndoToast` コンポーネントが管理

## 開発上の注意点

### 状態修正時

常に React 状態（useReducer）と SQLite（`dbUpsert*` 経由）の両方を更新してください。ヘルパーは `StoreContext` に入っています:
- `dbUpsertTask(db, task)`
- `dbUpsertCategory(db, cat)`
- `dbUpsertTag(db, tag)`
- `dbDeleteTask(db, taskId)`

### カスタムスタイリング

- `@tailwindcss/vite` プラグイン経由の Tailwind（ゼロコンフィグ）
- `src/index.css` のカスタムテーマ（和紙/墨/朱パレット）
- 外部アイコンライブラリなし；`lucide-react` を使用（ツリーシェイク可）

### パフォーマンスの考慮

- `Wbs.jsx` 約 1900 行；大型ガント図をレンダリング；`useMemo` でツリートラバーサルをメモ化
- `StoreContext` は単一の大型 reducer；さらに成長する場合は分割を検討
- 月表示は同月内のタスク更新時に再レンダリングしない（メモ化）

### AI 機能

- AddTaskBar の **AI ボタン**でトリガー
- Node.js サイドカー経由で `/api/ai/parse` を呼び出し
- 自由形式テキストを構造化タスクフィールド（title、date、category）に解析
- `OPENAI_API_KEY` が `.env` に必要

### リリース・バージョンバンプ（「バンプ」の一言で完了）

「バンプ」「push バンプして」「リリース」など、リリース意図の短い指示が来たら、**確認せず**次を全部やる（このリポジトリでの標準リリース手順として、ユーザーから事前に許可されている）。

1. patch バージョンを 1 上げる（例: `0.1.31` → `0.1.32`）
2. 同期するファイル: `package.json`, `package-lock.json`（ルート version のみ）, `src-tauri/Cargo.toml`（`name = "app"` の version）, `src-tauri/Cargo.lock`（同上）, `src-tauri/tauri.conf.json`
3. 未コミットの機能変更も同じコミットに含める（`logs/` は含めない）
4. コミットメッセージは既存スタイルに合わせる: `feat|fix|chore: …し vX.Y.Z にバンプ`
5. `git push origin HEAD`
6. `git tag vX.Y.Z` → `git push origin vX.Y.Z`（これがデプロイ。`.github/workflows/release.yml` が Windows ビルド・GitHub Release・updater 用 `latest.json` を作成）
7. `gh run watch` でワークフロー完了を待つ必要はない

タグ push まで完了して初めてデプロイ完了。push だけ・タグなし、は未完了。

（同じルールが `.cursor/rules/release-bump.mdc` にも Cursor 用として定義されている。両ツールで挙動を揃えるため、変更する場合は両方更新すること。）

## よくある編集ファイル

| タスク | 主なファイル |
|------|-----------|
| 新しいタスクフィールドを追加 | `StoreContext`（ADD_TASK アクション）+ マイグレーション（`.sql`）+ `TaskItem.jsx`（編集 UI）|
| 日付ロジックを変更 | `src/lib/date.js` + 関連 reducer |
| ガント図レンダリングを修正 | `Wbs.jsx` + `src/lib/wbs.js` |
| 新しいカテゴリ/タグを追加 | `SettingsModal.jsx`（UI）+ `StoreContext`（reducer + dbUpsert） |
| レスポンシブブレークポイント変更 | `App.jsx` メディアクエリ + 影響を受ける画面レイアウト |
| 色をカスタマイズ | `src/index.css`（CSS 変数）+ `ganttBarColor.js`（タスク固有の場合） |

## 参考リンク・リファレンス

- **Tauri ドキュメント**: https://tauri.app/v2/
- **React Hooks**: useReducer + Context（外部状態管理ライブラリなし）
- **SQLite マイグレーション**: Tauri SQL プラグイン経由で起動時に自動適用
- **日本語タスク管理の哲学**: `SPEC.md`（仕様書）を参照、デザイン意図を確認
- **Cursor リリースルール**: `.cursor/rules/release-bump.mdc` 参照
