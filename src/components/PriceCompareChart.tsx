import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { MarketOffer, PricePoint } from '../types'
import { formatPrice } from '../utils/format'
import { smoothLinePath } from '../utils/chartPath'

interface Props {
  offers: MarketOffer[]
  width?: number
  height?: number
}

const PALETTE = ['#38bdf8', '#f472b6', '#fbbf24', '#34d399', '#a78bfa', '#fb923c', '#f87171', '#22d3ee', '#e879f9', '#a3e635']
const CHART_LEFT = 64
const CHART_RIGHT = 18
const CHART_TOP = 14
const CHART_BOTTOM = 34

interface Pt { x: number; y: number; price: number; currency: string; label: string; time?: number }
interface Line { color: string; label: string; points: Pt[] }
interface LegendItem { key: string; label: string; color: string; price: number | null; currency: string }
interface Rendered {
  paths: { key: string; color: string; d: string }[]
  dots: { x: number; y: number; color: string; title: string }[]
  lines: Line[]
  legend: LegendItem[]
  yTicks: { value: number; y: number }[]
  xLabels: { x: number; label: string }[]
  xIsTime: boolean
  low: number
  high: number
}

interface HoverValue { color: string; label: string; text: string; y: number }
interface Hover { vx: number; values: HoverValue[]; px: number; py: number }

function historyPoints(history: PricePoint[] | undefined) {
  return (history || [])
    .map(point => ({ time: new Date(point.timestamp).getTime(), price: Number(point.price), currency: point.currency }))
    .filter(point => Number.isFinite(point.time) && Number.isFinite(point.price) && point.price > 0)
    .sort((a, b) => a.time - b.time)
}

function interpolate(points: Pt[], x: number) {
  if (!points.length) return null
  if (x <= points[0].x) return points[0]
  const last = points[points.length - 1]
  if (x >= last.x) return last
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    if (x >= a.x && x <= b.x) {
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x)
      return {
        price: a.price + (b.price - a.price) * t,
        y: a.y + (b.y - a.y) * t,
        currency: b.currency || a.currency,
        label: t < 0.5 ? a.label : b.label
      }
    }
  }
  return last
}

