import type { PriceOffer } from '../types'
import { formatPrice } from '../utils/format'

export default function PriceComparisonChart({ offers, currency }: { offers: PriceOffer[]; currency: string }) {
  if (!offers.length) return <div className="chart-empty">Пока нет сравнимых цен.</div>
  const max = Math.max(...offers.map(offer => offer.price), 1)
  return (
    <div className="comparison-chart" role="img" aria-label="Сравнение цен магазинов">
      {offers.slice().sort((a, b) => a.price - b.price).map((offer, index) => (
        <div className="comparison-bar-row" key={`${offer.storeId}-${offer.productId}-${index}`}>
          <div className="comparison-bar-label"><span>{offer.storeName}</span>{offer.role === 'own' && <small>Ваш магазин</small>}</div>
          <div className="comparison-bar-track"><span className={`comparison-bar-fill ${offer.role === 'own' ? 'own' : ''}`} style={{ width: `${Math.max(3, offer.price / max * 100)}%` }} /></div>
          <b className="comparison-bar-price">{formatPrice(offer.price, currency)}</b>
        </div>
      ))}
    </div>
  )
}
