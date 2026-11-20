import { useEffect, useState } from 'react'
import { Home, type Target } from './screens/Home'
import { Train } from './screens/Train'
import { Openings, type OpeningsView } from './screens/Openings'
import { Stats } from './screens/Stats'
import { Review } from './screens/Review'
import { Settings } from './screens/Settings'
import { Data } from './screens/Data'
import { handleOAuthCallback } from './lib/lichess'

const TABS = [
  { id: 'home', label: 'Home', icon: 'M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-5h4v5' },
  { id: 'train', label: 'Puzzles', icon: 'M8 21h8M7 17h10l-1-4 2-3-4-6-6 2v3l3 1-4 3z' },
  { id: 'openings', label: 'Openings', icon: 'M6 20h12M8 16h8l-1-9h-6zM9 7l-1-3h8l-1 3M12 4V2' },
  { id: 'stats', label: 'Stats', icon: 'M4 20h16M7 16v-5M12 16V6M17 16v-8' },
  { id: 'review', label: 'Review', icon: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4' },
  { id: 'data', label: 'Sync', icon: 'M12 3v12M7 10l5 5 5-5M5 21h14' },
  { id: 'settings', label: 'Settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1' },
] as const
type Tab = (typeof TABS)[number]['id']

const returningFromLichess = new URLSearchParams(location.search).has('state')

function App({ startupError }: { startupError?: string }) {
  const [tab, setTab] = useState<Tab>(returningFromLichess ? 'settings' : 'home')
  // Abrir Aperturas directamente en una vista (p. ej. entrenar desde Inicio); el contador fuerza a montarla de nuevo
  const [openingsView, setOpeningsView] = useState<{ view?: OpeningsView; n: number }>({ n: 0 })
  const go = (t: Target) => {
    if (typeof t === 'object') { setOpeningsView((o) => ({ view: { kind: 'train', repId: t.train }, n: o.n + 1 })); setTab('openings') }
    else setTab(t)
  }
  const select = (t: Tab) => {
    if (t === 'openings') setOpeningsView((o) => ({ n: o.n + 1 }))
    setTab(t)
  }
  const [error, setError] = useState<string | undefined>(startupError)

  useEffect(() => {
    handleOAuthCallback().catch((e: Error) => setError(e.message))
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => select('home')}>Woodpecker</button>
        <span className="muted small">{TABS.find((t) => t.id === tab)?.label}</span>
      </header>
      {error && <p className="callout warn" onClick={() => setError(undefined)}>{error}</p>}
      <main>
        {tab === 'home' && <Home go={go} />}
        {tab === 'train' && <Train />}
        {tab === 'openings' && <Openings key={openingsView.n} initial={openingsView.view} />}
        {tab === 'stats' && <Stats />}
        {tab === 'review' && <Review />}
        {tab === 'data' && <Data />}
        {tab === 'settings' && <Settings />}
      </main>
      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => select(t.id)} aria-current={tab === t.id}>
            <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden><path d={t.icon} /></svg>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

export default App
