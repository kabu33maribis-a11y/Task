import 'dotenv/config'

import express from 'express'
import { parseNaturalLanguageTask } from './ai/parseTask.js'

const PORT = Number(process.env.AI_SERVER_PORT ?? 8787)
const app = express()

app.use(express.json({ limit: '32kb' }))

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
  })
})

app.post('/api/ai/parse-task', async (req, res) => {
  try {
    const { text, today } = req.body ?? {}
    if (!today || typeof today !== 'string') {
      return res.status(400).json({ error: 'today (YYYY-MM-DD) is required' })
    }

    const result = await parseNaturalLanguageTask({ text, today })
    res.json(result)
  } catch (err) {
    console.error('[ai/parse-task]', err)
    const message = err instanceof Error ? err.message : 'Parse failed'
    const status = message.includes('not configured') ? 503 : 400
    res.status(status).json({ error: message })
  }
})

app.listen(PORT, () => {
  console.log(`[ai-server] listening on http://127.0.0.1:${PORT}`)
})
