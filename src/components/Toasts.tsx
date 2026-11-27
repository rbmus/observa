import { useEffect } from 'react'
import { Icon } from './icons'

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  title: string
  body?: string
  onClick?: () => void
}

interface Props {
  toasts: Toast[]
  onDismiss: (id: number) => void
}

export default function Toasts({ toasts, onDismiss }: Props) {
  useEffect(() => {
    if (!toasts.length) return
    const timers = toasts.map(toast => window.setTimeout(() => onDismiss(toast.id), 8000))
    return () => timers.forEach(timer => window.clearTimeout(timer))
  }, [toasts, onDismiss])

  if (!toasts.length) return null
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map(toast => (
        <button
          key={toast.id}
          className={`toast toast-${toast.kind}`}
          onClick={() => { toast.onClick?.(); onDismiss(toast.id) }}
        >
          <span className="toast-icon"><Icon name={toast.kind === 'error' ? 'alert' : toast.kind === 'success' ? 'check' : 'activity'} size={15} /></span>
          <span className="toast-copy">
            <b>{toast.title}</b>
            {toast.body && <small>{toast.body}</small>}
          </span>
          <span className="toast-close" data-tooltip="Закрыть" onClick={event => { event.stopPropagation(); onDismiss(toast.id) }}><Icon name="close" size={11} /></span>
        </button>
      ))}
    </div>
  )
}
