# システム分析 — タスク管理アプリ

作成日: 2026-08-31
対象バージョン: 0.1.2
対象ブランチ: main

> 本ドキュメントは調査結果のまとめです。コード変更は行っていません。

---

## 1. システム概要

「今日やることを簡単に管理し、あとから自分が何をしたか振り返る」ことを目的とした、
**個人用のデスクトップ・タスク管理アプリ**。React + Tauri で実装された Windows 向けネイティブアプリ。

コアコンセプトは仕様書（[SPEC.md](../SPEC.md)）に基づく **「日付軸 × プロジェクト軸の共存」**：

- プロジェクトを大枠（入れ物）とし、その中のタスクを日付で回す。
- 単に日付で並べるのではなく、各日付の中でプロジェクトごとにグループ化して見せる。
- 同一データを **コンソール（カレンダー中心）** と **WBS/ガント** の 2 視点で切り替えて見る。

デザイン言語は「**色 = 達成の記録**」。和紙(washi)/墨(sumi)/朱(shu) の 3 値配色を基調とし、
プロジェクト識別色を加える。未完了は墨色、完了で朱が現れる、という思想が UI と Excel 出力の双方に貫かれている。

### 主要な特徴

| 項目 | 内容 |
|---|---|
| 種別 | デスクトップアプリ（Tauri v2 / Windows） |
| フロントエンド | React 18 + Vite 5（ビルドツール） |
| 状態管理 | `useReducer` + Context（外部ライブラリなし） |
| 永続化 | SQLite（`tauri-plugin-sql`、DBファイル `tasks.db`） |
| 配布 | GitHub Releases + Tauri 自動アップデータ（署名付き） |
| レイアウト | ノートPC（≥1024px）: 2ペイン1画面／モバイル: 下部タブ切替 |

> **注意**: [README.md](../README.md) は「localStorage 保存・依存ゼロのブラウザアプリ」と記載しているが、
> これは初期 MVP の内容で **実装と乖離している**（現在は Tauri + SQLite）。→ 6章「技術的負債」参照。

---

## 2. ディレクトリ構成

```
タスク管理/
├── index.html                     # Vite エントリ
├── package.json                   # v0.1.2 / 依存定義
├── vite.config.js
├── README.md                      # ※内容が古い（localStorage 前提）
├── SPEC.md                        # 現行コンセプト仕様（日付×PJ共存, WBS）
├── 個人用タスク管理ツール 仕様書.md   # 初期MVP仕様（別モデル・要整理）
│
├── src/                           # フロントエンド（React）
│   ├── main.jsx                   # ReactDOM ルート / テーマ初期適用
│   ├── App.jsx                    # 画面シェル（Dashboard=PC / Tabbed=モバイル）
│   ├── index.css                  # 全スタイル（washi/sumi/shu, ダークテーマ）
│   │
│   ├── store/
│   │   └── StoreContext.jsx       # ★中核: reducer + DB同期 + actions + Context
│   │
│   ├── screens/                   # 画面（ビュー）
│   │   ├── Today.jsx              # 本日のタスク（プロジェクト・レーン）+ Inbox
│   │   ├── Calendar.jsx           # 週/2週/月カレンダー（期間バンド展開・D&D）
│   │   ├── Wbs.jsx                # WBSツリー + ガントチャート + Excel出力
│   │   ├── Log.jsx                # 月次集計・完了履歴・レポート出力
│   │   └── Inbox.jsx              # 日付未定タスクの一時保管
│   │
│   ├── components/                # UI部品
│   │   ├── AddTaskBar.jsx         # クイック追加（詳細/子タスク付き）
│   │   ├── TaskList.jsx           # 並び替え可能なタスクリスト（HTML5 DnD）
│   │   ├── TaskItem.jsx           # タスク1件（編集/完了/子タスク/アクティビティ）
│   │   ├── ActivityPanel.jsx      # タスク単位のメモ（作業ログ）
│   │   ├── SettingsModal.jsx      # 設定（PJ/カテゴリ/DBパス/テーマ/リセット）
│   │   ├── ProjectFilter.jsx      # プロジェクト絞り込みピル
│   │   ├── Nav.jsx                # BottomNav（+ 未使用の DesktopNav）
│   │   └── UndoToast.jsx          # 削除取り消しトースト
│   │
│   └── lib/                       # 純粋ロジック・ユーティリティ
│       ├── date.js               # 日付文字列(YYYY-MM-DD)ヘルパ
│       ├── holidays.js           # 日本の祝日算出（春分/秋分/振替休日含む）
│       ├── wbs.js                # WBSツリー構築・ロールアップ・インデント
│       ├── exportExcel.js        # ExcelJS でガント帳票を生成（遅延import）
│       ├── appConfig.js          # DBパス設定（tauri-plugin-store）
│       └── id.js                 # 簡易ユニークID生成
│
├── src-tauri/                     # バックエンド（Rust / Tauri）
│   ├── src/
│   │   ├── main.rs               # エントリ（app_lib::run 呼び出し）
│   │   └── lib.rs                # プラグイン登録・マイグレーション定義
│   ├── migrations/
│   │   ├── 001_init.sql          # categories/projects/tasks/activities
│   │   └── 002_add_console_end_date.sql
│   ├── capabilities/default.json  # 権限（sql/store/dialog）
│   ├── tauri.conf.json            # ウィンドウ・updater・bundle 設定
│   ├── Cargo.toml                 # Rust 依存（tauri plugins）
│   └── icons/
│
├── .github/workflows/release.yml  # タグ push → 自動リリース
└── ~/.tauri/task-manager.key(.pub)# ★署名鍵（後述: セキュリティ問題）
```

