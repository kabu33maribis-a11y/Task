# Claude Code リリース手順

「バンプ」「リリース」などの一言でリリース指示が来たら、以下の手順を**確認なし**に実行してください。

## 完全な手順

1. **patch バージョンを 1 上げる**（例: `0.1.18` → `0.1.19`）

2. **バージョン同期ファイル（必ず Node.js で編集）:**
   - `package.json` — ルートの `version` フィールドのみ
   - `package-lock.json` — 自動更新（手動編集不要、通常は`npm ci`後）
   - `src-tauri/Cargo.toml` — `name = "app"` の version セクション
   - `src-tauri/Cargo.lock` — 同上
   - `src-tauri/tauri.conf.json` — `version` フィールド

3. **未コミットの機能変更を同じコミットに含める**
   - `logs/` ディレクトリは含めない
   - 完成した機能のみ

4. **コミットメッセージは既存スタイルで:**
   ```
   feat|fix|chore: …し vX.Y.Z にバンプ
   ```
   例: `feat: WBS検索機能とカレンダー改善をし v0.1.19 にバンプ`

5. **コマンド実行:**
   ```bash
   git push origin HEAD
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
   タグ push でデプロイが開始されます（`.github/workflows/release.yml` が Windows バイナリビルド・GitHub Release・updater 用 `latest.json` を自動生成）

6. **ワークフロー確認（オプション）:**
   ```bash
   gh run watch  # リリースワークフロー完了を監視（待つ必要はない）
   ```

---

## ⚠️ 文字化け防止（必須）

### 問題の背景
Windows PowerShell の `Get-Content` / `Set-Content` で `tauri.conf.json` や `Cargo.toml` を書き換えると、UTF-8 エンコーディングが破損し、日本語が文字化けします。

**過去の事例:**
- `src-tauri/tauri.conf.json` の `"title": "タスク管理"` が文字化け
- ビルド時に `Couldn't locate or parse tauri config.` エラー

### ✅ 必須手順

**禁止:** PowerShell で JSON・TOML を丸ごと読み書きして version のみ差し替える。

**必須:**
1. **版更新は Node.js か Edit/Write ツール で実行**
   - Node.js: `fs.readFileSync`/`writeFileSync` で `encoding: 'utf8'` 指定
   - Claude Code: 専用の Edit/Write ツール を使用（これらはUTF-8 を自動処理）

2. **`tauri.conf.json` の検証（必ず実行）**
   ```bash
   node -e "const j=require('./src-tauri/tauri.conf.json'); if(!j.version||!j.app?.windows?.[0]?.title) throw new Error('parse failed'); console.log('✓ ok', j.version, j.app.windows[0].title)"
   ```
   - 成功例: `✓ ok 0.1.19 タスク管理`
   - 失敗したら commit / tag **しない** — ファイルを修正してやり直し

3. **日本語フィールドが残っていることを確認**
   - `"title": "タスク管理"` が正しく保存されているか
   - `"label": "タスク管理"` など他の日本語フィールドも確認

4. **その後、安全に commit/tag を実行**

---

## 関連ファイル

- `CLAUDE.md` — リリース手順の詳細（このガイドより詳しい）
- `.cursor/rules/release-bump.mdc` — Cursor IDE 用ルール（同じ手順）
- `.github/workflows/release.yml` — タグ push 時のGitHub Actions ワークフロー

---

## チェックリスト（コピペ用）

```
□ patch バージョン → X.Y.(Z+1) に上げる
□ package.json の version 更新（Node.js/Write ツール）
□ src-tauri/Cargo.toml の version 更新（同上）
□ src-tauri/Cargo.lock は自動更新（再生成不要）
□ src-tauri/tauri.conf.json の version 更新（同上）
□ 検証: node -e "const j=require(...)" でパース確認 → "タスク管理" が残っているか
□ git add（ステージング）
□ git commit -m "feat: ... し vX.Y.Z にバンプ"
□ git push origin HEAD
□ git tag vX.Y.Z
□ git push origin vX.Y.Z  ← デプロイ完了
```
