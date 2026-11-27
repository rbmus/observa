import type { PriceOffer } from '../types'
import { formatPrice, formatPercent } from '../utils/format'

export default function PriceComparisonChart({ offers, currency }: { offers: PriceOffer[]; currency: string }) {
  if (!offers.length) return <div className="chart-empty">Пока нет сравнимых цен.</div>
  const sorted = offers.slice().sort((a, b) => a.price - b.price)
  const min = sorted[0]?.price ?? 0
  const max = Math.max(...sorted.map(offer => offer.price), 1)
  return (
    <div className="comparison-chart" role="img" aria-label="Сравнение цен магазинов">
      {sorted.map((offer, index) => {
        const isBest = index === 0
        const diff = min > 0 ? ((offer.price - min) / min) * 100 : 0
        return (
          <div className="comparison-bar-row" key={`${offer.storeId}-${offer.productId}-${index}`}>
            <div className="comparison-bar-label"><span>{offer.storeName}</span>{offer.role === 'own' && <small>Ваш магазин</small>}</div>
            <div className="comparison-bar-track"><span className={`comparison-bar-fill ${offer.role === 'own' ? 'own' : ''} ${isBest ? 'best' : ''}`} style={{ width: `${Math.max(4, offer.price / max * 100)}%` }} /></div>
            <div className="comparison-bar-value">
              <b className="comparison-bar-price">{formatPrice(offer.price, currency)}</b>
              <small className={`comparison-bar-diff ${isBest ? 'best' : offer.role === 'own' ? 'own' : ''}`}>{isBest ? 'лучшая цена' : `+${formatPercent(diff).replace('+', '')}`}</small>
            </div>
          </div>
        )
      })}
    </div>
  )
}
