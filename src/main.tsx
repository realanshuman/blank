import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { stampShell } from './shell/platform'
import './styles/app.css'

// Before the first render: the canvas reads this to decide whether to reserve
// a band for floating window buttons, and reserving it a tick late would move
// the writing down the page after the reader has seen it.
stampShell()

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
