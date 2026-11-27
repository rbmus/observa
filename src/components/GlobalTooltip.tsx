import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface Tip {
  text: string
  x: number
  y: number
  below: boolean
}

const TIP_GAP = 10
const TIP_W = 260
const TIP_H = 34

export default function GlobalTooltip() {
  const [tip, setTip] = useState<Tip | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)
  const boundsRef = useRef<DOMRect | null>(null)
  const cursorRef = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))

    const place = () => {
      const el = anchorRef.current
      if (!el) return
      const bounds = boundsRef.current
      const areaLeft = bounds ? bounds.left : 0
      const areaRight = bounds ? bounds.right : window.innerWidth
      const areaTop = bounds ? bounds.top : 0
      const areaBottom = bounds ? bounds.bottom : window.innerHeight

      const spaceBelow = areaBottom - cursorRef.current.y
      const below = spaceBelow < TIP_H + TIP_GAP * 2 && cursorRef.current.y - areaTop > spaceBelow

      const x = clamp(cursorRef.current.x, areaLeft + TIP_W / 2 + 4, areaRight - TIP_W / 2 - 4)
      const y = below
        ? clamp(cursorRef.current.y + TIP_GAP, areaTop + 4, areaBottom - TIP_H - 4)
        : clamp(cursorRef.current.y - TIP_GAP, areaTop + TIP_H + 4, areaBottom - 4)

      setTip({ text: el.getAttribute('data-tooltip') || '', x, y, below })
    }

    const onOver = (event: MouseEvent) => {
      const el = (event.target as HTMLElement | null)?.closest?.('[data-tooltip]') as HTMLElement | null
      if (!el || el === anchorRef.current) return
      const text = el.getAttribute('data-tooltip')
      if (!text) return
      anchorRef.current = el
      cursorRef.current = { x: event.clientX, y: event.clientY }
      const boundsEl = el.closest?.('[data-tip-bounds]') as HTMLElement | null
      boundsRef.current = boundsEl ? boundsEl.getBoundingClientRect() : null
      place()
    }

    const onMove = (event: MouseEvent) => {
      if (!anchorRef.current) return
      cursorRef.current = { x: event.clientX, y: event.clientY }
      place()
    }

    const onOut = (event: MouseEvent) => {
      const el = anchorRef.current
      if (!el) return
      const next = event.relatedTarget as HTMLElement | null
      if (next && (el.contains(next) || next.closest?.('[data-tooltip]'))) return
      anchorRef.current = null
      boundsRef.current = null
      setTip(null)
    }

    const hide = () => {
      anchorRef.current = null
      boundsRef.current = null
      setTip(null)
    }

    document.addEventListener('mouseover', onOver)
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseout', onOut)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseout', onOut)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [])

  if (!tip) return null
  return createPortal(
    <div className={`app-tooltip${tip.below ? ' below' : ''}`} style={{ left: tip.x, top: tip.y }}>
      {tip.text}
    </div>,
    document.body
  )
}
