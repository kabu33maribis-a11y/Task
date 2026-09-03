/** Whether the page runs inside a Tauri webview (not a normal browser tab). */
export function isTauri() {
  return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ != null
}

/**
 * Wait until Tauri injects its IPC bridge.
 * Resolves immediately when already available; rejects with a helpful message in browsers.
 */
export function waitForTauri(timeoutMs = 10000) {
  if (isTauri()) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const timer = setInterval(() => {
      if (isTauri()) {
        clearInterval(timer)
        resolve()
      } else if (Date.now() - start >= timeoutMs) {
        clearInterval(timer)
        reject(
          new Error(
            'Tauri が利用できません。ブラウザ（http://localhost:5173）ではなく、npm run tauri dev で起動したデスクトップアプリのウィンドウをお使いください。初回は Rust のビルド完了まで数分かかることがあります。',
          ),
        )
      }
    }, 50)
  })
}
