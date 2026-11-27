import { useMemo } from 'react'
import type { PricePoint } from '../types'
import { formatPrice } from '../utils/format'
import { smoothAreaPath, smoothLinePath } from '../utils/chartPath'

export interface MarketHistorySeries {
  storeName: string
  role: 'own' | 'competitor'
  points: PricePoint[]
}

const COLORS = ['#2684FF', '#34d399', '#f87171', '#a78bfa', '#fbbf24', '#60a5fa', '#fb7185']

export default function MarketHistoryChart({ series, currency }: { series: MarketHistorySeries[]; currency: string }) {
  const chart = useMemo(() => {
    const prepared = series.map((item, index) => ({
      ...item,
      color: item.role === 'own' ? '#2684FF' : COLORS[(index + 1) % COLORS.length],
      points: item.points.filter(point => Number.isFinite(Number(point.price)) && Number(point.price) > 0)
        .map(point => ({ ...point, time: new Date(point.timestamp).getTime() }))
        .filter(point => Number.isFinite(point.time)).sort((a, b) => a.time - b.time)
    })).filter(item => item.points.length >= 2)
    const points = prepared.flatMap(item => item.points)
    if (!points.length) return null
    const width = 760, height = 250, left = 66, right = 18, top = 16, bottom = 34
    const minTime = Math.min(...points.map(point => point.time)), maxTime = Math.max(...points.map(point => point.time))
    const minPrice = Math.min(...points.map(point => point.price)), maxPrice = Math.max(...points.map(point => point.price))
    const padding = (maxPrice - minPrice) * .12 || Math.max(maxPrice * .05, 1)
    const low = Math.max(0, minPrice - padding), high = maxPrice + padding
    const x = (time: number) => left + (maxTime === minTime ? .5 : (time - minTime) / (maxTime - minTime)) * (width - left - right)
    const y = (price: number) => top + (1 - (price - low) / (high - low)) * (height - top - bottom)
    const yTicks = Array.from({ length: 5 }, (_, i) => ({ value: high - (high - low) * i / 4, y: top + (height - top - bottom) * i / 4 }))
    const xTicks = Array.from({ length: Math.min(4, points.length) }, (_, i) => minTime + (maxTime - minTime) * i / (Math.min(4, points.length) - 1 || 1))
    const baseY = height - bottom
    return { width, height, left, right, top, bottom, baseY, yTicks, xTicks, series: prepared.map((item, index) => {
      const coordinates = item.points.map(point => ({ ...point, x: x(point.time), y: y(point.price) }))
      return { ...item, index, coordinates, line: smoothLinePath(coordinates), area: smoothAreaPath(coordinates, baseY) }
    }) }
  }, [series])

  if (!chart) return <div className="chart-empty">История появится после нескольких проверок выбранной услуги.</div>
  return <div className="market-history-chart">
    <div className="market-history-legend">{chart.series.map(item => <span key={item.storeName}><i style={{ background: item.color }} />{item.storeName}</span>)}</div>
    <svg width="100%" height={chart.height} viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label="Динамика цен по магазинам">
      <defs>
        {chart.series.map(item => <linearGradient key={`g-${item.index}`} id={`mh-area-${item.index}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={item.color} stopOpacity="0.16" /><stop offset="100%" stopColor={item.color} stopOpacity="0.01" /></linearGradient>)}
      </defs>
      {chart.yTicks.map((tick, i) => <g key={`y-${i}`}><line x1={chart.left} x2={chart.width - chart.right} y1={tick.y} y2={tick.y} className="chart-gridline" /><text x={chart.left - 9} y={tick.y + 4} textAnchor="end" className="chart-axis-label">{Math.round(tick.value).toLocaleString('ru-RU')}</text></g>)}
      {chart.xTicks.map((time, i) => <text key={`x-${i}`} x={chart.left + (time - chart.xTicks[0]) / ((chart.xTicks[chart.xTicks.length - 1] - chart.xTicks[0]) || 1) * (chart.width - chart.left - chart.right)} y={chart.height - 8} textAnchor={i === 0 ? 'start' : i === chart.xTicks.length - 1 ? 'end' : 'middle'} className="chart-axis-label">{new Date(time).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</text>)}
      {chart.series.map(item => <g key={item.storeName}>
        <path d={item.area} fill={`url(#mh-area-${item.index})`} />
        <path d={item.line} fill="none" stroke={item.color} strokeWidth="7" strokeLinecap="round" opacity="0.12" />
        <path d={item.line} fill="none" stroke={item.color} strokeWidth="2.2" strokeLinecap="round" />
        {item.coordinates.map((point, index) => {
          const isLast = index === item.coordinates.length - 1
          return <circle key={`${point.timestamp}-${index}`} cx={point.x} cy={point.y} r={isLast ? (item.role === 'own' ? 5 : 4) : 2.6} fill={item.color} stroke="var(--bg-card)" strokeWidth={isLast ? 2 : 1.2}><title>{`${item.storeName} · ${new Date(point.time).toLocaleString('ru-RU')} · ${formatPrice(point.price, point.currency || currency)}`}</title></circle>
        })}
      </g>)}
    </svg>
  </div>
}