export default function PriceCompareChart({ offers, width = 760, height = 250 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const pathRefs = useRef<(SVGPathElement | null)[]>([])
  const [hover, setHover] = useState<Hover | null>(null)
  const chart = useMemo<Rendered | null>(() => {
    const left = CHART_LEFT, right = CHART_RIGHT, top = CHART_TOP, bottom = CHART_BOTTOM
    const plotWidth = width - left - right
    const plotHeight = height - top - bottom

    const scaleFor = (prices: number[]) => {
      const min = Math.min(...prices)
      const max = Math.max(...prices)
      const padding = (max - min) * 0.14 || Math.max(max * 0.05, 1)
      return { low: Math.max(0, min - padding), high: max + padding }
    }
    const yTicksFor = (low: number, high: number) =>
      Array.from({ length: 5 }, (_, i) => ({ value: high - (high - low) * i / 4, y: top + plotHeight * i / 4 }))

    // Режим 1: динамика — плавные кривые по времени для каждого магазина.
    const historyOffers = offers
      .map((offer, index) => ({ offer, index, points: historyPoints(offer.history) }))
      .filter(item => item.points.length >= 2)
      .slice(0, PALETTE.length)

    if (historyOffers.length >= 2) {
      const minTime = Math.min(...historyOffers.flatMap(item => item.points.map(p => p.time)))
      const maxTime = Math.max(...historyOffers.flatMap(item => item.points.map(p => p.time)))
      const { low, high } = scaleFor(historyOffers.flatMap(item => item.points.map(p => p.price)))
      const span = maxTime - minTime
      const yOf = (price: number) => top + (1 - (price - low) / (high - low)) * plotHeight

      const paths = historyOffers.map(({ offer, index, points }) => {
        const xy: Pt[] = points.map(p => ({
          x: left + (span ? (p.time - minTime) / span : 0.5) * plotWidth,
          y: yOf(p.price), price: p.price, currency: p.currency, label: offer.storeName, time: p.time
        }))
        return { key: `${offer.storeId}|${offer.productId}`, color: PALETTE[index % PALETTE.length], d: smoothLinePath(xy), pts: xy }
      })

      const xCount = Math.min(5, Math.max(...historyOffers.map(item => item.points.length)))
      const xLabels = Array.from({ length: xCount }, (_, i) => {
        const time = minTime + (maxTime - minTime) * (xCount === 1 ? 0 : i / (xCount - 1))
        return { x: left + (xCount === 1 ? 0 : i / (xCount - 1)) * plotWidth, label: new Date(time).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) }
      })

      return {
        paths: paths.map(({ key, color, d }) => ({ key, color, d })),
        lines: paths.map((item, i) => ({ color: item.color, label: historyOffers[i].offer.storeName, points: item.pts })),
        dots: paths.flatMap(({ color, pts }) => pts.map(p => ({
          x: p.x, y: p.y, color,
          title: `${p.label} · ${formatPrice(p.price, p.currency)}`
        }))),
        legend: historyOffers.map(({ offer, index, points }) => ({
          key: `${offer.storeId}|${offer.productId}`,
          label: offer.storeName,
          color: PALETTE[index % PALETTE.length],
          price: offer.price,
          currency: offer.currency || points[points.length - 1].currency || 'RUB'
        })),
        yTicks: yTicksFor(low, high),
        xLabels,
        xIsTime: true,
        low,
        high
      }
    }

    // Режим 2: снапшот — одна кривая текущих цен, магазины по возрастанию цены.
    const priced = offers
      .filter(offer => offer.price != null && Number(offer.price) > 0)
      .map((offer, index) => ({ offer, index }))
      .sort((a, b) => Number(a.offer.price) - Number(b.offer.price))
      .slice(0, PALETTE.length)
    if (priced.length < 2) return null

    const { low, high } = scaleFor(priced.map(item => Number(item.offer.price)))
    const yOf = (price: number) => top + (1 - (price - low) / (high - low)) * plotHeight
    const count = priced.length

    const pts = priced.map(({ offer, index }) => ({
      x: left + (index / (count - 1)) * plotWidth,
      y: yOf(Number(offer.price)),
      price: Number(offer.price),
      currency: offer.currency || 'RUB',
      label: offer.storeName,
      color: PALETTE[index % PALETTE.length]
    }))

    return {
      paths: [{ key: 'snapshot', color: PALETTE[0], d: smoothLinePath(pts.map(p => ({ x: p.x, y: p.y }))) }],
      lines: [{ color: PALETTE[0], label: '', points: pts.map(p => ({ x: p.x, y: p.y, price: p.price, currency: p.currency, label: p.label })) }],
      dots: pts.map(p => ({ x: p.x, y: p.y, color: p.color, title: `${p.label} · ${formatPrice(p.price, p.currency)}` })),
      legend: pts.map((p, i) => ({
        key: `snap-${i}`,
        label: p.label,
        color: p.color,
        price: p.price,
        currency: p.currency
      })),
      yTicks: yTicksFor(low, high),
      xLabels: pts.map((p, i) => ({
        x: p.x,
        label: p.label.length > 14 ? `${p.label.slice(0, 13)}…` : p.label
      })),
      xIsTime: false,
      low,
      high
    }
  }, [offers, width, height])

  if (!chart) {
    return <div className="chart-empty">Недостаточно данных для сравнения цен.</div>
  }

  const manyX = chart.xLabels.length > 4

  const onSvgMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    // svg использует preserveAspectRatio="meet": контент масштабируется
    // равномерно и центрируется — учитываем scale и смещение.
    const scale = Math.min(rect.width / width, rect.height / height)
    const offsetX = (rect.width - width * scale) / 2
    const offsetY = (rect.height - height * scale) / 2
    const vx = (event.clientX - rect.left - offsetX) / scale
    const vy = (event.clientY - rect.top - offsetY) / scale
    if (vx < CHART_LEFT || vx > width - CHART_RIGHT || vy < CHART_TOP || vy > height - CHART_BOTTOM) {
      setHover(null)
      return
    }
    const plotHeight = height - CHART_TOP - CHART_BOTTOM
    const values = chart.lines
      .map((line, index) => {
        const path = pathRefs.current[index]
        const linear = interpolate(line.points, vx)
        if (!linear) return null
        let y = linear.y
        let price = linear.price
        if (path) {
          const total = path.getTotalLength()
          let lo = 0
          let hi = total
          for (let i = 0; i < 22; i++) {
            const mid = (lo + hi) / 2
            if (path.getPointAtLength(mid).x < vx) lo = mid
            else hi = mid
          }
          const point = path.getPointAtLength((lo + hi) / 2)
          y = point.y
          price = chart.high - ((y - CHART_TOP) / plotHeight) * (chart.high - chart.low)
        }
        return {
          color: line.color,
          label: line.label || linear.label,
          text: formatPrice(price, linear.currency),
          y
        }
      })
      .filter((item): item is HoverValue => item !== null)
    const wrap = wrapRef.current?.getBoundingClientRect()
    const wrapW = wrap?.width ?? 0
    const wrapH = wrap?.height ?? 0
    const px = wrap ? Math.min(event.clientX - wrap.left + 14, Math.max(0, wrapW - 190)) : event.clientX
    const py = wrap ? Math.min(Math.max(event.clientY - wrap.top - 12, 4), Math.max(4, wrapH - values.length * 20 - 16)) : event.clientY
    setHover({ vx, values, px, py })
  }

  return (
    <div className="price-compare-chart" data-tip-bounds ref={wrapRef}>
      <div className="price-compare-legend">
        {chart.legend.map(item => (
          <div className="price-compare-legend-item" key={item.key}>
            <span className="price-compare-dot" style={{ background: item.color }} />
            <span className="price-compare-name" data-tooltip={item.label}>{item.label}</span>
            <b>{item.price != null ? formatPrice(item.price, item.currency) : '—'}</b>
          </div>
        ))}
      </div>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Сравнение цен по магазинам" onMouseMove={onSvgMove} onMouseLeave={() => setHover(null)}>
        {chart.yTicks.map((tick, index) => (
          <g key={`y-${index}`}>
            <line x1={CHART_LEFT} x2={width - CHART_RIGHT} y1={tick.y} y2={tick.y} className="chart-gridline" />
            <text x={CHART_LEFT - 9} y={tick.y + 4} textAnchor="end" className="chart-axis-label">{Math.round(tick.value).toLocaleString('ru-RU')}</text>
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
        {chart.paths.map((item, index) => (
          <g key={item.key}>
            <path ref={el => { pathRefs.current[index] = el }} d={item.d} fill="none" stroke={item.color} strokeWidth="6" strokeLinecap="round" opacity="0.12" />
            <path d={item.d} fill="none" stroke={item.color} strokeWidth="2.2" strokeLinecap="round" />
          </g>
        ))}
        {chart.dots.map((dot, index) => (
          <g key={`d-${index}`}>
            <circle cx={dot.x} cy={dot.y} r="11" fill="transparent" />
            <circle cx={dot.x} cy={dot.y} r="4" fill={dot.color} stroke="var(--bg-card)" strokeWidth="2" />
          </g>
        ))}
        {hover && (
          <g className="chart-crosshair">
            <line x1={hover.vx} x2={hover.vx} y1={CHART_TOP} y2={height - CHART_BOTTOM} />
            {hover.values.map((value, index) => (
              <circle key={`h-${index}`} cx={hover.vx} cy={value.y} r="4.5" fill={value.color} stroke="var(--bg-card)" strokeWidth="2" />
            ))}
          </g>
        )}
      </svg>
      {hover && hover.values.length > 0 && (
        <div className="chart-hover-tip" style={{ left: hover.px, top: hover.py }}>
          {hover.values.map((value, index) => (
            <div className="chart-hover-tip-row" key={index}>
              <span className="price-compare-dot" style={{ background: value.color }} />
              <span className="chart-hover-tip-name">{value.label}</span>
              <b>{value.text}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
