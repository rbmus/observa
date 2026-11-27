import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface Tip {
  text: string
  left: number
  top: number
  below: boolean
}

const TIP_H = 30

export default function GlobalTooltip() {
  const [tip, setTip] = useState<Tip | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const place = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect()
      const preferBottom = el.getAttribute('data-tip') === 'bottom'
      const spaceTop = rect.top
      const spaceBottom = window.innerHeight - rect.bottom
      let below = preferBottom
      if (!preferBottom && spaceTop < TIP_H + 12 && spaceBottom > spaceTop) below = true
      if (preferBottom && spaceBottom < TIP_H + 12 && spaceTop > spaceBottom) below = false
      const left = Math.min(Math.max(rect.left + rect.width / 2, 70), window.innerWidth - 70)
      setTip({
        text: el.getAttribute('data-tooltip') || '',
        left,
        top: below ? rect.bottom + 8 : rect.top - 8,
        below
      })
    }

    const onOver = (event: MouseEvent) => {
      const el = (event.target as HTMLElement | null)?.closest?.('[data-tooltip]') as HTMLElement | null
      if (!el || el === anchorRef.current) return
      const text = el.getAttribute('data-tooltip')
      if (!text) return
      anchorRef.current = el
      place(el)
    }

    const onOut = (event: MouseEvent) => {
      const el = anchorRef.current
      if (!el) return
      const next = event.relatedTarget as HTMLElement | null
      if (next && (el.contains(next) || next.closest?.('[data-tooltip]'))) return
      anchorRef.current = null
      setTip(null)
    }

    const hide = () => {
      anchorRef.current = null
      setTip(null)
    }

    document.addEventListener('mouseover', onOver)
    document.addEventListener('mouseout', onOut)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mouseout', onOut)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [])

  if (!tip) return null
  return createPortal(
    <div className={`app-tooltip${tip.below ? ' below' : ''}`} style={{ left: tip.left, top: tip.top }}>
      {tip.text}
    </div>,
    document.body
  )
}
