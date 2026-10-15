import { isoToDatetimeLocal, datetimeLocalToIso } from '../lib/date.js'
import {
  coerceLeadMinutes,
  ensureNotificationPermission,
  getDefaultReminderLeadMinutes,
  NOTIFICATION_LEAD_OPTIONS,
  useDefaultReminderLeadMinutes,
} from '../lib/notifications.js'
import DueDateTimePicker from './DueDateTimePicker.jsx'

export const REMINDER_LEAD_OPTIONS = NOTIFICATION_LEAD_OPTIONS

export default function ReminderFields({ task, onChange, compact = false }) {
  const dueLocal = isoToDatetimeLocal(task.due_at)
  const hasDue = !!task.due_at
  const enabled = !!task.reminder_enabled && hasDue
  const defaultLead = useDefaultReminderLeadMinutes()
  const storedLead = coerceLeadMinutes(task.reminder_lead_minutes, defaultLead)
  const lead = enabled ? storedLead : defaultLead

  function setDue(localValue) {
    const iso = datetimeLocalToIso(localValue)
    onChange({ due_at: iso, ...(iso ? {} : { reminder_enabled: false }) })
  }

  async function setEnabled(next) {
    if (next && !hasDue) return
    if (next) await ensureNotificationPermission()
    onChange({
      reminder_enabled: next,
      reminder_lead_minutes: next ? getDefaultReminderLeadMinutes() : storedLead,
    })
  }

  return (
    <div className={`reminder-fields${compact ? ' reminder-fields--compact' : ''}`}>
      <label>
        期限
        <DueDateTimePicker value={dueLocal} onChange={setDue} />
      </label>
      <label className="reminder-toggle" title={hasDue ? undefined : '先に期限を設定してください'}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={!hasDue}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        リマインダ
      </label>
      <label>
        通知
        <select
          value={lead}
          disabled={!enabled}
          onChange={(e) => onChange({ reminder_lead_minutes: Number(e.target.value) })}
        >
          {NOTIFICATION_LEAD_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
