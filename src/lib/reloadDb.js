import { discardPendingDbSync } from '../store/StoreContext.jsx'
import { reopenDb } from './db.js'

/** 共有ファイルの内容を取り込む。このPC側の未保存の書き込みは破棄する。 */
export async function reloadSharedDb(reloadFromDb) {
  discardPendingDbSync()
  await reopenDb()
  await reloadFromDb()
}
