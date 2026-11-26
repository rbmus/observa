import { useEffect, useMemo, useState } from 'react'
import type { Page } from '../App'
import type { Store, MonitorStatus, AnalyticsSummary, PriceMatrixRow } from '../types'
import { formatPrice, formatPercent, timeAgo } from '../utils/format'
import { Icon } from '../components/icons'
import Loader from '../components/Loader'
import PriceComparisonChart from '../components/PriceComparisonChart'
import MarketHistoryChart, { type MarketHistorySeries } from '../components/MarketHistoryChart'

interface Props {
  onOpenStore: (id: string) => void
  onNavigate: (p: Page) => void
}

export default function Dashboard({ onOpenStore, onNavigate }: Props) {
  const [stores, setStores] = useState<Store[]>([])
  const [status, setStatus] = useState<MonitorStatus | null>(null)
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [selectedMatch, setSelectedMatch] = useState('')
  const [marketHistory, setMarketHistory] = useState<MarketHistorySeries[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
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
  const selectedRow = selectedRows.find(row => `${row.productName}|${row.currency}` === selectedMatch) || selectedRows[0]
  const selectedKey = selectedRow ? `${selectedRow.productName}|${selectedRow.currency}` : ''
  const recentChanges = summary?.recentPriceChanges || []
  const aboveMarket = ownComparisons.filter(row => row.difference != null && row.difference > 0).length
  const belowMarket = ownComparisons.filter(row => row.difference != null && row.difference <= 0).length
  const historyHasTrend = marketHistory.some(item => item.points.length >= 2)

  useEffect(() => {
    let active = true
    if (!selectedRow) {
      setMarketHistory([])
      return () => { active = false }
    }
    setHistoryLoading(true)
    Promise.all(selectedRow.offers.map(async offer => ({
      storeName: offer.storeName,
      role: offer.role,
      points: await window.observa.analyticsPriceDynamics(offer.storeId, offer.productId)
    }))).then(series => { if (active) setMarketHistory(series) })
      .catch(error => console.error('Не удалось загрузить динамику цен:', error))
      .finally(() => { if (active) setHistoryLoading(false) })
    return () => { active = false }
  }, [selectedKey, summary])

  if (loading) return <div className="page-loader"><Loader size={36} />Загрузка обзора…</div>

  return (
    <div className="dashboard-page market-dashboard">
      <header className="page-header dashboard-header">
        <div>
          <div className="page-title">Обзор рынка</div>
          <div className="page-subtitle">Цены, динамика и положение ваших предложений среди конкурентов</div>
        </div>
        <div className="dashboard-actions">
          <span className={`badge ${status?.running ? 'ok' : 'idle'}`}><span className={`monitor-dot ${status?.running ? 'on' : 'off'}`} />{status?.running ? 'Мониторинг работает' : 'Мониторинг остановлен'}</span>
          <button className="btn" onClick={refresh}><Icon name="refresh" size={14} />Обновить данные</button>
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
          <section className="market-kpi-grid">
            <article className="market-kpi-card">
              <span className="market-kpi-icon"><Icon name="store" size={16} /></span>
              <span className="market-kpi-label">Источники</span>
              <b>{stores.length}</b>
              <small>{activeStores} включено в мониторинг</small>
            </article>
            <article className="market-kpi-card">
              <span className="market-kpi-icon"><Icon name="tag" size={16} /></span>
              <span className="market-kpi-label">Предложения</span>
              <b>{productCount}</b>
              <small>{summary?.allOffers.filter(offer => offer.price != null).length || 0} с актуальной ценой</small>
            </article>
            <article className="market-kpi-card">
              <span className="market-kpi-icon"><Icon name="compare" size={16} /></span>
              <span className="market-kpi-label">Сопоставлено</span>
              <b>{selectedRows.length}</b>
              <small>{ownComparisons.length ? 'услуг вашего магазина с рынком' : 'общих услуг между конкурентами'}</small>
            </article>
            <article className={`market-kpi-card ${problemStores.length ? 'market-kpi-alert' : ''}`}>
              <span className="market-kpi-icon"><Icon name={problemStores.length ? 'alert' : 'activity'} size={16} /></span>
              <span className="market-kpi-label">Проверка источников</span>
              <b>{problemStores.length ? problemStores.length : activeStores}</b>
              <small>{problemStores.length ? 'ошибок требуют внимания' : 'источников без ошибок'}</small>
            </article>
          </section>

          <section className="market-dashboard-hero dashboard-panel">
            <div className="market-dashboard-hero-heading">
              <div><span className="market-eyebrow">АНАЛИЗ ЦЕН</span><h2>Динамика и позиция на рынке</h2><p>{selectedRow ? `${selectedRow.productName} · ${selectedRow.currency}` : 'История и сравнение предложений'}</p></div>
              <div className="market-hero-controls">
                {selectedRows.length > 0 && <select aria-label="Выберите услугу для анализа" value={selectedKey} onChange={event => setSelectedMatch(event.target.value)}>
                  {selectedRows.map(row => <option key={`${row.productName}|${row.currency}`} value={`${row.productName}|${row.currency}`}>{row.productName} · {row.currency}</option>)}
                </select>}
                <button className="btn small" onClick={() => onNavigate('analytics')}>Все сравнения</button>
              </div>
            </div>

            {selectedRow ? <div className="market-dashboard-hero-grid">
              <div className="market-dashboard-chart-area">
                <div className="market-chart-summary">
                  <div><span>Цена вашего предложения</span><b>{selectedRow.ownOffers[0] ? formatPrice(selectedRow.ownOffers[0].price, selectedRow.currency) : 'Нет своего предложения'}</b></div>
                  <div><span>Лучшая цена конкурента</span><b>{selectedRow.bestCompetitor ? formatPrice(selectedRow.bestCompetitor.price, selectedRow.currency) : '—'}</b></div>
                  {selectedRow.differencePercent != null && <span className={`market-delta-pill ${selectedRow.difference! > 0 ? 'negative' : 'positive'}`}>{selectedRow.difference! > 0 ? 'Выше' : 'Ниже'} на {formatPercent(Math.abs(selectedRow.differencePercent))}</span>}
                </div>
                <div className="market-main-chart">
                  {historyLoading
                    ? <div className="chart-empty">Загружаю историю цен…</div>
                    : historyHasTrend
                      ? <MarketHistoryChart series={marketHistory} currency={selectedRow.currency} />
                      : <div className="market-current-comparison"><p>История цены пока короткая. Текущее сравнение предложений:</p><PriceComparisonChart offers={selectedRow.offers} currency={selectedRow.currency} /></div>}
                </div>
              </div>
              <aside className="market-dashboard-insights">
                <div className="market-insight-title"><span>Срез рынка</span><small>{selectedRow.offers.length} предложений</small></div>
                <div className="market-insight-stat"><span>Минимальная цена</span><b>{formatPrice(Math.min(...selectedRow.offers.map(offer => offer.price)), selectedRow.currency)}</b><small>{selectedRow.offers.slice().sort((a, b) => a.price - b.price)[0]?.storeName || '—'}</small></div>
                <div className="market-insight-stat"><span>Средняя цена</span><b>{formatPrice(selectedRow.offers.reduce((total, offer) => total + offer.price, 0) / selectedRow.offers.length, selectedRow.currency)}</b><small>по сопоставленным источникам</small></div>
                <div className="market-insight-stat"><span>Максимальная цена</span><b>{formatPrice(Math.max(...selectedRow.offers.map(offer => offer.price)), selectedRow.currency)}</b><small>{selectedRow.offers.slice().sort((a, b) => b.price - a.price)[0]?.storeName || '—'}</small></div>
                <div className="market-insight-footer"><span>Совпадение</span><b className={selectedRow.manual ? 'manual-match-tag' : ''}>{selectedRow.manual ? 'Подтверждено вручную' : `${Math.round(selectedRow.matchConfidence * 100)}%`}</b></div>
              </aside>
            </div> : <div className="market-dashboard-no-match"><span className="neutral-icon"><Icon name="chart" size={18} /></span><span><b>Пока нечего сравнивать</b><small>Добавьте источники похожих услуг или предложений.</small></span><button className="btn small primary" onClick={() => onNavigate('stores')}>Добавить источник</button></div>}
          </section>

          <section className="market-dashboard-lower">
            <div className="dashboard-panel market-dashboard-comparisons">
              <div className="panel-heading"><div><span className="market-eyebrow">ЦЕНЫ И РАЗНИЦА</span><h2>{ownComparisons.length ? 'Мои услуги и конкуренты' : 'Сравнение предложений'}</h2><p>{ownComparisons.length ? `${aboveMarket} выше рынка · ${belowMarket} на уровне или ниже` : 'Наиболее заметные ценовые различия'}</p></div><button className="text-button" onClick={() => onNavigate('analytics')}>Вся таблица</button></div>
              {selectedRows.length ? <div className="market-comparison-table-wrap"><table className="market-dashboard-table"><thead><tr><th>Услуга</th><th>Моя цена</th><th>Лучший конкурент</th><th>Разница</th></tr></thead><tbody>
                {selectedRows.slice(0, 7).map((row: PriceMatrixRow, index) => {
                  const own = row.ownOffers[0]
                  const best = row.bestCompetitor
                  return <tr key={`${row.productName}|${row.currency}|${index}`} onClick={() => setSelectedMatch(`${row.productName}|${row.currency}`)} className={selectedKey === `${row.productName}|${row.currency}` ? 'selected' : ''}>
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