---

## 3. 主要機能

### 3.1 ビューの二本立て（同一データ・2視点）
ヘッダーの `ViewToggle` で **コンソール** ↔ **WBS** を切り替え。データモデルは 1 つで、見せ方だけが異なる。

### 3.2 コンソール（Today + Calendar の2ペイン）
- **Today**（[Today.jsx](../src/screens/Today.jsx)）
  - 本日のタスクを **プロジェクト・レーン**（未分類レーン含む）にグループ表示。
  - 「予定日超過」の未完了タスクを別枠で警告表示（期間タスクは `console_end_date` を過ぎて初めて超過扱い）。
  - タスクを別レーンにドロップ → プロジェクト割り当て + 当日へ移動。
  - Inbox（日付未定）への表示とドロップ移動。
  - 優先度（★=high）や `sort_order` によるソート。
- **Calendar**（[Calendar.jsx](../src/screens/Calendar.jsx)）
  - 週 / 2週 / 月の3モード。月〜金の平日グリッド。
  - 期間タスクを `scheduled_date`〜`console_end_date` の全日に展開し、帯（start/mid/end/single）として描画。
  - 日本の祝日表示（[holidays.js](../src/lib/holidays.js)）。
  - タスクを別日にドロップ → リスケジュール（`console_end_date` は畳む）。
  - プロジェクト色 / カテゴリ色でラベル着色。

### 3.3 WBS / ガントチャート（[Wbs.jsx](../src/screens/Wbs.jsx)）
- プロジェクトを1つ選択して表示（親子ツリー）。
- WBS番号（1, 1.1, 1.1.2…）、進捗ロールアップ（葉の完了数を親に集計）。
- 左：ツリー（折り畳み・インライン編集・インデント/アウトデント・子追加・削除・期間設定ポップオーバー）。
- 右：ガント帯（葉タスクは帯ドラッグで移動・端リサイズ → `start_date`/`end_date` 更新）。親帯は子スパンの自動集計。
- 日/週/月ズーム、今日ライン、今日へスクロール。
- **「日程を更新」**: WBSの `start_date`/`end_date` を `scheduled_date`/`console_end_date` に一括反映（明示操作でのみコンソールへ波及）。
- **Excel出力**（[exportExcel.js](../src/lib/exportExcel.js)）: 条件付き書式でガント帯を動的描画する `.xlsx` を生成。画面の配色をそのまま帳票へ移植。

### 3.4 Log（[Log.jsx](../src/screens/Log.jsx)）
- 月次集計（完了 / 未完了 / 翌月繰越 / 完了率）、カテゴリ別完了数、日別完了履歴。
- 「今月やったことをコピー」（Markdown 風テキストをクリップボードへ）。
- 月次レポート `.txt` 書き出し。

