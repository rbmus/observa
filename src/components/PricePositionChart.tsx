import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { formatPercent, formatPrice } from '../utils/format'
import { smoothLinePath } from '../utils/chartPath'

export interface PositionOffer {
  storeId: string
  storeName: string
  role: 'own' | 'competitor'
  /** Отклонение средней цены магазина от средней по рынку, % */
  price: number
  label?: string
  hint?: string
  /** URL фавиконки источника (data URL или http) */
  iconUrl?: string | null
  /** Средняя цена магазина в его валюте */
  avgPrice?: number
  currency?: string
  /** Количество услуг с ценой */
  count?: number
}

interface Props {
  offers: PositionOffer[]
  width?: number
  height?: number
}

const ACCENT = '#2684FF'
const UP = '#f87171'
const DOWN = '#34d399'
const FLAT = '#5b5b66'
const CHART_LEFT = 64
const CHART_RIGHT = 18
const CHART_TOP = 14
const CHART_BOTTOM = 34

interface Pt { x: number; y: number; value: number; name: string; color: string; hint?: string; iconUrl?: string | null; avgPrice?: number; currency?: string; count?: number }

function toneColor(offer: PositionOffer, value: number) {
  if (offer.role === 'own') return ACCENT
  if (value > 0.05) return UP
  if (value < -0.05) return DOWN
  return FLAT
}

