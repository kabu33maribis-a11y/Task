import { todayStr } from '../date.js'

const DEFAULT_BASE = '/api/ai'

function getBaseUrl() {
  return import.meta.env.VITE_AI_SERVER_URL ?? DEFAULT_BASE
}

/**
 * Parse natural language into structured task fields via the AI server.
 * @param {string} text
 * @returns {Promise<{ title: string, scheduled_date: string|null, console_end_date: string|null, priority: string|null, subtasks: string[] }>}
 */
export async function parseNaturalLanguageTask(text) {
  const res = await fetch(`${getBaseUrl()}/parse-task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      today: todayStr(),
    }),
  })

  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(body.error ?? `AI request failed (${res.status})`)
  }
  return body
}

export async function checkAiServerHealth() {
  const base = getBaseUrl().replace(/\/api\/ai\/?$/, '')
  const res = await fetch(`${base}/health`)
  if (!res.ok) return { ok: false }
  return res.json()
}