### 3.5 タスク編集・付随機能
- インライン編集（タイトル/日付/プロジェクト/カテゴリ）、モーダル最小化の方針。
- **子タスク（サブタスク）**: 親子構造、カスケード完了、追加バー/メニューから追加。
- **アクティビティ**（[ActivityPanel.jsx](../src/components/ActivityPanel.jsx)）: タスク単位の作業メモ（追記・編集・削除）。
- 削除は **Undoトースト**（6秒）付き。
- クイック追加バーで「詳細」（日付・PJ・カテゴリ・優先度・子タスク）を展開可能。

### 3.6 設定（[SettingsModal.jsx](../src/components/SettingsModal.jsx)）
- プロジェクト / カテゴリ の追加・改名・色変更・削除。
- **DBファイル保存先の変更**（OneDrive/Dropbox 等を指定し複数PC同期を意図）。
- ライト / ダークテーマ切替。
- 全データリセット（確認ダイアログ付き）。
- バージョン表示。

### 3.7 自動アップデート（[App.jsx](../src/App.jsx)）
- 起動時に `check()` → 新版があればダイアログで確認 → `downloadAndInstall()`。

---

## 4. データフロー

### 4.1 データモデル（SQLite / [001_init.sql](../src-tauri/migrations/001_init.sql) + [002](../src-tauri/migrations/002_add_console_end_date.sql)）

```
categories(id, name, sort_order, created_at, updated_at)
             ※ UI上は color も扱うが DBカラムが無い → 永続化されない（6章参照）
projects  (id, name, color, sort_order, created_at, updated_at)
tasks     (id, title, status, scheduled_date, completed_at, category_id,
           project_id, parent_id, start_date, end_date, priority,
           sort_order, recurrence, created_at, updated_at, console_end_date)
activities(id, task_id, body, created_at, updated_at)
```

- **日付の二層構造**（メモリ [console-wbs-date-model] と整合）:
  - WBS層: `start_date` / `end_date`（ガント上で編集）。
  - コンソール層: `scheduled_date` / `console_end_date`（カレンダーに表示される帯）。
  - 両者は独立し、**「日程を更新」ボタンでのみ** WBS→コンソールに反映される。
- `recurrence` カラムは存在するが繰り返し機能は未実装（将来用）。

### 4.2 実行時のデータフロー

```
起動
 └─ StoreProvider (useReducer, 初期state=空)
      └─ loadState(): getDb() → 4テーブルを SELECT → dispatch(INIT)
           └─ カテゴリが空なら DEFAULT_CATEGORY_NAMES=['開発'] を INSERT

ユーザー操作（例: タスク追加）
 └─ actions.addTask(input)
      └─ dispatchWithSync(action)
           ├─ dispatch(action)                        … React state を更新（再描画）
           ├─ nextState = reducer(prevState, action)  … 差分計算用に再実行
           ├─ prevStateRef.current = nextState
           └─ syncToDb(prevState, nextState, action)  … action種別ごとに
                                                          差分を SQL 化して非同期書込

DBパス変更（設定）
 └─ reconnectDb(dir) → 旧DB close → tauri-plugin-store に保存 → 新URIで再接続
```

- **状態が Single Source of Truth**（メモリ上の React state）で、DB はそれをミラーする書き込み先。
- `syncToDb` は `action.type` ごとに switch し、変更されたレコードだけを `INSERT OR REPLACE` / `DELETE`。
- `IMPORT` / `RESET` は全テーブルを削除して作り直す。
- カレンダー/WBS の派生データ（帯展開・ツリー・集計）は `useMemo` で `state.tasks` から都度算出。

### 4.3 設定・テーマの保存経路
- DBパス: `tauri-plugin-store`（`config.json`）。
- テーマ / ペイン分割幅 / WBS列幅: ブラウザ `localStorage`（`taskmanager.*` キー）。

---

## 5. 外部依存

