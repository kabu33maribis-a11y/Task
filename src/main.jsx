import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { applyTheme, getSavedTheme } from './lib/theme.js'
import { applyGanttBarColor, getSavedGanttBarColor } from './lib/ganttBarColor.js'
import {
  bindNotificationActionsEarly,
  syncDesktopNotificationsPrefToBackend,
} from './lib/notifications.js'

applyTheme(getSavedTheme())
applyGanttBarColor(getSavedGanttBarColor())
bindNotificationActionsEarly()
syncDesktopNotificationsPrefToBackend()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
