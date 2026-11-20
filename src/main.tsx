import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { migrateOnce } from './lib/migrate'

// Antes de pintar: trae los datos de la base anterior, si los hay, para que Train no empiece un ciclo nuevo
const render = (startupError?: string) => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App startupError={startupError} />
  </StrictMode>,
)
migrateOnce().then(() => render(), (e: Error) => {
  console.error('Migration failed', e)
  render(`Couldn't bring over your previous progress (${e.message}). Don't start a new cycle: reload the page, or import your backup from the Sync tab.`)
})