export default function PricePositionChart({ offers, width = 760, height = 240 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [failedIcons, setFailedIcons] = useState<ReadonlySet<number>>(new Set())
  const failIcon = (index: number) => setFailedIcons(prev => prev.has(index) ? prev : new Set(prev).add(index))
  const [measuredWidth, setMeasuredWidth] = useState(0)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => setMeasuredWidth(el.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const chartWidth = measuredWidth > 0 ? measuredWidth : width

  const chart = useMemo(() => {
    const valid = offers.filter(offer => Number.isFinite(offer.price))
    if (valid.length < 2) return null
    const sorted = valid.slice().sort((a, b) => a.price - b.price)

    const left = CHART_LEFT, right = CHART_RIGHT, top = CHART_TOP, bottom = CHART_BOTTOM
    const plotWidth = chartWidth - left - right
    const plotHeight = height - top - bottom

    const min = Math.min(...sorted.map(o => o.price))
    const max = Math.max(...sorted.map(o => o.price))
    const pad = (max - min) * 0.18 || 2
    const low = Math.min(0, min - pad)
    const high = Math.max(0, max + pad)
    const yOf = (value: number) => top + (1 - (value - low) / (high - low)) * plotHeight

    const count = sorted.length
    const pts: Pt[] = sorted.map((offer, index) => ({
      x: left + (count === 1 ? 0.5 : index / (count - 1)) * plotWidth,
      y: yOf(offer.price),
      value: offer.price,
      name: offer.storeName,
      color: toneColor(offer, offer.price),
      hint: offer.hint,
      iconUrl: offer.iconUrl || null,
      avgPrice: offer.avgPrice,
      currency: offer.currency,
      count: offer.count
    }))

    const yTicks = Array.from({ length: 5 }, (_, i) => {
      const value = high - (high - low) * i / 4
      return { value, y: top + plotHeight * i / 4 }
    })
    const xLabels = pts.map(p => ({
      x: p.x,
      label: p.name.length > 14 ? `${p.name.slice(0, 13)}…` : p.name
    }))

    return {
      pts,
      d: smoothLinePath(pts.map(p => ({ x: p.x, y: p.y }))),
      yTicks,
      xLabels,
      low,
      high
    }
  }, [offers, chartWidth, height])

  if (!chart) {
    return <div className="chart-empty">Недостаточно данных для сравнения.</div>
  }

  const manyX = chart.xLabels.length > 4
  const hover = hoverIndex != null ? chart.pts[hoverIndex] : null

  const onSvgMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const scale = Math.min(rect.width / chartWidth, rect.height / height)
    const offsetX = (rect.width - chartWidth * scale) / 2
    const offsetY = (rect.height - height * scale) / 2
    const vx = (event.clientX - rect.left - offsetX) / scale
    const vy = (event.clientY - rect.top - offsetY) / scale
    if (vx < CHART_LEFT || vx > chartWidth - CHART_RIGHT || vy < CHART_TOP || vy > height - CHART_BOTTOM) {
      setHoverIndex(null)
      return
    }
    let best = 0
    let bestDist = Infinity
    chart.pts.forEach((p, i) => {
      const dist = Math.abs(p.x - vx)
      if (dist < bestDist) { bestDist = dist; best = i }
    })
    setHoverIndex(best)
  }

  const wrapRect = wrapRef.current?.getBoundingClientRect()
  const tipLeft = wrapRect && hover
    ? Math.min((hover.x / chartWidth) * wrapRect.width + 14, Math.max(0, wrapRect.width - 190))
    : 0
  const tipTop = wrapRect && hover
    ? Math.min(Math.max((hover.y / height) * wrapRect.height - 12, 4), Math.max(4, wrapRect.height - 40))
    : 0

  return (
    <div className="price-compare-chart" data-tip-bounds ref={wrapRef}>
      <div className="price-compare-legend">
        {chart.pts.map((p, i) => (
          <div className="price-compare-legend-item" key={`${p.name}-${i}`}>
            {p.iconUrl && !failedIcons.has(i)
              ? <img className="price-compare-favicon" src={p.iconUrl} alt="" onError={() => failIcon(i)} />
              : <span className="price-compare-dot" style={{ background: p.color }} />}
            <span className="price-compare-name" data-tooltip={p.hint || p.name}>{p.name}</span>
            <b>{formatPercent(p.value)}</b>
          </div>
        ))}
      </div>
      <svg width={chartWidth} height={height} viewBox={`0 0 ${chartWidth} ${height}`} role="img" aria-label="Позиция магазинов относительно среднего по рынку" onMouseMove={onSvgMove} onMouseLeave={() => setHoverIndex(null)}>
        {chart.yTicks.map((tick, index) => (
          <g key={`y-${index}`}>
            <line x1={CHART_LEFT} x2={chartWidth - CHART_RIGHT} y1={tick.y} y2={tick.y} className="chart-gridline" />
            <text x={CHART_LEFT - 9} y={tick.y + 4} textAnchor="end" className="chart-axis-label">{tick.value > 0 ? '+' : ''}{Math.round(tick.value)}%</text>
          </g>
        ))}
        {chart.xLabels.map((tick, index) => (
          <text
            key={`x-${index}`}
            x={tick.x}
            y={height - 9}
            textAnchor={manyX ? 'end' : index === 0 ? 'start' : index === chart.xLabels.length - 1 ? 'end' : 'middle'}
            className="chart-axis-label"
            transform={manyX ? `rotate(-35 ${tick.x} ${height - 9})` : undefined}
          >
            {tick.label}
          </text>
        ))}
        <path d={chart.d} fill="none" stroke={ACCENT} strokeWidth="6" strokeLinecap="round" opacity="0.12" />
        <path d={chart.d} fill="none" stroke={ACCENT} strokeWidth="2.2" strokeLinecap="round" />
        {chart.pts.map((p, i) => (
          <g key={`d-${i}`}>
            <circle cx={p.x} cy={p.y} r="14" fill="transparent" />
            {p.iconUrl && !failedIcons.has(i) ? (
              <>
                <clipPath id={`pos-clip-${i}`}><circle cx={p.x} cy={p.y} r="10" /></clipPath>
                <image href={p.iconUrl} x={p.x - 10} y={p.y - 10} width="20" height="20" clipPath={`url(#pos-clip-${i})`} onError={() => failIcon(i)} />
                <circle cx={p.x} cy={p.y} r="10.5" fill="none" stroke="var(--bg-card)" strokeWidth="2" />
              </>
            ) : (
              <circle cx={p.x} cy={p.y} r="5" fill={p.color} stroke="var(--bg-card)" strokeWidth="2" />
            )}
          </g>
        ))}
        {hover && (
          <g className="chart-crosshair">
            <line x1={hover.x} x2={hover.x} y1={CHART_TOP} y2={height - CHART_BOTTOM} />
            <circle cx={hover.x} cy={hover.y} r="4.5" fill={hover.color} stroke="var(--bg-card)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hover && (
        <div className="chart-hover-tip" style={{ left: tipLeft, top: tipTop }}>
          <div className="chart-hover-tip-row">
            {hover.iconUrl && !failedIcons.has(hoverIndex ?? -1)
              ? <img className="price-compare-favicon" src={hover.iconUrl} alt="" />
              : <span className="price-compare-dot" style={{ background: hover.color }} />}
            <span className="chart-hover-tip-name">{hover.name}</span>
            <b>{formatPercent(hover.value)}</b>
          </div>
          {(hover.avgPrice != null || hover.count != null) && (
            <div className="chart-hover-tip-row chart-hover-tip-sub">
              <span className="chart-hover-tip-name">
                {hover.avgPrice != null ? `средняя ${formatPrice(hover.avgPrice, hover.currency || 'RUB')}` : ''}
                {hover.avgPrice != null && hover.count != null ? ' · ' : ''}
                {hover.count != null ? `${hover.count} услуг` : ''}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
