import { useEffect, useMemo, useState } from 'react'
import type { Page } from '../App'
import type { Store, MonitorStatus, AnalyticsSummary, PriceMatrixRow } from '../types'
import { formatPrice, formatPercent, timeAgo } from '../utils/format'
import { faviconCandidates } from '../utils/favicon'
import { Icon } from '../components/icons'
import Loader from '../components/Loader'
import PricePositionChart from '../components/PricePositionChart'
import WatchCarousel from '../components/WatchCarousel'

interface Props {
  onOpenStore: (id: string) => void
  onOpenSimilar: (storeId: string, productId: string) => void
  onNavigate: (p: Page) => void
}

export default function Dashboard({ onOpenStore, onOpenSimilar, onNavigate }: Props) {
  const [stores, setStores] = useState<Store[]>([])
  const [status, setStatus] = useState<MonitorStatus | null>(null)
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = () => {
    Promise.all([window.observa.storesList(), window.observa.monitorStatus(), window.observa.analyticsSummary()]).then(([allStores, monitor, analytics]) => {
      setStores(allStores)
      setStatus(monitor)
      setSummary(analytics)
      setLoading(false)
    }).catch(error => console.error('Не удалось обновить обзор:', error))
  }

  useEffect(() => {
    refresh()
    let timer: number | undefined
    const scheduleRefresh = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(refresh, 250)
    }
    const unsubscribeMonitor = window.observa.onMonitorEvent(scheduleRefresh)
    const unsubscribeData = window.observa.onDataChanged(scheduleRefresh)
    return () => {
      window.clearTimeout(timer)
      unsubscribeMonitor()
      unsubscribeData()
    }
  }, [])

  const problemStores = stores.filter(store => store.status === 'error')
  const activeStores = stores.filter(store => store.enabled).length
  const productCount = stores.reduce((sum, store) => sum + store.products.length, 0)
  const priceMatrix = summary?.priceMatrix || []
  const ownComparisons = useMemo(() => priceMatrix.filter(row => row.ownOffers.length > 0), [summary])
  const selectedRows = ownComparisons.length ? ownComparisons : priceMatrix
  const recentChanges = summary?.recentPriceChanges || []
  const aboveMarket = ownComparisons.filter(row => row.difference != null && row.difference > 0).length
  const belowMarket = ownComparisons.filter(row => row.difference != null && row.difference <= 0).length
  const storeTotals = useMemo(() => {
    const groups = new Map<string, { storeId: string; storeName: string; role: 'own' | 'competitor'; currency: string; total: number; count: number }>()
    for (const offer of summary?.allOffers || []) {
      if (offer.price == null || !Number.isFinite(offer.price) || offer.price <= 0) continue
      const key = `${offer.storeId}|${offer.currency}`
      const group = groups.get(key) || { storeId: offer.storeId, storeName: offer.storeName, role: offer.role, currency: offer.currency, total: 0, count: 0 }
      group.total += offer.price
      group.count += 1
      groups.set(key, group)
    }
    return [...groups.values()].sort((a, b) => a.total - b.total)
  }, [summary])
  const statCurrency = storeTotals.find(item => item.role === 'own')?.currency || storeTotals[0]?.currency || 'RUB'
  const ownTotalGroups = storeTotals.filter(item => item.role === 'own' && item.currency === statCurrency)
  const ownTotal = ownTotalGroups.length ? ownTotalGroups.reduce((sum, item) => sum + item.total, 0) : null
  const ownOfferCount = ownTotalGroups.reduce((sum, item) => sum + item.count, 0)
  const ownAvg = ownTotal != null && ownOfferCount ? ownTotal / ownOfferCount : null
  const compTotals = storeTotals.filter(item => item.role !== 'own' && item.currency === statCurrency)
  const compAvgs = compTotals.filter(item => item.count > 0).map(item => ({ ...item, avg: item.total / item.count }))
  const bestCompAvg = compAvgs.length ? compAvgs.reduce((min, item) => item.avg < min.avg ? item : min) : null
  const totalDiff = ownAvg != null && bestCompAvg ? ownAvg - bestCompAvg.avg : null
  const totalDiffPct = totalDiff != null && bestCompAvg && bestCompAvg.avg > 0 ? (totalDiff / bestCompAvg.avg) * 100 : null
  const cheaperTotalsCount = ownAvg != null ? compAvgs.filter(item => item.avg < ownAvg).length : 0
  const cheaperTotalsShare = compAvgs.length ? Math.round((cheaperTotalsCount / compAvgs.length) * 100) : null

  const avgPriceByCurrency = useMemo(() => {
    const map = new Map<string, { sum: number; count: number }>()
    for (const offer of summary?.allOffers || []) {
      if (offer.price == null || !Number.isFinite(offer.price) || offer.price <= 0) continue
      const group = map.get(offer.currency) || { sum: 0, count: 0 }
      group.sum += offer.price
      group.count += 1
      map.set(offer.currency, group)
    }
    const result = new Map<string, number>()
    for (const [currency, group] of map) result.set(currency, group.sum / group.count)
    return result
  }, [summary])

  const iconByStore = useMemo(() => {
    const map = new Map<string, string | null>()
    for (const store of stores) {
      map.set(store.id, store.customIcon || (store.url ? faviconCandidates(store.url)[0] || null : null))
    }
    return map
  }, [stores])

  const positionOffers = useMemo(() => storeTotals.map(item => {
    const avgPrice = item.count ? item.total / item.count : 0
    const marketAvg = avgPriceByCurrency.get(item.currency) || avgPrice
    const diffPct = marketAvg > 0 ? ((avgPrice - marketAvg) / marketAvg) * 100 : 0
    return {
      storeId: item.storeId,
      storeName: item.storeName,
      role: item.role,
      price: diffPct,
      label: formatPercent(diffPct),
      hint: `${item.storeName} · средняя ${formatPrice(avgPrice, item.currency)} · ${item.count} услуг`,
      iconUrl: iconByStore.get(item.storeId) || null,
      avgPrice,
      currency: item.currency,
      count: item.count
    }
  }), [storeTotals, avgPriceByCurrency, iconByStore])

  if (loading) return <div className="page-loader"><Loader size={36} />Загрузка обзора…</div>

  return (
    <div className="dashboard-page overview-page">
      <header className="page-header dashboard-header">
        <div>
          <div className="page-title">Обзор</div>
          <div className="page-subtitle">Ваше место на рынке: цены, изменения и сигналы</div>
        </div>
        <div className="dashboard-actions">
          <button className="btn" onClick={refresh}><Icon name="refresh" size={14} />Обновить</button>
        </div>
      </header>

      {stores.length === 0 ? (
        <section className="welcome-panel">
          <div className="welcome-icon"><Icon name="store" size={25} /></div>
          <div className="welcome-copy"><h2>Начните мониторинг рынка</h2><p>Добавьте свой магазин и источники конкурентов — здесь появятся сравнения, история цен и изменения рынка.</p></div>
          <button className="btn primary" onClick={() => onNavigate('stores')}><Icon name="plus" size={14} />Добавить источник</button>
        </section>
      ) : (
        <>
          <section className="ov-ribbon dashboard-panel">
            <div className="ov-ribbon-status">
              <span className={`ov-status-dot ${status?.running ? 'on' : 'off'}`} />
              <div className="ov-ribbon-status-copy">
                <b>{status?.running ? 'Мониторинг активен' : 'Мониторинг остановлен'}</b>
                <small>{status?.running ? `Активность ${timeAgo(status.lastTickAt)}` : 'Проверки запускаются со страницы «Мониторинг»'}</small>
              </div>
            </div>
            <div className="ov-ribbon-stats">
              <div className="ov-stat">
                <span className="ov-stat-icon"><Icon name="store" size={15} /></span>
                <div className="ov-stat-copy"><b>{stores.length}</b><span>источников</span><small>{activeStores} активны</small></div>
              </div>
              <div className="ov-stat">
                <span className="ov-stat-icon"><Icon name="tag" size={15} /></span>
                <div className="ov-stat-copy"><b>{productCount}</b><span>предложений</span><small>{summary?.allOffers.filter(offer => offer.price != null).length || 0} с ценой</small></div>
              </div>
              <div className="ov-stat">
                <span className="ov-stat-icon"><Icon name="compare" size={15} /></span>
                <div className="ov-stat-copy"><b>{selectedRows.length}</b><span>сравнений</span><small>{ownComparisons.length ? 'ваши услуги с рынком' : 'между конкурентами'}</small></div>
              </div>
              <div className={`ov-stat${problemStores.length ? ' alert' : ''}`}>
                <span className="ov-stat-icon"><Icon name={problemStores.length ? 'alert' : 'activity'} size={15} /></span>
                <div className="ov-stat-copy"><b>{problemStores.length ? problemStores.length : activeStores}</b><span>{problemStores.length ? 'ошибок' : 'источников ок'}</span><small>{problemStores.length ? 'требуют внимания' : 'без ошибок'}</small></div>
              </div>
            </div>
          </section>

          <WatchCarousel summary={summary} onOpen={onOpenSimilar} />

          <section className="dashboard-panel ov-market">
            <div className="panel-heading">
              <div><span className="market-eyebrow">АНАЛИЗ ЦЕН</span><h2>Позиция на рынке</h2><p>Отклонение средней цены каждого магазина от средней по рынку</p></div>
              <button className="text-button" onClick={() => onNavigate('analytics')}>Вся аналитика</button>
            </div>
            <div className="ov-market-body">
              <PricePositionChart offers={positionOffers} />
              <div className="ov-position-stats">
                <div><span>Ваша средняя цена</span><b>{ownAvg != null ? formatPrice(ownAvg, statCurrency) : '—'}</b><small>{ownOfferCount ? `${ownOfferCount} услуг` : 'нет своих цен'}</small></div>
                <div><span>Средняя цена конкурента</span><b>{bestCompAvg ? formatPrice(bestCompAvg.avg, statCurrency) : '—'}</b><small>{bestCompAvg?.storeName || ''}</small></div>
                <div className={totalDiff == null ? '' : totalDiff > 0 ? 'up' : 'down'}>
                  <span>{totalDiff == null ? 'Позиция' : totalDiff > 0 ? 'Вы дороже рынка' : 'Вы не дороже рынка'}</span>
                  <b>{totalDiffPct != null ? formatPercent(Math.abs(totalDiffPct)) : '—'}</b>
                </div>
                {cheaperTotalsShare != null && <div className={cheaperTotalsShare > 50 ? 'up' : 'down'}><span>Конкурентов дешевле вас</span><b>{cheaperTotalsShare}%</b></div>}
              </div>
            </div>
          </section>

          <section className="ov-lower">
            <div className="dashboard-panel market-dashboard-comparisons">
              <div className="panel-heading"><div><span className="market-eyebrow">ЦЕНЫ И РАЗНИЦА</span><h2>{ownComparisons.length ? 'Мои услуги и конкуренты' : 'Сравнение предложений'}</h2><p>{ownComparisons.length ? `${aboveMarket} выше рынка · ${belowMarket} на уровне или ниже` : 'Наиболее заметные ценовые различия'}</p></div><button className="text-button" onClick={() => onNavigate('analytics')}>Вся таблица</button></div>
              {selectedRows.length ? <div className="market-comparison-table-wrap"><table className="market-dashboard-table"><thead><tr><th>Услуга</th><th>Моя цена</th><th>Лучший конкурент</th><th>Разница</th></tr></thead><tbody>
                {selectedRows.slice(0, 7).map((row: PriceMatrixRow, index) => {
                  const own = row.ownOffers[0]
                  const best = row.bestCompetitor
                  return <tr key={`${row.productName}|${row.currency}|${index}`}>
                    <td><b>{row.productName}</b><small>{row.offers.length} источника{row.manual ? ' · ручное совпадение' : ''}</small></td>
                    <td>{own ? formatPrice(own.price, row.currency) : '—'}</td>
                    <td>{best ? <>{formatPrice(best.price, row.currency)}<small>{best.storeName}</small></> : '—'}</td>
                    <td className={row.difference == null ? '' : row.difference > 0 ? 'price-up' : 'price-down'}>{row.differencePercent == null ? '—' : formatPercent(row.differencePercent)}</td>
                  </tr>
                })}
              </tbody></table></div> : <div className="market-dashboard-empty">Добавьте похожие услуги в несколько источников, чтобы сравнить их цены.</div>}
            </div>

            <div className="dashboard-panel market-dashboard-changes">
              <div className="panel-heading"><div><span className="market-eyebrow">ИСТОРИЯ РЫНКА</span><h2>Последние изменения</h2><p>Изменения цены по источникам</p></div><button className="text-button" onClick={() => onNavigate('analytics')}>Аналитика</button></div>
              {recentChanges.length ? <div className="market-change-list">{recentChanges.slice(0, 6).map((change, index) => <button className="market-change-row" key={`${change.storeId}|${change.productId}|${index}`} onClick={() => onOpenStore(change.storeId)}>
                <span className={`market-change-icon ${change.changePercent > 0 ? 'up' : 'down'}`}><Icon name={change.changePercent > 0 ? 'trendingUp' : 'trendingDown'} size={15} /></span>
                <span className="market-change-copy"><b>{change.productName}</b><small>{change.storeName} · {timeAgo(change.lastChangedAt)}</small></span>
                <span className="market-change-value"><b className={change.changePercent > 0 ? 'price-up' : 'price-down'}>{formatPercent(change.changePercent)}</b><small>{formatPrice(change.lastPrice, change.currency)}</small></span>
              </button>)}</div> : <div className="market-dashboard-empty">Изменения появятся после фиксации новых цен.</div>}
            </div>
          </section>

          {problemStores.length > 0 && <section className="dashboard-panel dashboard-errors-panel">
            <div className="panel-heading"><div><span className="market-eyebrow">ТРЕБУЮТ ВНИМАНИЯ</span><h2>Источники с ошибками</h2><p>Проверьте доступность сайтов и корректность адресов</p></div><button className="text-button" onClick={() => onNavigate('stores')}>Управление источниками</button></div>
            <div className="attention-list">{problemStores.map(store => <button className="attention-row" key={store.id} onClick={() => onOpenStore(store.id)}><span className="attention-icon"><Icon name="alert" size={16} /></span><span className="attention-main"><b>{store.name}</b><small>{store.lastError || 'Проверка завершилась с ошибкой'}</small></span><span className="attention-time">{timeAgo(store.lastCheck)}</span></button>)}</div>
          </section>}
        </>
      )}
    </div>
  )
}
