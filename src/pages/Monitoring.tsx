import { useEffect, useMemo, useState } from 'react'
import type { Store, MonitorStatus, AnalyticsSummary, MarketOffer } from '../types'
import { formatPrice, formatPercent, formatDate, timeAgo } from '../utils/format'
import { Icon } from '../components/icons'
import Loader from '../components/Loader'
import ProductImage from '../components/ProductImage'
import Checkbox from '../components/Checkbox'

type KindFilter = 'all' | 'apps' | 'subscriptions' | 'telegram' | 'giftcards' | 'other'
type RoleFilter = 'all' | 'own' | 'competitor' | 'telegram'
type SortKey = 'name' | 'price' | 'delta' | 'updated'

const KIND_LABELS: Record<KindFilter, string> = {
  all: 'Все виды',
  apps: 'Приложения',
  subscriptions: 'Подписки и игры',
  telegram: 'Telegram',
  giftcards: 'Подарочные карты',
  other: 'Прочее'
}

function offerKind(name: string): Exclude<KindFilter, 'all'> {
  const n = name.toLocaleLowerCase('ru')
  if (/telegram|тг\b|тг |звёзд|звезд|премиум/.test(n)) return 'telegram'
  if (/xbox|playstation|psn|ps plus|nintendo|steam|ea play|game pass|ubisoft|подписк|тариф/.test(n)) return 'subscriptions'
  if (/gift|гифт|apple|itunes|google play|пополн|баланс|карта/.test(n)) return 'giftcards'
  if (/установ|приложен|app\b|apps\b/.test(n)) return 'apps'
  return 'other'
}

const ROLE_LABELS: Record<RoleFilter, string> = {
  all: 'Все',
  own: 'Мои',
  competitor: 'Конкуренты',
  telegram: 'Telegram'
}

