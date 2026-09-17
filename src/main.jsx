import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { applyTheme, getSavedTheme } from './lib/theme.js'
import { applyGanttBarColor, getSavedGanttBarColor } from './lib/ganttBarColor.js'

applyTheme(getSavedTheme())
applyGanttBarColor(getSavedGanttBarColor())

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
