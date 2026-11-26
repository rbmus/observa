import { useEffect, useState } from 'react'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import Stores from './pages/Stores'
import StoreDetail from './pages/StoreDetail'
import Analytics from './pages/Analytics'
import Monitoring from './pages/Monitoring'

export type Page = 'dashboard' | 'analytics' | 'monitoring' | 'stores' | 'store-detail'

export default function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null)

  useEffect(() => window.observa.onAppNavigate(target => {
    if (target === 'dashboard' || target === 'analytics' || target === 'monitoring' || target === 'stores') {
      setPage(target)
      setSelectedStoreId(null)
    }
  }), [])

  const openStore = (id: string) => {
    setSelectedStoreId(id)
    setPage('store-detail')
  }

  return (
    <div className="app">
      <TitleBar />
      <div className="app-body">
        <Sidebar
          page={page}
          onNavigate={(p) => {
            if (p !== 'store-detail') setPage(p)
          }}
        />
        <main className="main">
          {page === 'dashboard' && <Dashboard onOpenStore={openStore} onNavigate={setPage} />}
          {page === 'stores' && <Stores onOpenStore={openStore} />}
          {page === 'store-detail' && selectedStoreId && (
            <StoreDetail storeId={selectedStoreId} onBack={() => setPage('stores')} />
          )}
          {page === 'analytics' && <Analytics onOpenCompetitors={() => setPage('stores')} />}
          {page === 'monitoring' && <Monitoring />}
        </main>
      </div>
    </div>
  )
}
