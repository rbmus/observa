import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import type { Page } from '../App'
import type { AnalyticsFocus, Store } from '../types'
import { formatPercent } from '../utils/format'
import { imageFileToDataUrl } from '../utils/favicon'
import StoreIcon from './StoreIcon'
import { Icon } from './icons'
import Logo from './Logo'

interface Props { page: Page; onNavigate: (p: Page, focus?: AnalyticsFocus | null) => void; onOpenStore: (id: string) => void }

const fillIcon = (children: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">{children}</svg>
)

const GROUPS: { label: string; items: { id: Page; label: string; icon: ReactNode }[] }[] = [
  { label: 'АНАЛИЗ', items: [
    { id: 'dashboard', label: 'Обзор', icon: fillIcon(<path d="M2 11h11a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H2a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2m0-9h11v7H2zm20-2h-3a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2m0 9h-3V2h3zM5 13H2a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2m0 9H2v-7h3zm17-9H11a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2m0 9H11v-7h11z" />) },
    { id: 'analytics', label: 'Сравнения цен', icon: fillIcon(<><path d="M23 22H3a1 1 0 0 1-1-1V1a1 1 0 0 0-2 0v20a3 3 0 0 0 3 3h20a1 1 0 0 0 0-2" /><path d="M15 20a1 1 0 0 0 1-1v-7a1 1 0 0 0-2 0v7a1 1 0 0 0 1 1m-8 0a1 1 0 0 0 1-1v-7a1 1 0 1 0-2 0v7a1 1 0 0 0 1 1m12 0a1 1 0 0 0 1-1V7a1 1 0 1 0-2 0v12a1 1 0 0 0 1 1m-8 0a1 1 0 0 0 1-1V7a1 1 0 0 0-2 0v12a1 1 0 0 0 1 1" /></>) }
  ] },
  { label: 'УПРАВЛЕНИЕ', items: [
    { id: 'monitoring', label: 'Мониторинг', icon: fillIcon(<path d="M19 1H5a5.006 5.006 0 0 0-5 5v8a5.006 5.006 0 0 0 5 5h6v2H7a1 1 0 1 0 0 2h10a1 1 0 0 0 0-2h-4v-2h6a5.006 5.006 0 0 0 5-5V6a5.006 5.006 0 0 0-5-5m3 13a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3zm-2-4a1 1 0 0 1-1 1h-2.965l-1.7 2.554A1 1 0 0 1 13.5 14h-.062a1 1 0 0 1-.833-.55l-2.229-4.462-1.044 1.567A1 1 0 0 1 8.5 11H5a1 1 0 0 1 0-2h2.965l1.7-2.555A.99.99 0 0 1 10.562 6a1 1 0 0 1 .833.551l2.229 4.46 1.044-1.568A1 1 0 0 1 15.5 9H19a1 1 0 0 1 1 1" />) },
    { id: 'stores', label: 'Источники', icon: fillIcon(<><path d="M9 14h6a1 1 0 1 0 0-2H9a1 1 0 0 0 0 2" /><path d="M19 0H5a5.006 5.006 0 0 0-5 5v1a3 3 0 0 0 1 2.234V19a5.006 5.006 0 0 0 5 5h12a5.006 5.006 0 0 0 5-5V8.234A3 3 0 0 0 24 6V5a5.006 5.006 0 0 0-5-5M2 5a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1zm19 14a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V9h18z" /></>) }
  ] }
]