export default function Monitoring() {
  const [stores, setStores] = useState<Store[]>([])
  const [status, setStatus] = useState<MonitorStatus | null>(null)
  const [checking, setChecking] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [startAtLogin, setStartAtLogin] = useState(false)
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [showDisabledStores, setShowDisabledStores] = useState(false)
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [onlyChanged, setOnlyChanged] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'delta', dir: -1 })

  const refresh = () => {
    Promise.all([window.observa.storesList(), window.observa.monitorStatus(), window.observa.analyticsSummary()]).then(([s, st, data]) => {
      setStores(s)
      setStatus(st)
      setSummary(data)
      setLoading(false)
    })
  }

  useEffect(() => {
    refresh()
    let timer: number | undefined
    const unsubscribe = window.observa.onMonitorEvent(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(refresh, 250)
    })
    const unsubscribeData = window.observa.onDataChanged(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(refresh, 150)
    })
    window.observa.monitorStartAtLogin().then(setStartAtLogin)
    return () => { window.clearTimeout(timer); unsubscribe(); unsubscribeData() }
  }, [])

  const monitoredStores = stores.filter(store => showDisabledStores || store.enabled)
  const changeByOffer = useMemo(() => {
    const map = new Map<string, { changePercent: number; lastChangedAt: string }>()
    for (const change of summary?.recentPriceChanges || []) {
      map.set(`${change.storeId}|${change.productId}`, { changePercent: change.changePercent, lastChangedAt: change.lastChangedAt })
    }
    return map
  }, [summary])

  const offers = useMemo(() => {
    const all = summary?.allOffers || []
    const query = search.trim().toLocaleLowerCase('ru')
    const filtered = all.filter(offer => {
      if (kindFilter !== 'all' && offerKind(offer.productName) !== kindFilter) return false
      if (roleFilter !== 'all') {
        if (roleFilter === 'telegram' ? offer.sourceType !== 'telegram' : offer.role !== roleFilter) return false
      }
      if (onlyChanged && !changeByOffer.has(`${offer.storeId}|${offer.productId}`)) return false
      if (query && !`${offer.productName} ${offer.storeName}`.toLocaleLowerCase('ru').includes(query)) return false
      return true
    })
    const deltaOf = (offer: MarketOffer) => changeByOffer.get(`${offer.storeId}|${offer.productId}`)?.changePercent ?? null
    const valueOf = (offer: MarketOffer): string | number | null => {
      switch (sort.key) {
        case 'name': return offer.productName.toLocaleLowerCase('ru')
        case 'price': return offer.price
        case 'delta': return deltaOf(offer)
        case 'updated': return offer.lastChecked || ''
      }
    }
    return filtered.slice().sort((a, b) => {
      const av = valueOf(a); const bv = valueOf(b)
      if (av == null && bv == null) return a.productName.localeCompare(b.productName, 'ru')
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = typeof av === 'string' ? av.localeCompare(String(bv), 'ru') : (av as number) - (bv as number)
      return cmp * sort.dir || a.productName.localeCompare(b.productName, 'ru')
    })
  }, [summary, search, kindFilter, roleFilter, onlyChanged, sort, changeByOffer])

  const kindCounts = useMemo(() => {
    const counts: Record<KindFilter, number> = { all: 0, apps: 0, subscriptions: 0, telegram: 0, giftcards: 0, other: 0 }
    for (const offer of summary?.allOffers || []) {
      counts.all++
      counts[offerKind(offer.productName)]++
    }
    return counts
  }, [summary])

  const toggleSort = (key: SortKey) => {
    setSort(current => current.key === key ? { key, dir: current.dir === 1 ? -1 : 1 } : { key, dir: key === 'name' || key === 'updated' ? 1 : -1 })
  }
  const sortMark = (key: SortKey) => sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''

  const toggleStartAtLogin = async () => {
    const enabled = await window.observa.monitorSetStartAtLogin(!startAtLogin)
    setStartAtLogin(enabled)
  }

  const toggleMonitor = async () => {
    if (status?.running) await window.observa.monitorStop()
    else await window.observa.monitorStart()
    refresh()
  }

  const checkStore = async (id: string) => {
    setChecking(id)
    await window.observa.monitorCheckNow(id)
    setChecking(null)
    refresh()
  }

  const checkAll = async () => {
    setChecking('all')
    await window.observa.monitorCheckAll()
    setChecking(null)
    refresh()
  }

  if (loading) {
    return <div className="page-loader"><Loader size={36} />Загрузка мониторинга…</div>
  }

  const enabledCount = stores.filter(store => store.enabled).length
  const checkingCount = status?.checkingStores?.length ?? 0

  return (
    <div className="monitoring-page">
      <div className="page-header">
        <div>
          <div className="page-title">Мониторинг</div>
          <div className="page-subtitle">Все отслеживаемые предложения рынка в реальном времени</div>
        </div>
        <div className="monitor-header-actions">
          {checkingCount > 0 && (
            <button className="btn" onClick={async () => { await window.observa.monitorCancelChecks(); refresh() }}>
              <Icon name="stop" size={14} /> Отменить очередь
            </button>
          )}
          <button className="btn" onClick={checkAll} disabled={checking === 'all'}>
            {checking === 'all' ? 'Проверка…' : <><Icon name="zap" size={14} /> Проверить все сейчас</>}
          </button>
          <button className={`btn ${status?.running ? 'danger' : 'primary'}`} onClick={toggleMonitor}>
            {status?.running ? <><Icon name="stop" size={14} /> Остановить</> : <><Icon name="play" size={14} /> Запустить мониторинг</>}
          </button>
        </div>
      </div>

      <div className="monitor-status-strip dashboard-panel">
        <span className={`badge ${status?.running ? 'ok' : 'error'}`}>
          <span className={`monitor-dot ${status?.running ? 'on' : 'off'}`} />
          {status?.running ? 'Мониторинг работает' : 'Мониторинг остановлен'}
        </span>
        <span className="monitor-status-item">Тик: {status?.lastTickAt ? timeAgo(status.lastTickAt) : '—'}</span>
        <span className="monitor-status-item">Проверок: <b>{status?.totalChecks ?? 0}</b></span>
        <span className="monitor-status-item">Ошибок: <b style={{ color: status?.totalErrors ? 'var(--red)' : undefined }}>{status?.totalErrors ?? 0}</b></span>
        <span className="monitor-status-item">В проверке: <b>{checkingCount}</b> из {enabledCount}</span>
        {window.navigator.platform.toLowerCase().includes('win') && (
          <button className={`btn small ${startAtLogin ? 'primary' : ''}`} onClick={toggleStartAtLogin} style={{ marginLeft: 'auto' }}>
            Автозапуск: {startAtLogin ? 'вкл' : 'выкл'}
          </button>
        )}
      </div>

      <div className="monitoring-sources-heading">
        <div className="section-title">Предложения рынка <span className="monitoring-source-count">{offers.length}</span></div>
      </div>
      <div className="market-table-toolbar">
        <label className="search-box"><Icon name="search" size={16} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Товар или источник…" /></label>
        <div className="filter-pills" role="group" aria-label="Вид услуги">
          {(Object.keys(KIND_LABELS) as KindFilter[]).map(kind => (
            <button key={kind} className={kindFilter === kind ? 'selected' : ''} onClick={() => setKindFilter(kind)}>
              {KIND_LABELS[kind]} <span>{kindCounts[kind]}</span>
            </button>
          ))}
        </div>
        <div className="filter-pills" role="group" aria-label="Роль источника">
          {(Object.keys(ROLE_LABELS) as RoleFilter[]).map(role => (
            <button key={role} className={roleFilter === role ? 'selected' : ''} onClick={() => setRoleFilter(role)}>{ROLE_LABELS[role]}</button>
          ))}
        </div>
        <Checkbox checked={onlyChanged} onChange={setOnlyChanged} label="Только изменения" />
      </div>

      <div className="table-wrap market-table-wrap">
        <table className="market-watch-table">
          <thead>
            <tr>
              <th>Товар / услуга</th>
              <th>Вид</th>
              <th>Источник</th>
              <th className="sortable" onClick={() => toggleSort('price')}>Цена{sortMark('price')}</th>
              <th className="sortable" onClick={() => toggleSort('delta')}>Изменение{sortMark('delta')}</th>
              <th className="sortable" onClick={() => toggleSort('updated')}>Обновлено{sortMark('updated')}</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {offers.map(offer => {
              const change = changeByOffer.get(`${offer.storeId}|${offer.productId}`)
              const kind = offerKind(offer.productName)
              return (
                <tr key={`${offer.storeId}|${offer.productId}`} className="row-clickable" onClick={() => window.observa.openExternal(offer.url)} data-tooltip="Открыть предложение на сайте">
                  <td>
                    <div className="market-product-cell">
                      <ProductImage imageUrl={offer.imageUrl} sourceUrl={offer.url} className="market-product-image" placeholderClassName="market-product-placeholder" placeholderIcon="tag" />
                      <span><b data-tooltip={offer.productName}>{offer.productName}</b><small>{offer.category !== 'general' ? offer.category : ''}</small></span>
                    </div>
                  </td>
                  <td><span className={`offer-kind offer-kind-${kind}`}>{KIND_LABELS[kind]}</span></td>
                  <td>
                    <b data-tooltip={offer.storeName}>{offer.storeName}</b>
                    <small className="matrix-source">{offer.role === 'own' ? 'Мой магазин' : offer.sourceType === 'telegram' ? 'Telegram' : 'Конкурент'}</small>
                  </td>
                  <td className="matrix-price">{offer.price == null ? '—' : formatPrice(offer.price, offer.currency)}</td>
                  <td className={change ? (change.changePercent > 0 ? 'price-up' : 'price-down') : 'monitor-cell-muted'}>
                    {change ? formatPercent(change.changePercent) : '—'}
                  </td>
                  <td className="monitor-cell-muted">{offer.lastChecked ? timeAgo(offer.lastChecked) : '—'}</td>
                  <td>{offer.stale ? <span className="badge checking">Устарела</span> : <span className="badge ok">Актуальна</span>}</td>
                </tr>
              )
            })}
            {!offers.length && (
              <tr><td colSpan={7} className="table-empty-cell">Нет предложений по выбранным фильтрам.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="monitoring-sources-heading spaced">
        <div className="section-title">Источники <span className="monitoring-source-count">{monitoredStores.length}</span></div>
        <button className="text-button" onClick={() => setShowDisabledStores(value => !value)}>{showDisabledStores ? 'Скрыть выключенные' : `Показать выключенные (${stores.filter(store => !store.enabled).length})`}</button>
      </div>
      <div className="table-wrap monitor-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Магазин</th>
              <th>Интервал</th>
              <th>Товаров</th>
              <th>Статус</th>
              <th>Последнее успешное обновление</th>
              <th>Ошибка</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {monitoredStores.map(s => (
              <tr key={s.id}>
                <td>
                  <div className="monitor-store-name">{s.name}</div>
                  <div className="monitor-store-url">{s.url}</div>
                </td>
                <td>{s.checkIntervalMin} мин</td>
                <td>{s.products.length}</td>
                <td>
                  <span className={`badge ${s.status}`}>
                    {s.status === 'ok' ? 'OK' : s.status === 'error' ? 'Ошибка' : s.status === 'checking' ? 'Проверка…' : 'Ожидание'}
                  </span>
                </td>
                <td className="monitor-cell-muted">{formatDate(s.lastSuccessCheck || (s.status === 'ok' ? s.lastCheck : null))}</td>
                <td className="monitor-error-cell" data-tooltip={s.lastError || undefined}>
                  {s.lastError || '—'}
                </td>
                <td>
                  <button
                    className="btn small"
                    onClick={() => checkStore(s.id)}
                    disabled={checking === s.id || s.status === 'checking'}
                  >
                    {checking === s.id ? '…' : 'Проверить'}
                  </button>
                </td>
              </tr>
            ))}
            {monitoredStores.length === 0 && (
              <tr><td colSpan={7} className="table-empty-cell">
                {stores.length ? 'Включите мониторинг у источника во вкладке «Источники» или покажите выключенные.' : 'Добавьте магазины во вкладке «Источники»'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
