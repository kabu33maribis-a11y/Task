import { invoke } from '@tauri-apps/api/core'
import { getDbPath, setDbPath } from './appConfig.js'
import { isTauri, waitForTauri } from './tauri.js'

let _db = null

function createDbInterface() {
  return {
    select(query, values = []) {
      return invoke('app_db_select', { query, values })
    },
    execute(query, values = []) {
      return invoke('app_db_execute', { query, values })
    },
    async close() {
      _db = null
      return invoke('app_db_close')
    },
  }
}

async function connectDb(customPath) {
  await waitForTauri()
  const path = customPath !== undefined ? customPath : await getDbPath()
  await invoke('app_db_close').catch(() => {})
  await invoke('app_db_connect', { customPath: path })
}

export async function getDb() {
  if (!_db) {
    await connectDb()
    _db = createDbInterface()
  }
  return _db
}

/** First launch has no saved path and the default tasks.db does not exist yet. */
export async function needsDbSetup() {
  if (!isTauri()) return { needed: false, defaultPath: '' }
  await waitForTauri()
  const status = await invoke('app_db_setup_status')
  return {
    needed: !!status?.needed,
    defaultPath: status?.defaultPath || status?.default_path || '',
  }
}

/** Create and open the default tasks.db without writing a custom path. */
export async function prepareDefaultDb() {
  if (_db) {
    await _db.close().catch(() => {})
    _db = null
  }
  await connectDb(null)
  _db = createDbInterface()
  return _db
}

export async function reconnectDb(newFilePath) {
  if (_db) {
    await _db.close().catch(() => {})
    _db = null
  }
  await connectDb(newFilePath)
  await setDbPath(newFilePath)
  _db = createDbInterface()
  return _db
}

export async function resetDbConnection() {
  if (_db) {
    await _db.close().catch(() => {})
    _db = null
  }
  await connectDb(null)
  _db = createDbInterface()
  return _db
}

/** Close and reopen the current DB path so cloud-synced file changes are visible. */
export async function reopenDb() {
  if (_db) {
    await _db.close().catch(() => {})
    _db = null
  }
  await connectDb()
  _db = createDbInterface()
  return _db
}
