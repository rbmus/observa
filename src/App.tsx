import { useCallback, useEffect, useRef, useState } from 'react'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import Stores from './pages/Stores'
import StoreDetail from './pages/StoreDetail'
import Analytics from './pages/Analytics'
import Monitoring from './pages/Monitoring'
import Settings from './pages/Settings'
import Toasts, { type Toast } from './components/Toasts'
import { formatPrice } from './utils/format'
import type { AnalyticsFocus, MonitorEvent } from './types'

export type Page = 'dashboard' | 'analytics' | 'monitoring' | 'stores' | 'store-detail' | 'settings'

export default function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null)
  const [analyticsFocus, setAnalyticsFocus] = useState<AnalyticsFocus | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)

  const pushToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = ++toastId.current
    setToasts(current => [...current.slice(-3), { ...toast, id }])
  }, [])
  const dismissToast = useCallback((id: number) => {
    setToasts(current => current.filter(toast => toast.id !== id))
  }, [])

  useEffect(() => window.observa.onUpdateEvent(state => {
    if (state.status === 'downloaded' && state.version) {
      pushToast({
        kind: 'success',
        title: `Обновление ${state.version} готово`,
        body: 'Нажмите, чтобы перезапустить и установить',
        onClick: () => window.observa.updateInstall()
      })
    } else if (state.status === 'error' && state.error) {
      pushToast({ kind: 'error', title: 'Не удалось проверить обновления', body: state.error })
    }
  }), [pushToast])

  useEffect(() => window.observa.onAppNavigate(target => {
    if (target === 'dashboard' || target === 'analytics' || target === 'monitoring' || target === 'stores' || target === 'settings') {
      setPage(target)
      setSelectedStoreId(null)
      setAnalyticsFocus(null)
    }
  }), [])

  useEffect(() => window.observa.onMonitorEvent((event: MonitorEvent) => {
    if (event.event === 'price:changed' && event.productName) {
      const oldPrice = event.oldPrice ?? null
      const newPrice = event.newPrice ?? null
      pushToast({
        kind: 'info',
        title: 'Изменение цены',
        body: `${event.productName}${oldPrice != null && newPrice != null ? `: ${formatPrice(oldPrice, event.currency)} → ${formatPrice(newPrice, event.currency)}` : ''}`,
        onClick: () => { setAnalyticsFocus(null); setPage('analytics') }
      })
    } else if (event.event === 'store:error' && event.storeId) {
      const storeId = event.storeId
      pushToast({
        kind: 'error',
        title: 'Ошибка проверки источника',
        body: event.error || undefined,
        onClick: () => { setSelectedStoreId(storeId); setPage('store-detail') }
      })
    }
  }), [pushToast])

  const openStore = (id: string) => {
    setSelectedStoreId(id)
    setPage('store-detail')
  }

  const navigate = (p: Page, focus?: AnalyticsFocus | null) => {
    if (p === 'store-detail') return
    setPage(p)
    setSelectedStoreId(null)
    if (p === 'analytics') setAnalyticsFocus(focus ?? null)
    else setAnalyticsFocus(null)
  }

  return (
    <div className="app">
      <TitleBar />
      <div className="app-body">
        <Sidebar page={page} onNavigate={navigate} />
        <main className="main">
          {page === 'dashboard' && <Dashboard onOpenStore={openStore} onNavigate={navigate} />}
          {page === 'stores' && <Stores onOpenStore={openStore} />}
          {page === 'store-detail' && selectedStoreId && (
            <StoreDetail storeId={selectedStoreId} onBack={() => setPage('stores')} />
          )}
          {page === 'analytics' && <Analytics onOpenCompetitors={() => navigate('stores')} focus={analyticsFocus} />}
          {page === 'monitoring' && <Monitoring />}
          {page === 'settings' && <Settings />}
        </main>
      </div>
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
