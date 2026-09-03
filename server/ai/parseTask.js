import OpenAI from 'openai'

const MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'

const SYSTEM_PROMPT = `You parse natural-language task descriptions into structured task fields for a Japanese personal task manager.

Return JSON only with this shape:
{
  "title": string,
  "scheduled_date": "YYYY-MM-DD" | null,
  "console_end_date": "YYYY-MM-DD" | null,
  "priority": "high" | "medium" | "low" | null,
  "subtasks": string[]
}

Rules:
- "title" is a concise task title in the same language as the input.
- Use the provided "today" date for relative expressions (明日, 来週月曜, etc.).
- scheduled_date is the start date; console_end_date is optional end date for multi-day tasks.
- subtasks holds child task titles when the input implies a breakdown; otherwise [].
- Do not invent categories or projects.`

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured')
  }
  return new OpenAI({ apiKey })
}

/**
 * Parse natural language into structured task fields.
 */
export async function parseNaturalLanguageTask({ text, today }) {
  const trimmed = text?.trim()
  if (!trimmed) {
    throw new Error('text is required')
  }

  const openai = getOpenAIClient()
  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({ text: trimmed, today }),
      },
    ],
  })

  const raw = completion.choices[0]?.message?.content
  if (!raw) {
    throw new Error('Empty model response')
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Model returned invalid JSON')
  }

  return {
    title: String(parsed.title ?? trimmed).trim(),
    scheduled_date: parsed.scheduled_date ?? null,
    console_end_date: parsed.console_end_date ?? null,
    priority: parsed.priority ?? null,
    subtasks: Array.isArray(parsed.subtasks)
      ? parsed.subtasks.map((s) => String(s).trim()).filter(Boolean)
      : [],
  }
}
