import { useEffect, useMemo, useState } from 'react'
import type { Page } from '../App'
import type { Store, MonitorStatus, AnalyticsSummary, PriceMatrixRow } from '../types'
import { formatPrice, formatPercent, timeAgo } from '../utils/format'
import { Icon } from '../components/icons'
import Loader from '../components/Loader'
import PriceComparisonChart from '../components/PriceComparisonChart'

interface Props {
  onOpenStore: (id: string) => void
  onNavigate: (p: Page) => void
}

export default function Dashboard({ onOpenStore, onNavigate }: Props) {
  const [stores, setStores] = useState<Store[]>([])
  const [status, setStatus] = useState<MonitorStatus | null>(null)
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [selectedMatch, setSelectedMatch] = useState('')
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
  const competitorCount = stores.filter(store => store.role !== 'own').length
  const ownCount = stores.filter(store => store.role === 'own').length
  const productCount = stores.reduce((sum, store) => sum + store.products.length, 0)
  const priceMatrix = summary?.priceMatrix || []
  const ownComparisons = useMemo(() => priceMatrix.filter(row => row.ownOffers.length > 0), [summary])
  const overviewRows = ownCount > 0 ? ownComparisons : priceMatrix
  const selectedRow = priceMatrix.find(row => `${row.productName}|${row.currency}` === selectedMatch) || priceMatrix[0]
  const recentChanges = summary?.recentPriceChanges || []

  if (loading) return <div className="page-loader"><Loader size={36} />Загрузка обзора…</div>

  return (
    <div className="dashboard-page">
      <div className="page-header dashboard-header">
        <div>
          <div className="page-title">Обзор</div>
          <div className="page-subtitle">Цены рынка, сравнение ваших услуг и динамика изменений</div>
        </div>
        <div className="dashboard-actions">
          <span className={`badge ${status?.running ? 'ok' : 'error'}`}><span className={`monitor-dot ${status?.running ? 'on' : 'off'}`} />{status?.running ? 'Мониторинг включён' : 'Мониторинг остановлен'}</span>
          <button className="btn" onClick={() => onNavigate('monitoring')}><Icon name="activity" size={14} />Управление мониторингом</button>
        </div>
      </div>

      {stores.length === 0 ? (
        <section className="welcome-panel">
          <div className="welcome-icon"><Icon name="store" size={25} /></div>
          <div className="welcome-copy"><h2>Начните мониторинг рынка</h2><p>Добавьте свой магазин и пару конкурентов — OBSERVA найдёт похожие услуги и покажет разницу в ценах.</p></div>
          <button className="btn primary" onClick={() => onNavigate('stores')}><Icon name="plus" size={14} />Добавить источник</button>
        </section>
      ) : (
        <>
          <section className="stats-grid dashboard-stats">
            <div className="stat-card"><div className="stat-label">Конкуренты</div><div className="stat-value">{competitorCount}</div><div className="stat-hint">{stores.filter(store => store.role !== 'own' && store.enabled).length} в мониторинге</div></div>
            <div className="stat-card"><div className="stat-label">Мои магазины</div><div className="stat-value">{ownCount}</div><div className="stat-hint">для сравнения цен</div></div>
            <div className="stat-card"><div className="stat-label">Сравнимых услуг</div><div className="stat-value">{priceMatrix.length}</div><div className="stat-hint">совпали у разных магазинов</div></div>
            <div className="stat-card"><div className="stat-label">Собрано предложений</div><div className="stat-value">{productCount}</div><div className="stat-hint">из {stores.length} источников</div></div>
            <div className="stat-card"><div className="stat-label">Ошибки проверки</div><div className={`stat-value ${problemStores.length ? 'has-errors' : ''}`}>{problemStores.length}</div><div className="stat-hint">источников требуют внимания</div></div>
          </section>

          <section className="dashboard-columns">
            <div className="dashboard-panel">
              <div className="panel-heading"><div><h2>{ownCount ? 'Мои цены и рынок' : 'Сравнение рынка'}</h2><p>{ownCount ? 'Ваш тариф рядом с лучшей ценой конкурента' : 'Лучшие предложения по совпавшим услугам'}</p></div><button className="text-button" onClick={() => onNavigate('analytics')}>Все сравнения</button></div>
              {overviewRows.length ? <div className="dashboard-compare-list">
                {overviewRows.slice(0, 5).map((row: PriceMatrixRow, index) => {
                  const own = row.ownOffers[0]
                  const best = row.bestCompetitor
                  const competitorOffers = row.offers.filter(offer => offer.role === 'competitor')
                  const cheapest = competitorOffers.slice().sort((a, b) => a.price - b.price)[0]
                  const highest = Math.max(...competitorOffers.map(offer => offer.price), cheapest?.price || 0)
                  const delta = row.differencePercent || 0
                  return <div className="dashboard-compare-row" key={`${row.productName}-${row.currency}-${index}`}>
                    <span className="dashboard-compare-name"><b>{row.productName}</b><small>{own ? `${best?.storeName || 'Конкурент'} · ${best ? formatPrice(best.price, best.currency) : '—'}` : `${competitorOffers.length} магазина · ${row.matchedNames.length > 1 ? 'похожие названия' : 'совпадение'}`}</small></span>
                    <span className="dashboard-compare-own"><b>{own ? formatPrice(own.price, row.currency) : cheapest ? formatPrice(cheapest.price, row.currency) : '—'}</b><small className={own && row.difference != null ? row.difference <= 0 ? 'price-down' : 'price-up' : ''}>{own && row.difference != null ? `${row.difference <= 0 ? 'ниже' : 'выше'} на ${Math.abs(delta).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : cheapest && highest !== cheapest.price ? `${formatPrice(cheapest.price, row.currency)}–${formatPrice(highest, row.currency)}` : cheapest?.storeName || '—'}</small></span>
                  </div>
                })}
              </div> : <div className="panel-empty"><span className="neutral-icon"><Icon name="compare" size={16} /></span><span className="panel-empty-copy"><b>{ownCount ? 'Ваши услуги пока не сопоставлены' : 'Пока недостаточно совпадений'}</b><small>{ownCount ? 'Сопоставление использует название услуги и срок тарифа' : 'Нужно добавить ещё источники с похожими предложениями'}</small></span>{!ownCount && <button className="btn small primary" onClick={() => onNavigate('stores')}>Добавить</button>}</div>}
            </div>

            <div className="dashboard-panel">
              <div className="panel-heading"><div><h2>Последние изменения</h2><p>Данные сохраняются между запусками</p></div><button className="text-button" onClick={() => onNavigate('analytics')}>Сравнения цен</button></div>
              {recentChanges.length ? <div className="price-event-list">
                {recentChanges.slice(0, 5).map((change, index) => {
                  const increased = change.changePercent > 0
                  return <div className="price-event-row" key={`${change.storeId}-${change.productId}-${index}`}>
                    <span className={`change-marker ${increased ? 'up' : 'down'}`}><Icon name={increased ? 'trendingUp' : 'trendingDown'} size={15} /></span>
                    <span className="price-event-main"><b>{change.productName}</b><small>{change.storeName} · {change.suspectedMismatch ? 'Резкий скачок — проверьте тариф' : timeAgo(change.lastChangedAt)}</small></span>
                    <span className="price-event-value"><b>{formatPrice(change.previousPrice, change.currency)} → {formatPrice(change.lastPrice, change.currency)}</b><small className={change.suspectedMismatch ? 'price-up' : increased ? 'price-up' : 'price-down'}>{formatPercent(change.changePercent)}</small></span>
                  </div>
                })}
              </div> : <div className="panel-empty"><span className="neutral-icon"><Icon name="tag" size={16} /></span><span><b>История изменений собирается</b><small>Движение появится после того, как цена изменится между проверками</small></span></div>}
            </div>
          </section>

          {selectedRow && <section className="dashboard-panel dashboard-chart-panel">
            <div className="panel-heading"><div><h2>Сравнение цен</h2><p>Одинаковые и похожие услуги по магазинам</p></div>
              <select className="dashboard-chart-select" aria-label="Выберите услугу" value={selectedMatch || `${selectedRow.productName}|${selectedRow.currency}`} onChange={event => setSelectedMatch(event.target.value)}>
                {priceMatrix.map((row, index) => <option key={`${row.productName}-${row.currency}-${index}`} value={`${row.productName}|${row.currency}`}>{row.productName} · {row.currency}</option>)}
              </select>
            </div>
            <PriceComparisonChart offers={selectedRow.offers} currency={selectedRow.currency} />
          </section>}

          {problemStores.length > 0 && <section className="dashboard-panel dashboard-errors-panel">
            <div className="panel-heading"><div><h2>Требуют внимания</h2><p>Не удалось проверить источник</p></div><button className="text-button" onClick={() => onNavigate('stores')}>Все источники</button></div>
            <div className="attention-list">{problemStores.map(store => <button className="attention-row" key={store.id} onClick={() => onOpenStore(store.id)}><span className="attention-icon"><Icon name="alert" size={16} /></span><span className="attention-main"><b>{store.name}</b><small>{store.lastError || 'Проверка завершилась с ошибкой'}</small></span><span className="attention-time">{timeAgo(store.lastCheck)}</span></button>)}</div>
          </section>}

          <section className="dashboard-bottomline">
            <div className="bottomline-icon"><Icon name="activity" size={17} /></div>
            <div><b>{status?.running ? 'Автоматические проверки включены' : 'Автоматические проверки остановлены'}</b><span>Проверки выполняются, пока приложение открыто. Расписание можно изменить в карточке источника.</span></div>
            <button className="text-button" onClick={() => onNavigate('stores')}>Настроить источники</button>
          </section>
        </>
      )}
    </div>
  )
}
