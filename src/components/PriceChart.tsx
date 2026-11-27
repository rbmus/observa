import { useMemo } from 'react'
import type { PricePoint } from '../types'
import { formatPrice } from '../utils/format'
import { smoothAreaPath, smoothLinePath } from '../utils/chartPath'

interface Props {
  data: PricePoint[]
  width?: number
  height?: number
  currency?: string
}

export default function PriceChart({ data, width = 720, height = 240, currency }: Props) {
  const chart = useMemo(() => {
    const points = (data || []).filter(point => Number.isFinite(Number(point.price)) && Number(point.price) > 0)
      .map(point => ({ ...point, time: new Date(point.timestamp).getTime() }))
      .filter(point => Number.isFinite(point.time))
      .sort((a, b) => a.time - b.time)
    if (points.length < 2) return null

    const left = 68, right = 18, top = 16, bottom = 36
    const plotWidth = width - left - right
    const plotHeight = height - top - bottom
    const min = Math.min(...points.map(point => point.price))
    const max = Math.max(...points.map(point => point.price))
    const padding = (max - min) * 0.12 || Math.max(max * 0.05, 1)
    const low = Math.max(0, min - padding)
    const high = max + padding
    const firstTime = points[0].time
    const lastTime = points[points.length - 1].time
    const span = lastTime - firstTime
    const xy = points.map((point, index) => ({
      ...point,
      x: left + (span ? (point.time - firstTime) / span : index / (points.length - 1)) * plotWidth,
      y: top + (1 - (point.price - low) / (high - low)) * plotHeight
    }))
    const yTicks = Array.from({ length: 5 }, (_, index) => ({
      value: high - (high - low) * index / 4,
      y: top + plotHeight * index / 4
    }))
    const xCount = Math.min(4, points.length)
    const xTicks = Array.from({ length: xCount }, (_, index) => {
      const point = xy[Math.round(index * (xy.length - 1) / Math.max(1, xCount - 1))]
      return { x: point.x, time: point.time }
    })
    const baseY = top + plotHeight
    const line = smoothLinePath(xy)
    return { points: xy, yTicks, xTicks, line, area: smoothAreaPath(xy, baseY), min, max, left, right, top, bottom, plotWidth, plotHeight }
  }, [data, width, height])

  if (!chart) return <div className="chart-empty">График появится после накопления двух изменений цены.</div>
  const latestCurrency = currency || data[data.length - 1]?.currency || 'RUB'
  const rising = chart.points[chart.points.length - 1].price > chart.points[0].price
  const falling = chart.points[chart.points.length - 1].price < chart.points[0].price
  const stroke = rising ? '#f87171' : falling ? '#34d399' : 'var(--accent)'

  return (
    <div className="price-chart">
      <div className="chart-summary"><span>Мин. {formatPrice(chart.min, latestCurrency)}</span><span>Макс. {formatPrice(chart.max, latestCurrency)}</span></div>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Изменение цены во времени">
        <defs><linearGradient id="price-area-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={stroke} stopOpacity="0.22" /><stop offset="100%" stopColor={stroke} stopOpacity="0.015" /></linearGradient></defs>
        {chart.yTicks.map((tick, index) => <g key={`y-${index}`}><line x1={chart.left} x2={width - chart.right} y1={tick.y} y2={tick.y} className="chart-gridline" /><text x={chart.left - 9} y={tick.y + 4} textAnchor="end" className="chart-axis-label">{Math.round(tick.value).toLocaleString('ru-RU')}</text></g>)}
        {chart.xTicks.map((tick, index) => <text key={`x-${index}`} x={tick.x} y={height - 9} textAnchor={index === 0 ? 'start' : index === chart.xTicks.length - 1 ? 'end' : 'middle'} className="chart-axis-label">{new Date(tick.time).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</text>)}
        <path d={chart.area} fill="url(#price-area-fill)" />
        <path d={chart.line} fill="none" stroke={stroke} strokeWidth="7" strokeLinecap="round" opacity="0.14" />
        <path d={chart.line} fill="none" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" />
        {chart.points.map((point, index) => {
          const isLast = index === chart.points.length - 1
          return <circle key={`${point.timestamp}-${index}`} cx={point.x} cy={point.y} r={isLast ? 5 : 3} fill={stroke} stroke="var(--bg-card)" strokeWidth={isLast ? 2.5 : 1.5}><title>{`${new Date(point.time).toLocaleString('ru-RU')} · ${formatPrice(point.price, point.currency || latestCurrency)}`}</title></circle>
        })}
      </svg>
    </div>
  )
}
