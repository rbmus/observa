import { useEffect } from 'react'

interface Props {
  title: string
  message: string
  kind?: 'notice' | 'confirm'
  confirmLabel?: string
  busy?: boolean
  onClose: () => void
  onConfirm?: () => void
}

export default function FeedbackModal({ title, message, kind = 'notice', confirmLabel = 'Подтвердить', busy = false, onClose, onConfirm }: Props) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  return (
    <div className="modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <section className="modal feedback-modal" role={kind === 'confirm' ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby="feedback-modal-title" aria-describedby="feedback-modal-message">
        <h3 id="feedback-modal-title">{title}</h3>
        <p id="feedback-modal-message">{message}</p>
        <div className="modal-actions">
          {kind === 'confirm' && <button className="btn" onClick={onClose} disabled={busy}>Отмена</button>}
          <button className={`btn ${kind === 'confirm' ? 'danger' : 'primary'}`} onClick={kind === 'confirm' ? onConfirm : onClose} disabled={busy} autoFocus>
            {busy ? 'Выполняю…' : kind === 'confirm' ? confirmLabel : 'Понятно'}
          </button>
        </div>
      </section>
    </div>
  )
}
