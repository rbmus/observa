import { useEffect, useState, type ReactNode } from 'react'
import type { Page } from '../App'
import type { AnalyticsSummary, MarketOffer, PriceOffer } from '../types'
import { formatPrice, formatPercent, timeAgo } from '../utils/format'
import { Icon } from './icons'

interface Props { page: Page; onNavigate: (p: Page) => void }

const icon = (children: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
)

const GROUPS: { label: string; items: { id: Page; label: string; icon: ReactNode }[] }[] = [
  { label: 'АНАЛИЗ', items: [
    { id: 'dashboard', label: 'Обзор', icon: icon(<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>) },
    { id: 'analytics', label: 'Сравнения цен', icon: icon(<><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></>) }
  ] },
  { label: 'УПРАВЛЕНИЕ', items: [
    { id: 'monitoring', label: 'Мониторинг', icon: icon(<><path d="M3 12h4l3-8 4 16 3-8h4" /></>) },
    { id: 'stores', label: 'Источники', icon: icon(<><path d="M4 7l1.5-3h13L20 7" /><path d="M4 7h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7z" /><path d="M9 11h6" /></>) }
  ] }
]

export default function Sidebar({ page, onNavigate }: Props) {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)

  useEffect(() => {
    let timer: number | undefined
    const refresh = () => window.observa.analyticsSummary().then(setSummary).catch(() => {})
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

  const matrix = summary?.priceMatrix || []
  const matchedRows = matrix.filter(row => row.ownOffers.length > 0)
    .sort((left, right) => Math.abs(right.differencePercent || 0) - Math.abs(left.differencePercent || 0))
  const displayRows = matchedRows.length ? matchedRows : matrix
  const comparedOfferIds = new Set(matrix.flatMap(row => row.offers.map(offer => `${offer.storeId}|${offer.productId}`)))
  const watchedOffers = (summary?.allOffers || []).filter(offer => offer.price !== null && !comparedOfferIds.has(`${offer.storeId}|${offer.productId}`))
    .sort((left, right) => String(right.lastChecked || '').localeCompare(String(left.lastChecked || '')))
  const watchCount = displayRows.length + watchedOffers.length

  return (
    <aside className="sidebar">
      <nav className="nav">
        {GROUPS.map(group => <div className="nav-section" key={group.label}>
          <div className="nav-group-label">{group.label}</div>
          {group.items.map(item => {
            const active = page === item.id || (item.id === 'stores' && page === 'store-detail')
            return <button key={item.id} className={`nav-item ${active ? 'active' : ''}`} onClick={() => onNavigate(item.id)} aria-current={active ? 'page' : undefined}>
              <span className="nav-icon">{item.icon}</span>{item.label}
            </button>
          })}
        </div>)}
      </nav>

      <section className="sidebar-market-watch" aria-label="Мониторинг цен">
        <div className="sidebar-watch-heading"><span>МОНИТОРИНГ ЦЕН</span><small>{watchCount}</small></div>
        <div className="sidebar-watch-list">
          {displayRows.map(row => {
            const own = row.ownOffers[0]
            const best = row.bestCompetitor
            const prices = row.offers.map(offer => offer.price)
            const primaryOffer = own || row.offers.slice().sort((left, right) => left.price - right.price)[0]
            const ownItem = summary?.allOffers.find(offer => offer.storeId === primaryOffer.storeId && offer.productId === primaryOffer.productId)
            const thumbnail = ownItem || summary?.allOffers.find(offer => row.offers.some(item => item.storeId === offer.storeId && item.productId === offer.productId))
            const recentChange = summary?.recentPriceChanges.find(change => change.storeId === primaryOffer.storeId && change.productId === primaryOffer.productId)
            const deltaTone = recentChange ? (recentChange.changePercent > 0 ? 'up' : 'down') : (row.differencePercent || 0) > 0 ? 'up' : 'down'
            const stats = recentChange
              ? `${formatPercent(recentChange.changePercent)} · ${timeAgo(recentChange.lastChangedAt)}`
              : !own && prices.length > 1
                ? `Рынок ${formatPrice(Math.min(...prices), row.currency)}–${formatPrice(Math.max(...prices), row.currency)}`
                : own && row.differencePercent == null
                ? 'Нет динамики цены'
                : own
                  ? `${row.differencePercent! > 0 ? 'Дороже конкурента' : 'Дешевле конкурента'} на ${formatPercent(Math.abs(row.differencePercent!))}`
                  : 'Цена отслеживается'
            return <button className="sidebar-watch-row" key={`${row.productName}|${row.currency}`} onClick={() => onNavigate('analytics')} title="Открыть сравнение цен">
              <MarketThumb imageUrl={thumbnail?.imageUrl} url={primaryOffer.url} label={row.productName} />
              <span className="sidebar-watch-copy">
                <b>{row.productName}</b>
                <span>{own ? formatPrice(own.price, own.currency) : `от ${formatPrice(primaryOffer.price, primaryOffer.currency)}`}{best ? ` · конкурент ${formatPrice(best.price, best.currency)}` : own ? ' · ждёт цены конкурентов' : ` · ${row.offers.length} источника`}</span>
                <small className={recentChange || row.differencePercent != null ? `watch-change ${deltaTone}` : ''}>{stats}</small>
              </span>
            </button>
          })}
          {watchedOffers.map((offer: MarketOffer | PriceOffer) => {
            const imageUrl = 'imageUrl' in offer ? offer.imageUrl : null
            const change = summary?.recentPriceChanges.find(item => item.storeId === offer.storeId && item.productId === offer.productId)
            return <button className="sidebar-watch-row" key={`${offer.storeId}|${offer.productId}`} onClick={() => onNavigate('analytics')} title="Открыть все предложения">
              <MarketThumb imageUrl={imageUrl} url={offer.url} label={offer.productName} />
              <span className="sidebar-watch-copy">
                <b>{offer.productName}</b>
                <span>{formatPrice(offer.price, offer.currency)} · {offer.storeName}</span>
                <small className={change ? `watch-change ${change.changePercent > 0 ? 'up' : 'down'}` : ''}>{change ? `${formatPercent(change.changePercent)} · ${timeAgo(change.lastChangedAt)}` : offer.stale ? 'Данные могут устареть' : 'Цена отслеживается'}</small>
              </span>
            </button>
          })}
          {summary && !watchCount && <div className="sidebar-watch-empty">Добавьте источники и свой магазин, чтобы видеть здесь цены и динамику.</div>}
          {!summary && <div className="sidebar-watch-empty">Загружаю цены…</div>}
        </div>
        <button className="sidebar-watch-link" onClick={() => onNavigate('analytics')}>Открыть сравнения цен</button>
      </section>
      <button className={`nav-item sidebar-settings-button ${page === 'settings' ? 'active' : ''}`} onClick={() => onNavigate('settings')} aria-current={page === 'settings' ? 'page' : undefined}>
        <span className="nav-icon"><Icon name="settings" size={18} /></span><span>Настройки</span>
      </button>
    </aside>
  )
}

function MarketThumb({ imageUrl, url, label }: { imageUrl: string | null | undefined; url: string; label: string }) {
  const [stage, setStage] = useState(0)
  useEffect(() => setStage(0), [imageUrl, url])
  let favicon = ''
  try { favicon = `${new URL(url).origin}/favicon.ico` } catch { /* show initials */ }
  const src = stage === 0 && imageUrl ? imageUrl : stage <= 1 && favicon ? favicon : ''
  if (!src) return <span className="sidebar-watch-thumb fallback" aria-hidden="true">{label.slice(0, 1).toLocaleUpperCase('ru')}</span>
  return <img className="sidebar-watch-thumb" src={src} alt="" onError={() => setStage(current => current >= 1 || !imageUrl ? 2 : 1)} />
}
