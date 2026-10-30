import { useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Header } from './components/Header'
import { ConfigMissingNotice, RpcProblemBanner, WrongNetworkBanner } from './components/Banners'
import { SettingsModal } from './components/SettingsModal'
import { Home } from './features/home/Home'
import { CreateSafe } from './features/create-safe/CreateSafe'
import { SafePage } from './pages/SafePage'

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Header onOpenSettings={() => setSettingsOpen(true)} />
      <ConfigMissingNotice />
      <WrongNetworkBanner />
      <RpcProblemBanner onOpenSettings={() => setSettingsOpen(true)} />
      <main className="mx-auto max-w-5xl p-4">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/create" element={<CreateSafe />} />
          <Route path="/safe/:address" element={<SafePage />} />
          <Route path="*" element={<p className="text-sm">Page not found.</p>} />
        </Routes>
      </main>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
