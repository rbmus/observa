import { useEffect, useMemo, useState } from 'react'
import type { AnalyticsSummary, MarketOffer, PriceOffer } from '../types'
import { formatPrice, formatPercent, timeAgo } from '../utils/format'
import { useFaviconSrc } from '../utils/favicon'

interface Props {
  summary: AnalyticsSummary | null
  onOpen: (storeId: string, productId: string) => void
}

interface WatchItem {
  key: string
  storeId: string
  productId: string
  imageUrl: string | null
  url: string
  label: string
  title: string
  priceLine: string
  stats: string
  tone: 'up' | 'down' | ''
}

export default function WatchCarousel({ summary, onOpen }: Props) {
  const items = useMemo<WatchItem[]>(() => {
    if (!summary) return []
    const matrix = summary.priceMatrix || []
    const matchedRows = matrix.filter(row => row.ownOffers.length > 0)
      .sort((left, right) => Math.abs(right.differencePercent || 0) - Math.abs(left.differencePercent || 0))
    const displayRows = matchedRows.length ? matchedRows : matrix
    const comparedOfferIds = new Set(matrix.flatMap(row => row.offers.map(offer => `${offer.storeId}|${offer.productId}`)))
    const watchedOffers = (summary.allOffers || []).filter(offer => offer.price !== null && !comparedOfferIds.has(`${offer.storeId}|${offer.productId}`))
      .sort((left, right) => String(right.lastChecked || '').localeCompare(String(left.lastChecked || '')))

    const list: WatchItem[] = []
    for (const row of displayRows) {
      const own = row.ownOffers[0]
      const best = row.bestCompetitor
      const prices = row.offers.map(offer => offer.price)
      const primaryOffer = own || row.offers.slice().sort((left, right) => left.price - right.price)[0]
      if (!primaryOffer) continue
      const ownItem = summary.allOffers.find(offer => offer.storeId === primaryOffer.storeId && offer.productId === primaryOffer.productId)
      const thumbnail = ownItem || summary.allOffers.find(offer => row.offers.some(item => item.storeId === offer.storeId && item.productId === offer.productId))
      const recentChange = summary.recentPriceChanges.find(change => change.storeId === primaryOffer.storeId && change.productId === primaryOffer.productId)
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
      list.push({
        key: `row|${row.productName}|${row.currency}`,
        storeId: primaryOffer.storeId,
        productId: primaryOffer.productId,
        imageUrl: thumbnail?.imageUrl ?? null,
        url: primaryOffer.url,
        label: row.productName,
        title: row.productName,
        priceLine: `${own ? formatPrice(own.price, own.currency) : `от ${formatPrice(primaryOffer.price, primaryOffer.currency)}`}${best ? ` · конкурент ${formatPrice(best.price, best.currency)}` : own ? ' · ждёт цены конкурентов' : ` · ${row.offers.length} источника`}`,
        stats,
        tone: recentChange || row.differencePercent != null ? deltaTone : ''
      })
    }
    for (const offer of watchedOffers) {
      const imageUrl = 'imageUrl' in offer ? offer.imageUrl : null
      const change = summary.recentPriceChanges.find(item => item.storeId === offer.storeId && item.productId === offer.productId)
      list.push({
        key: `offer|${offer.storeId}|${offer.productId}`,
        storeId: offer.storeId,
        productId: offer.productId,
        imageUrl: imageUrl ?? null,
        url: offer.url,
        label: offer.productName,
        title: offer.productName,
        priceLine: `${formatPrice(offer.price, offer.currency)} · ${offer.storeName}`,
        stats: change ? `${formatPercent(change.changePercent)} · ${timeAgo(change.lastChangedAt)}` : offer.stale ? 'Данные могут устареть' : 'Цена отслеживается',
        tone: change ? (change.changePercent > 0 ? 'up' : 'down') : ''
      })
    }
    return list
  }, [summary])

  if (!items.length) return null

  const duration = `${Math.max(24, items.length * 4)}s`
  const renderCard = (item: WatchItem) => (
    <button className="wc-card" key={item.key} onClick={() => onOpen(item.storeId, item.productId)} data-tooltip="Открыть похожие предложения" data-tip="bottom">
      <WatchThumb imageUrl={item.imageUrl} url={item.url} label={item.label} />
      <span className="sidebar-watch-copy">
        <b data-tooltip={item.title}>{item.title}</b>
        <span>{item.priceLine}</span>
        <small className={item.tone ? `watch-change ${item.tone}` : ''}>{item.stats}</small>
      </span>
    </button>
  )

  return (
    <section className="dashboard-panel watch-carousel">
      <div className="panel-heading">
        <div><span className="market-eyebrow">МОНИТОРИНГ ЦЕН</span><h2>Лента предложений</h2><p></p></div>
      </div>
      <div className="wc-viewport">
        <div className="wc-track" style={{ animationDuration: duration }}>
          <div className="wc-group">{items.map(renderCard)}</div>
          <div className="wc-group" aria-hidden="true">{items.map(item => renderCard({ ...item, key: `${item.key}-dup` }))}</div>
        </div>
      </div>
    </section>
  )
}

function WatchThumb({ imageUrl, url, label }: { imageUrl: string | null; url: string; label: string }) {
  const [imageFailed, setImageFailed] = useState(false)
  const { src: favicon, onError: onFaviconError } = useFaviconSrc(!imageUrl || imageFailed ? url : null)
  useEffect(() => setImageFailed(false), [imageUrl, url])
  const src = imageUrl && !imageFailed ? imageUrl : favicon
  if (!src) return <span className="sidebar-watch-thumb fallback" aria-hidden="true">{label.slice(0, 1).toLocaleUpperCase('ru')}</span>
  return <img
    className="sidebar-watch-thumb"
    src={src}
    alt=""
    onError={() => (imageUrl && !imageFailed ? setImageFailed(true) : onFaviconError())}
  />
}
