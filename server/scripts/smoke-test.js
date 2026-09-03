/**
 * Send one parse-task request. Requires .env with OPENAI_API_KEY.
 * Usage: node server/scripts/smoke-test.js "明日までにレポート提出"
 */
import 'dotenv/config'
import { parseNaturalLanguageTask } from '../ai/parseTask.js'

const text = process.argv[2] ?? '明日までにレポート提出、優先度高'
const today = new Date().toISOString().slice(0, 10)

const result = await parseNaturalLanguageTask({ text, today })
console.log(JSON.stringify(result, null, 2))