### 5.1 フロントエンド（[package.json](../package.json)）
| 依存 | 用途 |
|---|---|
| react / react-dom ^18.3 | UI |
| @tauri-apps/api ^2.11 | Tauri ブリッジ |
| @tauri-apps/plugin-sql ^2.4 | SQLite アクセス |
| @tauri-apps/plugin-store ^2.4 | 設定の永続化 |
| @tauri-apps/plugin-dialog ^2.7 | フォルダ選択・確認ダイアログ |
| @tauri-apps/plugin-updater ^2.10 | 自動アップデート |
| @tauri-apps/plugin-window-state ^2.4 | ウィンドウ位置/サイズ復元 |
| exceljs ^4.4 | Excel(.xlsx) 生成（遅延import） |
| vite ^5.4 / @vitejs/plugin-react | ビルド（devDependency） |

- **テスト系依存・Lint系依存は無し**（Vitest/Jest/ESLint いずれも未導入。コード内に `eslint-disable` コメントはあるが設定ファイルは追跡外）。

### 5.2 バックエンド（[Cargo.toml](../src-tauri/Cargo.toml)）
- tauri 2.11 + 各プラグイン（sql[sqlite] / store / dialog / updater / window-state / log）。
- serde / serde_json / log。

### 5.3 外部サービス・インフラ
- **GitHub Releases**: アップデータ配信元。
  - updater endpoint: `https://github.com/kabu33maribis-a11y/Task/releases/latest/download/latest.json`（[tauri.conf.json](../src-tauri/tauri.conf.json)）。
- **GitHub Actions**（[release.yml](../.github/workflows/release.yml)）: `v*` タグ push で `tauri-action` が Windows ビルド・署名・リリース作成。
  - 署名鍵は Secrets（`TAURI_SIGNING_PRIVATE_KEY` ほか）から供給。
- OS内蔵フォント（Yu Gothic 等）に依存、追加ダウンロードなし。

---

## 6. 技術的負債

深刻度順（🔴高 / 🟡中 / 🟢低）。

### 🔴 6.1 更新署名の秘密鍵がリポジトリにコミットされている
- `~/.tauri/task-manager.key`（rsign 暗号化秘密鍵）と `.key.pub` が **git 管理下**（`git ls-files` で確認）。
- パスワード暗号化されているとはいえ、秘密鍵の公開は重大なリスク。鍵＋パスワードが漏れれば
  **悪意ある更新に正当な署名を付与**でき、自動アップデータ経由で全ユーザーへ配布され得る。
- 対応方針: リポジトリ履歴からの除去、鍵のローテーション（`pubkey` 差し替え → 全ユーザー再インストール）、`.gitignore` へ追加。

### 🔴 6.2 reducer の二重実行と非純粋性による状態/DB 乖離リスク
- `dispatchWithSync`（[StoreContext.jsx](../src/store/StoreContext.jsx)）は、React の `dispatch(action)` に加え
  **同じ action で `reducer(prevState, action)` をもう一度実行**して差分計算用の `nextState` を得ている。
- しかし reducer は純粋ではない: `makeTask` が `uid()`（`Date.now()`+乱数）や `new Date().toISOString()` を使う。
  そのため **新規作成系（ADD_TASK / ADD_TASK_WITH_CHILDREN / ADD_ACTIVITY / ADD_CATEGORY / ADD_PROJECT）では、
  React 側に入る ID と、DB に書かれる ID が食い違い得る**。
  - 影響例: 追加直後（リロード前）にそのタスクを完了/更新しても、`syncToDb` が
    `nextState.tasks.find(id===action.id)` で対象を見つけられず **DB に反映されない**可能性。
- 対応方針: action 生成時に ID/タイムスタンプを確定して payload に載せる（reducer を純粋化）、
  または React の関数型更新＋`useEffect` での差分同期に一本化する。

### 🟡 6.3 カテゴリの色が永続化されない
- UI（[SettingsModal.jsx](../src/components/SettingsModal.jsx) の `ColorPickerSwatch`）でカテゴリ色を設定でき、
  Calendar はカテゴリ色をフォールバックに使う。しかし `categories` テーブルに **`color` カラムが無く**、
  `dbUpsertCategory` も 5 カラムしか書かない → **再起動で色が失われる**。
- 対応方針: マイグレーション追加（`ALTER TABLE categories ADD COLUMN color`）＋ upsert 更新。

