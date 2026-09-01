import { invoke } from '@tauri-apps/api/core'
import { getDbPath, setDbPath } from './appConfig.js'

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

async function connectDb(customDir) {
  const dir = customDir !== undefined ? customDir : await getDbPath()
  await invoke('app_db_close').catch(() => {})
  await invoke('app_db_connect', { customDir: dir })
}

export async function getDb() {
  if (!_db) {
    await connectDb()
    _db = createDbInterface()
  }
  return _db
}

export async function reconnectDb(newDirPath) {
  if (_db) {
    await _db.close().catch(() => {})
    _db = null
  }
  await setDbPath(newDirPath)
  await connectDb(newDirPath)
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
