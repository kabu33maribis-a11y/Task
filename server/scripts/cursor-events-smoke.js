/**
 * POST a sample cursor hook event to the events API.
 * Usage: npm run cursor-events:smoke
 */
import 'dotenv/config'

const baseUrl =
  process.env.CURSOR_EVENTS_API_URL ?? 'http://127.0.0.1:8788/api/events'

const payload = {
  recorded_at: new Date().toISOString(),
  project: process.env.CURSOR_EVENTS_PROJECT ?? 'task-manager',
  summary: {
    event_type: 'subagentStart',
    session_id: `smoke-${Date.now()}`,
    subagent_type: 'explore',
    model_id: 'default',
    composer_mode: 'agent',
    is_background_agent: false,
  },
  event: {
    hook_event_name: 'subagentStart',
    subagent_type: 'explore',
    model_id: 'default',
    composer_mode: 'agent',
    is_background_agent: false,
    parse_mode: 'smoke',
  },
}

const res = await fetch(baseUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})

const body = await res.json().catch(() => ({}))
if (!res.ok) {
  console.error('Smoke test failed:', body.error ?? res.statusText)
  process.exit(1)
}

console.log('Event stored:', body)
