import 'dotenv/config'

import express from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Pool } = pg
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.CURSOR_EVENTS_API_PORT ?? 8788)

function getPool() {
  if (process.env.DATABASE_URL) {
    return new Pool({ connectionString: process.env.DATABASE_URL })
  }

  return new Pool({
    host: process.env.POSTGRES_HOST ?? '172.16.57.201',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? 'cursor_audit',
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
  })
}

const pool = getPool()
const app = express()

app.use(express.json({ limit: '256kb' }))

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ ok: true, postgres: true })
  } catch (err) {
    res.status(503).json({
      ok: false,
      postgres: false,
      error: err instanceof Error ? err.message : 'Database unavailable',
    })
  }
})

app.post('/api/events', async (req, res) => {
  const body = req.body ?? {}
  const summary = body.summary ?? null
  const event = body.event ?? null
  const recordedAt = body.recorded_at ?? new Date().toISOString()

  if (!summary && !event) {
    return res.status(400).json({ error: 'summary or event is required' })
  }

  try {
    const result = await pool.query(
      `INSERT INTO cursor_events (
        recorded_at, event_type, session_id, tool_name, model,
        duration_ms, input_tokens, output_tokens, file_path, command,
        composer_mode, model_id, subagent_type, is_background_agent,
        project, summary, event
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16::jsonb, $17::jsonb
      )
      RETURNING id`,
      [
        recordedAt,
        summary?.event_type ?? event?.hook_event_name ?? null,
        summary?.session_id ?? event?.session_id ?? null,
        summary?.tool ?? event?.tool_name ?? null,
        summary?.model ?? event?.model ?? null,
        summary?.duration_ms ?? event?.duration ?? null,
        summary?.input_tokens ?? event?.input_tokens ?? null,
        summary?.output_tokens ?? event?.output_tokens ?? null,
        summary?.file_path ?? event?.file_path ?? null,
        summary?.command ?? event?.command ?? null,
        summary?.composer_mode ?? event?.composer_mode ?? null,
        summary?.model_id ?? event?.model_id ?? null,
        summary?.subagent_type ?? event?.subagent_type ?? null,
        summary?.is_background_agent ?? event?.is_background_agent ?? null,
        body.project ?? process.env.CURSOR_EVENTS_PROJECT ?? null,
        summary ? JSON.stringify(summary) : null,
        event ? JSON.stringify(event) : null,
      ],
    )

    res.status(201).json({ ok: true, id: result.rows[0].id })
  } catch (err) {
    console.error('[cursor-events-api]', err)
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to store event',
    })
  }
})

async function ensureSchema() {
  const dbDir = path.join(__dirname, '..', 'db')
  for (const file of ['cursor_events.sql', 'cursor_events_migrate.sql']) {
    const sql = await fs.readFile(path.join(dbDir, file), 'utf8')
    await pool.query(sql)
  }
}

async function start() {
  await ensureSchema()
  app.listen(PORT, () => {
    console.log(`[cursor-events-api] listening on http://0.0.0.0:${PORT}`)
  })
}

start().catch((err) => {
  console.error('[cursor-events-api] failed to start', err)
  process.exit(1)
})