export default function Sidebar({ page, onNavigate, onOpenStore }: Props) {
  const [ownStore, setOwnStore] = useState<Store | null>(null)
  const [marketDiff, setMarketDiff] = useState<number | null>(null)
  const [customFavicon, setCustomFavicon] = useState<string | null>(null)
  const faviconInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let timer: number | undefined
    const refresh = () => {
      Promise.all([window.observa.storesList(), window.observa.analyticsSummary(), window.observa.settingsGet()]).then(([stores, summary, settings]) => {
        setOwnStore(stores.find(store => store.role === 'own') || null)
        setCustomFavicon(settings.ownStoreFavicon || null)
        const rows = (summary?.priceMatrix || []).filter(row => row.ownOffers.length > 0 && row.differencePercent != null)
        setMarketDiff(rows.length ? rows.reduce((sum, row) => sum + (row.differencePercent || 0), 0) / rows.length : null)
      }).catch(() => {})
    }
    const scheduleRefresh = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(refresh, 250)
    }
    refresh()
    const unsubscribeData = window.observa.onDataChanged(scheduleRefresh)
    const unsubscribeMonitor = window.observa.onMonitorEvent(scheduleRefresh)
    return () => {
      window.clearTimeout(timer)
      unsubscribeData()
      unsubscribeMonitor()
    }
  }, [])

  const pickFavicon = () => faviconInputRef.current?.click()

  const onFaviconFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    imageFileToDataUrl(file)
      .then(dataUrl => window.observa.settingsUpdate({ ownStoreFavicon: dataUrl }))
      .then(settings => setCustomFavicon(settings.ownStoreFavicon))
      .catch(() => {})
  }

  const clearFavicon = () => {
    window.observa.settingsUpdate({ ownStoreFavicon: null }).then(settings => setCustomFavicon(settings.ownStoreFavicon))
  }

  const isMac = window.observa?.platform === 'darwin'
  const diffClass = marketDiff == null ? '' : marketDiff > 0.05 ? 'price-up' : marketDiff < -0.05 ? 'price-down' : ''
  const hasOwnPrices = Boolean(ownStore?.products?.some(p => p.price != null))
  const diffText = !ownStore
    ? 'Не добавлен'
    : marketDiff == null
      ? hasOwnPrices ? 'Нет совпадений с конкурентами' : 'Нет цен у товаров'
      : Math.abs(marketDiff) <= 0.05
        ? 'На уровне рынка'
        : `${formatPercent(marketDiff)} vs рынок`

  return (
    <aside className="sidebar">
      {isMac && (
        <div className="sidebar-brand">
          <Logo size={22} />
          <span>OBSERVA</span>
        </div>
      )}
      <nav className="nav">
        {GROUPS.map(group => <div className="nav-section" key={group.label}>
          <div className="nav-group-label">{group.label}</div>
          {group.items.map(item => {
            const active = page === item.id || (item.id === 'stores' && page === 'store-detail')
            return <button key={item.id} className={`nav-item ${active ? 'active' : ''}`} onClick={() => onNavigate(item.id)} aria-current={active ? 'page' : undefined} data-tooltip={item.label}>
              <span className="nav-icon">{item.icon}</span>{item.label}
            </button>
          })}
        </div>)}
      </nav>

      <button className={`nav-item sidebar-settings-button ${page === 'settings' ? 'active' : ''}`} onClick={() => onNavigate('settings')} aria-current={page === 'settings' ? 'page' : undefined} data-tooltip="Настройки">
        <span className="nav-icon"><Icon name="settings" size={18} /></span><span>Настройки</span>
      </button>

      <button
        className="sidebar-own-store"
        onClick={() => ownStore ? onOpenStore(ownStore.id) : onNavigate('stores')}
        data-tooltip={ownStore ? 'Открыть мой магазин' : 'Открыть источники'}
      >
        <span className="sidebar-own-favicon-wrap">
          <StoreFavicon store={ownStore} custom={customFavicon} />
          <span className="favicon-action" onClick={event => { event.stopPropagation(); pickFavicon() }} data-tooltip={customFavicon ? 'Заменить значок' : 'Загрузить свой значок'}>
            <Icon name="pencil" size={9} />
          </span>
          {customFavicon && (
            <span className="favicon-action reset" onClick={event => { event.stopPropagation(); clearFavicon() }} data-tooltip="Убрать свой значок">
              <Icon name="close" size={9} />
            </span>
          )}
        </span>
        <span className="sidebar-own-copy">
          <b>{ownStore?.name || 'Мой магазин'}</b>
          <small className={diffClass}>{diffText}</small>
        </span>
        <input ref={faviconInputRef} type="file" accept="image/*" hidden onChange={onFaviconFile} />
      </button>
    </aside>
  )
}

function StoreFavicon({ store, custom }: { store: Store | null; custom: string | null }) {
  return <StoreIcon url={store?.url} name={store?.name || 'М'} customIcon={store?.customIcon || custom} className="sidebar-own-favicon" />
}
