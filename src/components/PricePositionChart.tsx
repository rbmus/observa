import { formatPercent } from '../utils/format'

export interface PositionOffer {
  storeId: string
  storeName: string
  role: 'own' | 'competitor'
  /** Отклонение средней цены магазина от средней по рынку, % */
  price: number
  label?: string
  hint?: string
}

interface Props {
  offers: PositionOffer[]
}

export default function PricePositionChart({ offers }: Props) {
  const valid = offers.filter(offer => Number.isFinite(offer.price))
  if (!valid.length) return <div className="chart-empty">Нет данных для сравнения.</div>

  const sorted = valid.slice().sort((a, b) => a.price - b.price)
  const maxAbs = Math.max(...sorted.map(offer => Math.abs(offer.price)), 1)

  const W = 560, H = 196, padL = 40, padR = 14, padT = 24, padB = 38
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const centerY = padT + plotH / 2
  const halfH = plotH / 2 - 10
  const slot = plotW / sorted.length
  const barW = Math.min(22, slot * 0.34)
  const barH = (value: number) => Math.max(3, (Math.abs(value) / maxAbs) * halfH)
  const gridValues = [-1, -0.5, 0, 0.5, 1].map(ratio => ({ ratio, value: maxAbs * ratio }))
  const namesY = H - 12

  const label = (name: string) => (name.length > 16 ? `${name.slice(0, 15)}…` : name)

  return (
    <div className="ovc">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Отклонение средней цены магазинов от рынка">
        {gridValues.map(({ ratio, value }) => (
          <g key={ratio}>
            <line x1={padL} x2={W - padR} y1={centerY + value / maxAbs * halfH} y2={centerY + value / maxAbs * halfH} className={ratio === 0 ? 'ovc-grid zero' : 'ovc-grid'} />
            <text x={padL - 8} y={centerY + value / maxAbs * halfH + 3} textAnchor="end" className="ovc-axis">{value > 0 ? '+' : ''}{value.toFixed(0)}%</text>
          </g>
        ))}
        {sorted.map((offer, index) => {
          const isOwn = offer.role === 'own'
          const isCheapest = index === 0
          const value = offer.price
          const cx = padL + slot * index + slot / 2
          const h = barH(value)
          const top = value >= 0 ? centerY - h : centerY
          const tone = isOwn ? 'own' : value > 0.05 ? 'up' : value < -0.05 ? 'down' : 'flat'
          const fill = isOwn ? 'var(--accent)' : tone === 'up' ? 'var(--red)' : tone === 'down' ? 'var(--green)' : 'var(--competitor)'
          const valueLabel = offer.label ?? formatPercent(value)
          const valueY = value >= 0 ? top - 7 : top + h + 13
          return (
            <g key={`${offer.storeId}-${index}`}>
              <rect x={cx - barW / 2} y={top} width={barW} height={h} rx={3} fill={fill} className={`ovc-bar ${tone}${isCheapest && !isOwn ? ' cheapest' : ''}`} data-tooltip={offer.hint || `${offer.storeName} · ${formatPercent(value)}`}>
              </rect>
              <text x={cx} y={valueY} textAnchor="middle" className={`ovc-value ${tone}`}>{valueLabel}</text>
              <text x={cx} y={namesY} textAnchor="middle" className="ovc-name">{label(offer.storeName)}</text>
            </g>
          )
        })}
      </svg>
      <div className="ovc-legend">
        <span><i className="ovc-key own" />Ваше предложение</span>
        <span><i className="ovc-key up" />Дороже среднего</span>
        <span><i className="ovc-key down" />Дешевле среднего</span>
      </div>
    </div>
  )
}
