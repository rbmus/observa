import { useEffect, useMemo } from 'react'
import type { UpdateState } from '../types'

interface Props {
  update: UpdateState
  currentVersion: string
  onClose: () => void
  onInstall: () => void
  onDownload: () => void
}

function parseReleaseNotes(notes?: string | null): string[] {
  if (!notes) return []
  const items: string[] = []
  for (const rawLine of notes.split(/\r?\n/)) {
    const line = rawLine
      .replace(/^#{1,6}\s+/, '')
      .replace(/^\s*[-*•+]\s+/, '')
      .replace(/^\s*\d+[.)]\s+/, '')
      .trim()
    if (!line || /^---+$/.test(line) || /^what'?s changed$/i.test(line) || /^full changelog/i.test(line)) continue
    const cleaned = line.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim()
    if (cleaned) items.push(cleaned)
    if (items.length >= 20) break
  }
  return items
}

export default function UpdateModal({ update, currentVersion, onClose, onInstall, onDownload }: Props) {
  const changes = useMemo(() => parseReleaseNotes(update.releaseNotes), [update.releaseNotes])
  const downloaded = update.status === 'downloaded'
  const downloading = update.status === 'downloading'
  const percent = Math.max(0, Math.min(100, update.percent ?? 0))

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !downloaded) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [downloaded, onClose])

  return (
    <div className="modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !downloaded) onClose() }}>
      <section className="modal update-modal" role="dialog" aria-modal="true" aria-labelledby="update-modal-title">
        <div className="update-modal-head">
          <h3 id="update-modal-title">{downloaded ? 'Обновление готово' : 'Доступно обновление'}</h3>
          {update.version && <span className="update-modal-version">v{update.version}</span>}
        </div>

        <p className="update-modal-current">
          Текущая версия: <b>v{currentVersion}</b>
          {update.version ? <> → новая: <b>v{update.version}</b></> : null}
        </p>

        {changes.length > 0 && (
          <div className="update-modal-changes">
            <span className="update-modal-changes-title">Что нового</span>
            <ul>
              {changes.map((change, index) => <li key={index}>{change}</li>)}
            </ul>
          </div>
        )}

        {downloaded ? (
          <p className="update-modal-note">Обновление скачано. Перезапустите приложение, чтобы установить его.</p>
        ) : downloading ? (
          <div className="update-modal-progress">
            <div className="update-modal-progress-bar" style={{ width: `${percent}%` }} />
          </div>
        ) : update.status === 'available' ? (
          <p className="update-modal-note">Скачивание начнётся автоматически, либо запустите его сейчас.</p>
        ) : null}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>{downloaded ? 'Позже' : 'Напомнить позже'}</button>
          {downloaded ? (
            <button className="btn primary" onClick={onInstall} autoFocus>Установить и перезапустить</button>
          ) : update.status === 'available' ? (
            <button className="btn primary" onClick={onDownload} autoFocus>Скачать сейчас</button>
          ) : downloading ? (
            <button className="btn primary" disabled>Скачивается… {percent}%</button>
          ) : null}
        </div>
      </section>
    </div>
  )
}
