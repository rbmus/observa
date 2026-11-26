import { useEffect, useState } from 'react'
import type { AnalyticsSummary, PriceMatrixRow } from '../types'
import type { MarketOffer, PriceOffer } from '../types'
import { formatPrice, formatPercent } from '../utils/format'
import { Icon } from '../components/icons'
import Loader from '../components/Loader'
import Checkbox from '../components/Checkbox'
import PriceComparisonChart from '../components/PriceComparisonChart'
import MarketHistoryChart, { type MarketHistorySeries } from '../components/MarketHistoryChart'

interface Props { onOpenCompetitors: () => void }

function sourceHost(url: string) {
  try { return new URL(url).hostname } catch { return url }
}

function offerIsStale(offer: MarketOffer, now: number) {
  return !offer.lastChecked || now - new Date(offer.lastChecked).getTime() > (offer.staleAfterMs || 60 * 60 * 1000)
}

export default function Analytics({ onOpenCompetitors }: Props) {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [exporting, setExporting] = useState(false)
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [storeType, setStoreType] = useState<'all' | 'own' | 'competitor' | 'telegram'>('all')
  const [currency, setCurrency] = useState('all')
  const [comparisonOnly, setComparisonOnly] = useState(false)
  const [view, setView] = useState<'comparisons' | 'offers' | 'review'>('comparisons')
  const [selectedReviewKeys, setSelectedReviewKeys] = useState<string[]>([])
  const [selectedMatch, setSelectedMatch] = useState('')
  const [marketHistory, setMarketHistory] = useState<MarketHistorySeries[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [savingMatch, setSavingMatch] = useState(false)
  const [now, setNow] = useState(Date.now())

  const refresh = () => window.observa.analyticsSummary().then(setSummary)

  useEffect(() => {
    refresh()
    const clock = window.setInterval(() => setNow(Date.now()), 60_000)
    let timer: number | undefined
    const unsubscribe = window.observa.onDataChanged(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(refresh, 250)
    })
    return () => { window.clearInterval(clock); window.clearTimeout(timer); unsubscribe() }
  }, [])

  const exportFile = async (kind: 'csv' | 'pdf', rows: PriceMatrixRow[]) => {
    if (!summary) return
    setExporting(true)
    setMessage('')
    try {
      const saved = kind === 'csv'
        ? await window.observa.analyticsExportCsv(rows)
        : await window.observa.analyticsExportPdf(rows)
      if (saved) setMessage(kind === 'csv' ? 'Таблица сохранена. CSV-файл можно открыть в Excel.' : 'PDF-сводка сохранена.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось экспортировать сводку')
    } finally { setExporting(false) }
  }

  const priceMatrix = summary?.priceMatrix ?? []
  const allOffers = summary?.allOffers ?? []
  const currencies = [...new Set([...priceMatrix.map(row => row.currency), ...allOffers.map(offer => offer.currency)])].sort()
  const comparableOfferIds = new Set(priceMatrix.flatMap(row => row.offers.map(offer => `${offer.storeId}|${offer.productId}`)))
  const visibleOffers = (row: PriceMatrixRow) => row.offers.filter(offer => storeType === 'all' || (storeType === 'telegram' ? offer.sourceType === 'telegram' : offer.role === storeType))
  const filteredOffers = allOffers.filter(offer => {
    const text = `${offer.productName} ${offer.storeName} ${offer.category}`.toLocaleLowerCase()
    return (!search.trim() || text.includes(search.trim().toLocaleLowerCase())) &&
      (currency === 'all' || offer.currency === currency) &&
      (storeType === 'all' || (storeType === 'telegram' ? offer.sourceType === 'telegram' : offer.role === storeType)) &&
      (!comparisonOnly || comparableOfferIds.has(`${offer.storeId}|${offer.productId}`))
  })
  const filteredMatrix = priceMatrix.filter(row => {
    const text = `${row.productName} ${row.matchedNames.join(' ')} ${row.offers.map(offer => offer.storeName).join(' ')}`.toLocaleLowerCase()
    const offers = visibleOffers(row)
    return (!search.trim() || text.includes(search.trim().toLocaleLowerCase())) &&
      (currency === 'all' || row.currency === currency) && offers.length > 0 &&
      (!comparisonOnly || (row.ownOffers.length > 0 && !!row.bestCompetitor))
  })
  const comparableCount = filteredMatrix.filter(row => row.ownOffers.length > 0 && row.bestCompetitor).length
  const offerCount = view === 'offers' ? filteredOffers.length : filteredMatrix.reduce((sum, row) => sum + visibleOffers(row).length, 0)
  const filteredTrends = (items: AnalyticsSummary['topGainers']) => items.filter(item => !search.trim() || `${item.productName} ${item.storeName}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const topGainers = filteredTrends(summary?.topGainers ?? [])
  const topLosers = filteredTrends(summary?.topLosers ?? [])
  const selectedRow = filteredMatrix.find(row => `${row.productName}|${row.currency}` === selectedMatch) || filteredMatrix[0]
  const selectedKey = selectedRow ? `${selectedRow.productName}|${selectedRow.currency}` : ''
  const exportRows: PriceMatrixRow[] = view === 'offers'
    ? filteredOffers.filter(offer => offer.price != null).map(offer => ({
      productName: offer.productName, currency: offer.currency, matchedNames: [offer.productName], matchConfidence: 1,
      offers: [{ ...offer, price: offer.price as number }],
      ownOffers: offer.role === 'own' ? [{ ...offer, price: offer.price as number }] : [],
      bestCompetitor: offer.role === 'competitor' ? { ...offer, price: offer.price as number } : null,
      difference: null, differencePercent: null
    }))
    : filteredMatrix

  const matchedReviewRefs = new Set(filteredMatrix.flatMap(row => row.offers.map(offer => `${offer.storeId}|${offer.productId}`)))
  const reviewEntries = [
    ...filteredMatrix.map(row => ({
      key: `group:${row.offers.map(offer => `${offer.storeId}|${offer.productId}`).sort().join(',')}`,
      productName: row.productName,
      offers: row.offers as (PriceOffer | MarketOffer)[],
      confidence: row.matchConfidence,
      manual: Boolean(row.manual)
    })),
    ...filteredOffers.filter(offer => offer.price != null && !matchedReviewRefs.has(`${offer.storeId}|${offer.productId}`)).map(offer => ({
      key: `offer:${offer.storeId}|${offer.productId}`,
      productName: offer.productName,
      offers: [offer] as (PriceOffer | MarketOffer)[],
      confidence: 0,
      manual: false
    }))
  ]
  const chosenReviewEntries = reviewEntries.filter(entry => selectedReviewKeys.includes(entry.key))
  const chosenReviewOffers = chosenReviewEntries.flatMap(entry => entry.offers)
  const mergeIsValid = chosenReviewOffers.length > 1 && new Set(chosenReviewOffers.map(offer => offer.storeId)).size === chosenReviewOffers.length && new Set(chosenReviewOffers.map(offer => offer.currency.toUpperCase())).size === 1

  const saveSelectedMatch = async () => {
    if (!mergeIsValid) return
    setSavingMatch(true)
    try {
      const refs = chosenReviewOffers.map(offer => ({ storeId: offer.storeId, productId: offer.productId }))
      await window.observa.analyticsSaveMatch(refs, chosenReviewEntries[0].productName)
      setSelectedReviewKeys([])
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось сохранить совпадение')
    } finally { setSavingMatch(false) }
  }

  const splitMatch = async (offers: (PriceOffer | MarketOffer)[]) => {
    setSavingMatch(true)
    try {
      await window.observa.analyticsSeparateMatch(offers.map(offer => ({ storeId: offer.storeId, productId: offer.productId })))
      setSelectedReviewKeys([])
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось разделить совпадение')
    } finally { setSavingMatch(false) }
  }

  useEffect(() => {
    let active = true
    if (!summary || view !== 'comparisons') return () => { active = false }
    if (!selectedRow) { setMarketHistory([]); return () => { active = false } }
    setHistoryLoading(true)
    Promise.all(selectedRow.offers.map(async offer => ({
      storeName: offer.storeName,
      role: offer.role,
      points: await window.observa.analyticsPriceDynamics(offer.storeId, offer.productId)
    }))).then(series => { if (active) setMarketHistory(series) })
      .catch(error => console.error('Не удалось загрузить историю цен:', error))
      .finally(() => { if (active) setHistoryLoading(false) })
    return () => { active = false }
  }, [selectedKey, summary, view])

  if (!summary) return <div className="page-loader"><Loader size={36} />Загрузка аналитики…</div>

  return (
    <div>
      <div className="page-header analytics-header">
        <div>
          <div className="page-title">Сравнение цен</div>
          <div className="page-subtitle">Сопоставленные услуги, тарифы и предложения магазинов · {filteredMatrix.length} из {summary.priceMatrix.length}</div>
        </div>
        <div className="analytics-actions">
          {summary.ownStoresCount === 0 && <button className="btn primary" onClick={onOpenCompetitors}><Icon name="plus" size={14} /> Добавить свой магазин</button>}
          {view !== 'review' && <button className="btn" onClick={() => exportFile('csv', exportRows)} disabled={exporting || !exportRows.length}><Icon name="external" size={14} /> Excel / CSV</button>}
          {view !== 'review' && <button className="btn" onClick={() => exportFile('pdf', exportRows)} disabled={exporting || !exportRows.length}><Icon name="external" size={14} /> PDF</button>}
          <button className="btn" onClick={refresh}><Icon name="refresh" size={14} /> Обновить</button>
        </div>
      </div>
      {message && <div className="export-message">{message}</div>}

      <div className="stats-grid analytics-stats">
        <div className="stat-card"><div className="stat-label">Источники цен</div><div className="stat-value">{summary.competitorStoresCount + summary.ownStoresCount}</div></div>
        <div className="stat-card"><div className="stat-label">Мои магазины</div><div className="stat-value">{summary.ownStoresCount}</div></div>
        <div className="stat-card"><div className="stat-label">Ценовых предложений</div><div className="stat-value">{offerCount}</div></div>
        <div className="stat-card"><div className="stat-label">Есть сравнение</div><div className="stat-value">{comparableCount}</div></div>
      </div>

      <div className="analytics-view-tabs filter-pills" role="tablist" aria-label="Представление цен">
        <button role="tab" aria-selected={view === 'comparisons'} className={view === 'comparisons' ? 'selected' : ''} onClick={() => setView('comparisons')}>Сравнения <span>{filteredMatrix.length}</span></button>
        <button role="tab" aria-selected={view === 'offers'} className={view === 'offers' ? 'selected' : ''} onClick={() => setView('offers')}>Все предложения <span>{filteredOffers.length}</span></button>
        <button role="tab" aria-selected={view === 'review'} className={view === 'review' ? 'selected' : ''} onClick={() => setView('review')}>Проверка совпадений <span>{reviewEntries.length}</span></button>
      </div>
      <div className="competitor-toolbar analytics-toolbar">
        <label className="search-box"><Icon name="search" size={16} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Услуга или магазин…" /></label>
        <div className="filter-pills" role="group" aria-label="Фильтр источника">
          <button className={storeType === 'all' ? 'selected' : ''} onClick={() => setStoreType('all')}>Все</button>
          <button className={storeType === 'own' ? 'selected' : ''} onClick={() => setStoreType('own')}>Мои магазины</button>
          <button className={storeType === 'competitor' ? 'selected' : ''} onClick={() => setStoreType('competitor')}>Конкуренты</button>
          <button className={storeType === 'telegram' ? 'selected' : ''} onClick={() => setStoreType('telegram')}>Telegram</button>
        </div>
        <div className="form-group analytics-currency"><label htmlFor="analytics-currency">Валюта</label><select id="analytics-currency" value={currency} onChange={e => setCurrency(e.target.value)}><option value="all">Все</option>{currencies.map(value => <option key={value} value={value}>{value}</option>)}</select></div>
        <Checkbox checked={comparisonOnly} onChange={setComparisonOnly} label="Только сравнимые" />
        {(search || storeType !== 'all' || currency !== 'all' || comparisonOnly) && <button className="btn small" onClick={() => { setSearch(''); setStoreType('all'); setCurrency('all'); setComparisonOnly(false) }}>Сбросить</button>}
      </div>
      {view === 'comparisons' && selectedRow && <>
        <div className="grid-2 market-charts">
          <section className="dashboard-panel">
            <div className="panel-heading"><div><h2>Цены по магазинам</h2><p>Самое дешёвое и самое дорогое предложение</p></div><select className="market-chart-select" aria-label="Выберите услугу для графика" value={selectedKey} onChange={event => setSelectedMatch(event.target.value)}>{filteredMatrix.map((row, index) => <option key={`${row.productName}-${row.currency}-${index}`} value={`${row.productName}|${row.currency}`}>{row.productName} · {row.currency}</option>)}</select></div>
            <PriceComparisonChart offers={selectedRow.offers} currency={selectedRow.currency} />
          </section>
          <section className="dashboard-panel">
            <div className="panel-heading"><div><h2>История цен</h2><p>{selectedRow.productName} · {selectedRow.currency}</p></div></div>
            {historyLoading ? <div className="chart-empty">Загружаю историю предложений…</div> : <MarketHistoryChart series={marketHistory} currency={selectedRow.currency} />}
          </section>
        </div>
      </>}
      {view === 'review' ? <>
        <section className="dashboard-panel match-review-toolbar">
          <div><b>Проверьте, какие позиции действительно сравнимы</b><p>Объединяйте предложения в одной валюте и из разных источников. Разделённые пары больше не будут автоматически сопоставляться.</p></div>
          <button className="btn primary" onClick={saveSelectedMatch} disabled={!mergeIsValid || savingMatch}>{savingMatch ? 'Сохраняю…' : `Объединить выбранные (${chosenReviewOffers.length})`}</button>
        </section>
        <div className="table-wrap price-matrix-wrap"><table className="match-review-table"><thead><tr><th></th><th>Услуга / тариф</th><th>Предложения</th><th>Уверенность</th><th>Решение</th></tr></thead><tbody>
          {reviewEntries.map(entry => <tr key={entry.key}>
            <td><Checkbox checked={selectedReviewKeys.includes(entry.key)} onChange={checked => setSelectedReviewKeys(current => checked ? [...current, entry.key] : current.filter(key => key !== entry.key))} label="Выбрать для объединения" /></td>
            <td><b>{entry.productName}</b>{entry.manual && <small className="matrix-source">Закреплено вручную</small>}</td>
            <td><div className="offer-list">{entry.offers.map(offer => <span key={`${offer.storeId}-${offer.productId}`}><b>{offer.storeName}</b> {offer.price == null ? 'Нет цены' : formatPrice(offer.price, offer.currency)}<small>{offer.productName}</small></span>)}</div></td>
            <td>{entry.manual ? 'Ручное' : entry.confidence ? `${Math.round(entry.confidence * 100)}%` : 'Не сопоставлено'}</td>
            <td>{entry.offers.length > 1 && <button className="btn small" onClick={() => splitMatch(entry.offers)} disabled={savingMatch}>Разделить</button>}</td>
          </tr>)}
          {!reviewEntries.length && <tr><td colSpan={5} className="table-empty">Нет предложений с ценой для проверки.</td></tr>}
        </tbody></table></div>
      </> : <>
      <div className="section-title"><Icon name={view === 'offers' ? 'store' : 'compare'} size={16} /> {view === 'offers' ? 'Все предложения рынка' : 'Сопоставленные цены'}</div>
      {view === 'comparisons' ? <div className="table-wrap price-matrix-wrap">
        <table className="price-matrix">
          <thead><tr><th>Услуга / тариф</th><th>Мой магазин</th><th>Цена</th><th>Лучший конкурент</th><th>Цена</th><th>Разница</th><th>Все предложения и источники</th></tr></thead>
          <tbody>
            {filteredMatrix.map((row: PriceMatrixRow, index) => {
              const own = row.ownOffers[0]
              const best = row.bestCompetitor
              const lowerAtOwn = row.difference != null && row.difference <= 0
              return (
                <tr key={`${row.productName}-${row.currency}-${index}`}>
                  <td><b>{row.productName}</b><small className="matrix-currency">{row.currency}</small>{row.matchedNames.length > 1 && <small className="matrix-matched-names">{row.matchConfidence < 0.8 ? 'Похожее совпадение: ' : 'Варианты названия: '}{row.matchedNames.join(' · ')}</small>}</td>
                  <td>{own?.storeName || '—'}</td>
                  <td className="matrix-price">{own ? formatPrice(own.price, own.currency) : '—'}</td>
                  <td>{best?.storeName || '—'}{best?.sourceType === 'telegram' && <small className="matrix-source">Telegram</small>}</td>
                  <td className="matrix-price">{best ? formatPrice(best.price, best.currency) : '—'}</td>
                  <td className={row.difference == null ? '' : lowerAtOwn ? 'price-down' : 'price-up'}>
                    {row.difference == null ? '—' : <>{formatPrice(row.difference, row.currency)}<small className="matrix-delta">{formatPercent(row.differencePercent)}</small></>}
                  </td>
                  <td><div className="offer-list">{visibleOffers(row).map(offer => <span key={`${offer.storeId}-${offer.productId}`}><b>{offer.storeName}</b> {formatPrice(offer.price, offer.currency)}<small>{offer.productName}{offer.sourceType === 'telegram' ? ' · Telegram' : ''}</small></span>)}</div></td>
                </tr>
              )
            })}
            {filteredMatrix.length === 0 && <tr><td colSpan={7} className="table-empty">{summary.priceMatrix.length ? 'Нет услуг по выбранным фильтрам.' : 'Пока нет цен. Добавьте сайт конкурента, Telegram-канал или свой магазин.'}</td></tr>}
          </tbody>
        </table>
      </div> : <div className="table-wrap price-matrix-wrap"><table className="market-offers-table"><thead><tr><th>Товар или услуга</th><th>Источник</th><th>Роль</th><th>Цена</th><th>Обновлено</th></tr></thead><tbody>
        {filteredOffers.map((offer, index) => <tr key={`${offer.storeId}-${offer.productId}-${index}`}>
          <td><div className="market-product-cell">{offer.imageUrl ? <img src={offer.imageUrl} alt="" onError={event => { event.currentTarget.style.display = 'none' }} /> : <span className="market-product-placeholder"><Icon name="tag" size={14} /></span>}<span><b>{offer.productName}</b><small>{offer.category}</small></span></div></td>
          <td><b>{offer.storeName}</b><small className="matrix-source">{offer.sourceType === 'telegram' ? 'Telegram' : sourceHost(offer.url)}</small></td>
          <td>{offer.role === 'own' ? 'Мой магазин' : 'Конкурент'}</td>
          <td className="matrix-price">{offer.price == null ? 'Нет цены' : formatPrice(offer.price, offer.currency)}</td>
          <td>{offerIsStale(offer, now) && <small className="stale-price-badge">Устарела</small>}{offer.lastChecked ? new Date(offer.lastChecked).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Нет успешных данных'}</td>
        </tr>)}
        {!filteredOffers.length && <tr><td colSpan={5} className="table-empty">Предложений по этим фильтрам нет.</td></tr>}
      </tbody></table></div>}
      </>}

      {view !== 'review' && <div className="grid-2 analytics-trends">
        <div>
          <div className="section-title"><Icon name="trendingUp" size={16} /> Топ подорожания</div>
          <div className="table-wrap"><table><thead><tr><th>Товар</th><th>Источник</th><th>Было → стало</th><th>Δ</th></tr></thead><tbody>
            {topGainers.map((item, index) => <tr key={`${item.productId}-${index}`}><td>{item.productName}</td><td>{item.storeName}</td><td>{formatPrice(item.firstPrice, item.currency)} → {formatPrice(item.lastPrice, item.currency)}</td><td className="price-up">{formatPercent(item.changePercent)}</td></tr>)}
            {!topGainers.length && <tr><td colSpan={4} className="table-empty">Нет истории изменения цен</td></tr>}
          </tbody></table></div>
        </div>
        <div>
          <div className="section-title"><Icon name="trendingDown" size={16} /> Топ снижения</div>
          <div className="table-wrap"><table><thead><tr><th>Товар</th><th>Источник</th><th>Было → стало</th><th>Δ</th></tr></thead><tbody>
            {topLosers.map((item, index) => <tr key={`${item.productId}-${index}`}><td>{item.productName}</td><td>{item.storeName}</td><td>{formatPrice(item.firstPrice, item.currency)} → {formatPrice(item.lastPrice, item.currency)}</td><td className="price-down">{formatPercent(item.changePercent)}</td></tr>)}
            {!topLosers.length && <tr><td colSpan={4} className="table-empty">Нет истории изменения цен</td></tr>}
          </tbody></table></div>
        </div>
      </div>}
    </div>
  )
}
