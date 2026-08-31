import { load } from '@tauri-apps/plugin-store'
import { open } from '@tauri-apps/plugin-dialog'

const STORE_FILE = 'config.json'
const DB_PATH_KEY = 'dbPath'

let _store = null
async function getStore() {
  if (!_store) _store = await load(STORE_FILE, { autoSave: true })
  return _store
}

export async function getDbPath() {
  const store = await getStore()
  return (await store.get(DB_PATH_KEY)) ?? null
}

export async function setDbPath(path) {
  const store = await getStore()
  if (path === null) {
    await store.delete(DB_PATH_KEY)
  } else {
    await store.set(DB_PATH_KEY, path)
  }
  await store.save()
}

export async function pickDbFolder() {
  const selected = await open({ directory: true, multiple: false, title: 'データファイルの保存先フォルダを選択' })
  return selected ?? null
}

// "sqlite:/absolute/path/tasks.db" 形式に変換
export function toSqliteUri(dirPath) {
  // Windows パスはスラッシュに統一
  const normalized = dirPath.replace(/\\/g, '/')
  return `sqlite://${normalized}/tasks.db`
}

export const DEFAULT_DB_URI = 'sqlite:tasks.db'