### 🟡 6.4 ドキュメントの乖離・重複
- README は localStorage/ブラウザ前提のまま（実装は Tauri+SQLite）。
- 仕様書が 2 つ（[SPEC.md](../SPEC.md) と `個人用タスク管理ツール 仕様書.md`）あり、データモデルの表現が実装と一部異なる
  （例: SPEC は `kind`/`date`/`done` を用いた最小モデル。実装は `status`/`scheduled_date`/`console_end_date` 等）。
- 対応方針: README を現状に更新し、仕様書を単一の最新版へ統合。

### 🟡 6.5 自動テストが皆無
- ユニット/結合/E2E いずれも無し。祝日算出（[holidays.js](../src/lib/holidays.js)）、WBSロールアップ
  （[wbs.js](../src/lib/wbs.js)）、日付ユーティリティ（[date.js](../src/lib/date.js)）、`syncToDb` 差分ロジックは
  純粋関数中心でテスト適性が高いにもかかわらず未整備。回帰の検知手段が無い。

### 🟢 6.6 デッドコード・小規模な設計課題
- `Nav.jsx` の `DesktopNav` は未使用（PC版は独自ヘッダーを使用）。
- `syncToDb` は fire-and-forget（`.then()` 内で握りつぶし）。**書き込み失敗はコンソールログのみ**でユーザーに通知されず、
  UI（メモリ）と DB が静かに乖離し得る。
- 全 SELECT を毎回フルスキャン（`SELECT * FROM tasks`）。件数が小さい個人用途では問題ないが、
  インデックス/外部キー制約は未定義（`parent_id`/`project_id`/`category_id` に FK なし）。
- `index.css` に全スタイルが集中（保守時の見通し）。
- Excel出力・クリップボード等の失敗時ハンドリングは限定的。

---

## 7. 改善候補

優先度は「効果 × リスク低減」で概観。

### 優先度：高
1. **署名鍵の除去とローテーション**（6.1）。履歴から削除し `.gitignore` 追加、`pubkey` を更新。
2. **状態同期の再設計**（6.2）。ID/タイムスタンプを action 生成時に確定し reducer を純粋化。
   併せて `syncToDb` の失敗をトースト等でユーザーに通知。
3. **カテゴリ color のマイグレーション追加**（6.3）。

### 優先度：中
4. **ドキュメント整備**（6.4）。README を Tauri/SQLite 前提に更新、仕様書を一本化。
   本ドキュメントを最新の設計リファレンスとして活用。
5. **テスト基盤の導入**（6.5）。Vitest を入れ、まず純粋関数（date/holidays/wbs）と
   reducer/`syncToDb` の差分ロジックからカバー。ESLint 設定の追跡管理。
6. **DB 整合性の強化**。FK 制約 or アプリ側の整合チェック、削除時のカスケード方針を明文化。
   マイグレーションのロールバック（Down）方針の検討。

### 優先度：低〜中
7. **バックアップ/エクスポート機能の明示**。かつて README にあった JSON バックアップ相当を
   現行 SQLite ベースで再提供（DBファイルコピー導線 or JSONエクスポート）。
8. **繰り返しタスク（`recurrence`）の実装**。カラムは既にあるため設計の空白を埋める。
9. **アクセシビリティ/キーボード操作**の拡充（D&D の代替操作、フォーカス管理）。
10. **デッドコード削除**（`DesktopNav` 等）、`index.css` のモジュール分割。
11. **パフォーマンス**: 大量タスク時に備えた選択的クエリ/メモ化の見直し（現状は個人用途で十分）。

---

## 付録：アーキテクチャ要点

- **単一データモデル・多視点**という設計思想が全体を貫く（コンソール/WBS/Log は同じ `state.tasks` の派生）。
- **WBS層とコンソール層の日付分離**が本アプリ最大の設計特徴。ユーザーが「日程を更新」を押すまで
  ガント編集がカレンダーに波及しないことで、計画（WBS）と実行（コンソール）を分けている。
- **オフラインファースト**。すべてローカル SQLite で完結し、ネットワークは自動更新チェックのみ。
- **依存最小主義**。状態管理・D&D は標準機能のみ、重量級ライブラリは Excel 出力の ExcelJS のみ（遅延ロード）。
</content>
</invoke>
