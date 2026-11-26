import { useEffect, useState } from 'react'
import type { Store, SourceSetupItem, SourceSetupPreview } from '../types'
import { timeAgo } from '../utils/format'
import { Icon } from '../components/icons'
import Checkbox from '../components/Checkbox'
import Loader from '../components/Loader'
import FeedbackModal from '../components/FeedbackModal'

interface Props {
  onOpenStore: (id: string) => void
}

interface FormState {
  name: string
  url: string
  category: string
  checkIntervalMin: number
  role: 'own' | 'competitor'
  sourceType: 'website' | 'telegram'
}

const EMPTY_FORM: FormState = { name: '', url: '', category: 'general', checkIntervalMin: 60, role: 'competitor', sourceType: 'website' }

function StoreFavicon({ url }: { url: string }) {
  const [stage, setStage] = useState(0)
  useEffect(() => setStage(0), [url])
  let host = ''
  let origin = ''
  try { const parsed = new URL(url); host = parsed.hostname; origin = parsed.origin } catch { /* use initials below */ }
  if (stage >= 2 || !host) return <span className="store-favicon fallback" aria-hidden="true">{host.slice(0, 1).toUpperCase() || '↗'}</span>
  const src = stage === 0
    ? `${origin}/favicon.ico`
    : `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`
  return <img className="store-favicon" src={src} alt="" onError={() => setStage(current => Math.min(current + 1, 2))} />
}

export default function Stores({ onOpenStore }: Props) {
  const [stores, setStores] = useState<Store[]>([])
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'enabled' | 'errors' | 'own'>('all')
  const [checkingAll, setCheckingAll] = useState(false)
  const [setupBusy, setSetupBusy] = useState(false)
  const [setupMessage, setSetupMessage] = useState('')
  const [setupError, setSetupError] = useState('')
  const [importPreview, setImportPreview] = useState<SourceSetupPreview | null>(null)
  const [pendingRemoval, setPendingRemoval] = useState<{ id: string; name: string } | null>(null)
  const [removing, setRemoving] = useState(false)
  const [defaultInterval, setDefaultInterval] = useState(60)

  const refresh = () => {
    window.observa.storesList().then(s => {
      setStores(s)
      setLoading(false)
    })
  }

  useEffect(() => {
    refresh()
    window.observa.settingsGet().then(settings => setDefaultInterval(settings.defaultCheckIntervalMin)).catch(() => {})
    let timer: number | undefined
    const unsubscribe = window.observa.onDataChanged(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(refresh, 250)
    })
    return () => { window.clearTimeout(timer); unsubscribe() }
  }, [])

  const addStore = async () => {
    if (!form.url) { setError('Укажите URL магазина'); return }
    setSaving(true)
    setError('')
    try {
      let url = form.url.trim()
      if (form.sourceType === 'telegram') {
        const raw = url.startsWith('@') ? `https://t.me/s/${url.slice(1)}` : (/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`)
        const parsed = new URL(raw)
        if (!['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me'].includes(parsed.hostname.toLowerCase())) throw new Error('Укажите публичную ссылку t.me на канал')
        const segments = parsed.pathname.split('/').filter(Boolean)
        const channel = (segments[0]?.toLowerCase() === 's' ? segments[1] : segments[0]) || ''
        if (!/^[a-z][a-z0-9_]{4,31}$/i.test(channel)) throw new Error('Нужна ссылка на публичный канал, например t.me/my_channel')
        url = `https://t.me/s/${channel}`
      } else if (!/^https?:\/\//i.test(url)) url = 'https://' + url
      const parts = url.split('/').filter(Boolean)
      const fallbackName = form.sourceType === 'telegram' ? parts[parts.length - 1] : new URL(url).hostname
      await window.observa.storesAdd({
        name: form.name.trim() || fallbackName,
        url,
        category: form.category,
        checkIntervalMin: form.checkIntervalMin,
        role: form.role,
        sourceType: form.sourceType
      })
      setShowModal(false)
      setForm(EMPTY_FORM)
      refresh()
    } catch (e: any) {
      setError(e.message || 'Ошибка добавления')
    } finally {
      setSaving(false)
    }
  }

  const removeStore = async () => {
    if (!pendingRemoval) return
    setRemoving(true)
    try {
      await window.observa.storesRemove(pendingRemoval.id)
      setPendingRemoval(null)
      refresh()
    } catch (e: any) {
      setSetupError(e.message || 'Не удалось удалить источник')
      setPendingRemoval(null)
    } finally {
      setRemoving(false)
    }
  }

  const toggleEnabled = async (s: Store, enabled: boolean) => {
    setStores(current => current.map(store => store.id === s.id ? { ...store, enabled } : store))
    setSetupError('')
    try {
      const updated = await window.observa.storesUpdate(s.id, { enabled })
      if (!updated) throw new Error('Источник не найден')
      refresh()
    } catch (e: any) {
      refresh()
      setSetupError(e.message || 'Не удалось сохранить режим мониторинга')
    }
  }

  const checkAll = async () => {
    setCheckingAll(true)
    setSetupError('')
    try {
      const results = await window.observa.monitorCheckAll()
      const okCount = results.filter(r => r.ok).length
      const added = results.reduce((n, r) => n + (r.added || 0), 0)
      const removed = results.reduce((n, r) => n + (r.removed || 0), 0)
      setSetupMessage(`Проверено источников: ${okCount} из ${results.length}. Добавлено позиций: ${added}, удалено устаревших: ${removed}.`)
      refresh()
    } catch (e: any) {
      setSetupError(e.message || 'Не удалось проверить источники')
    } finally {
      setCheckingAll(false)
    }
  }

  const exportSetup = async () => {
    setSetupBusy(true)
    setSetupMessage('')
    setSetupError('')
    try {
      const result = await window.observa.sourcesExportSetup()
      if (result.saved) setSetupMessage(`Файл сохранён. Источников: ${result.count}.`)
    } catch (e: any) {
      setSetupError(e.message || 'Не удалось сохранить конфигурацию')
    } finally { setSetupBusy(false) }
  }

  const chooseSetupFile = async () => {
    setSetupBusy(true)
    setSetupMessage('')
    setSetupError('')
    try {
      const preview = await window.observa.sourcesReadSetup()
      if (preview) setImportPreview(preview)
    } catch (e: any) {
      setSetupError(e.message || 'Не удалось прочитать конфигурацию')
    } finally { setSetupBusy(false) }
  }

  const applySetup = async () => {
    if (!importPreview) return
    setSetupBusy(true)
    setSetupError('')
    try {
      const items: SourceSetupItem[] = importPreview.sources.map(({ action: _action, ...source }) => source)
      const result = await window.observa.sourcesApplySetup(items)
      setImportPreview(null)
      setSetupMessage(`Готово: добавлено ${result.addedCount}, обновлено ${result.updatedCount}.`)
      refresh()
    } catch (e: any) {
      setSetupError(e.message || 'Не удалось применить настройки')
    } finally { setSetupBusy(false) }
  }

  const visibleStores = stores.filter(s => {
    const matchesSearch = `${s.name} ${s.url}`.toLowerCase().includes(search.toLowerCase())
    const matchesFilter = filter === 'all' || (filter === 'enabled' ? s.enabled : filter === 'errors' ? s.status === 'error' : s.role === 'own')
    return matchesSearch && matchesFilter
  })
  const sourceHealth = [
    { label: 'Активны', count: stores.filter(s => s.status === 'ok').length, tone: 'ok' },
    { label: 'Проверяются', count: stores.filter(s => s.status === 'checking').length, tone: 'checking' },
    { label: 'С ошибками', count: stores.filter(s => s.status === 'error').length, tone: 'error' },
    { label: 'Ожидают', count: stores.filter(s => s.status === 'idle').length, tone: 'idle' },
  ]

  if (loading) {
    return <div className="page-loader"><Loader size={36} />Загрузка магазинов…</div>
  }

  return (
    <div className="stores-page">
      <div className="page-header">
        <div>
          <div className="page-title">Источники</div>
          <div className="page-subtitle">
            Магазины и каналы, из которых собираются цены
          </div>
        </div>
        <div className="competitor-actions">
          {stores.length > 0 && <button className="btn" onClick={checkAll} disabled={checkingAll}><Icon name="refresh" size={14} /> {checkingAll ? 'Проверяю…' : 'Проверить все'}</button>}
          <button className="btn" onClick={() => { setForm({ ...EMPTY_FORM, checkIntervalMin: defaultInterval, role: 'own' }); setShowModal(true) }}><Icon name="plus" size={14} /> Свой магазин</button>
          <button className="btn primary" onClick={() => { setForm({ ...EMPTY_FORM, checkIntervalMin: defaultInterval }); setShowModal(true) }}><Icon name="plus" size={14} /> Добавить источник</button>
        </div>
      </div>

      <section className="source-overview">
        <div className="source-overview-stats">
          <div><span>Источников</span><b>{stores.length}</b></div>
          <div><span>В мониторинге</span><b>{stores.filter(s => s.enabled).length}</b></div>
          <div><span>Товаров и услуг</span><b>{stores.reduce((n, s) => n + s.products.length, 0)}</b></div>
          <div><span>С ошибками</span><b className={stores.some(s => s.status === 'error') ? 'health-error-number' : ''}>{stores.filter(s => s.status === 'error').length}</b></div>
        </div>
        <div className="dashboard-panel source-overview-health">
          <div className="source-health-heading"><div><b>Состояние мониторинга</b><span>Распределение по последним проверкам</span></div><b>{stores.length} источн.</b></div>
          <div className="source-health-bar" role="img" aria-label="Распределение источников по статусу">
            {sourceHealth.map(item => <i key={item.tone} className={item.tone} style={{ width: `${stores.length ? item.count / stores.length * 100 : 0}%` }} />)}
          </div>
          <div className="source-health-legend">{sourceHealth.map(item => <div key={item.tone}><span className={`health-dot ${item.tone}`} /><span>{item.label}</span><b>{item.count}</b></div>)}</div>
        </div>
      </section>

      <section className="setup-transfer-panel dashboard-panel">
        <div className="setup-transfer-copy"><b>Настройки источников</b><span>Передайте список сайтов, каналов и расписание мониторинга другому пользователю через JSON-файл.</span></div>
        <div className="setup-transfer-actions">
          <button className="btn" onClick={chooseSetupFile} disabled={setupBusy}><Icon name="upload" size={14} /> Загрузить файл</button>
          <button className="btn" onClick={exportSetup} disabled={setupBusy}><Icon name="download" size={14} /> Выгрузить файл</button>
        </div>
      </section>
      {setupMessage && <div className="export-message setup-transfer-message">{setupMessage}</div>}
      {setupError && <div className="setup-transfer-error">{setupError}</div>}

      {stores.length === 0 ? (
        <div className="empty-state" style={{ padding: '80px 20px' }}>
          <div className="icon"><Icon name="store" size={48} /></div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
            Пока нет конкурентов
          </div>
            <div>Добавьте магазин или канал, чтобы начать мониторинг цен</div>
          <button className="btn primary" style={{ marginTop: 20 }} onClick={() => { setForm(EMPTY_FORM); setShowModal(true) }}>
            <Icon name="plus" size={14} /> Добавить источник
          </button>
        </div>
      ) : (
        <>
        <div className="competitor-toolbar">
          <label className="search-box"><Icon name="search" size={16} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Найти источник…" /></label>
          <div className="filter-pills" role="group" aria-label="Фильтр источников">
            <button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>Все <span>{stores.length}</span></button>
            <button className={filter === 'enabled' ? 'selected' : ''} onClick={() => setFilter('enabled')}>В мониторинге <span>{stores.filter(s => s.enabled).length}</span></button>
            <button className={filter === 'errors' ? 'selected' : ''} onClick={() => setFilter('errors')}>С ошибками <span>{stores.filter(s => s.status === 'error').length}</span></button>
            <button className={filter === 'own' ? 'selected' : ''} onClick={() => setFilter('own')}>Мой магазин <span>{stores.filter(s => s.role === 'own').length}</span></button>
          </div>
          <span className="result-count">Показано {visibleStores.length} из {stores.length}</span>
        </div>
        <div className="source-grid">
          {visibleStores.map(s => <article className="source-card dashboard-panel" key={s.id}>
            <div className="source-card-header">
              <button className="source-card-open" onClick={() => onOpenStore(s.id)}>
                <StoreFavicon url={s.url} />
                <span className="source-card-title">{s.name}</span>
              </button>
              <button className="btn small danger" title="Удалить источник" aria-label={`Удалить ${s.name}`} onClick={() => setPendingRemoval({ id: s.id, name: s.name })}><Icon name="close" size={12} /></button>
            </div>
            <div className="source-card-url">{s.url}</div>
            <div className="source-card-labels">
              <span className={`source-role ${s.role === 'own' ? 'own' : ''}`}>{s.role === 'own' ? 'Мой магазин' : 'Конкурент'}</span>
              {s.sourceType === 'telegram' && <span className="source-role">Telegram</span>}
              <span className={`badge ${s.status}`}>{s.status === 'ok' ? 'Активен' : s.status === 'error' ? 'Ошибка' : s.status === 'checking' ? 'Проверка…' : 'Ожидание'}</span>
            </div>
            <div className="source-card-metrics">
              <div><span>Позиций</span><b>{s.products.length}</b></div>
              <div><span>Интервал</span><b>Каждые {s.checkIntervalMin} мин</b></div>
              <div><span>Последнее успешное обновление</span><b>{timeAgo(s.lastSuccessCheck || (s.status === 'ok' ? s.lastCheck : null))}</b></div>
            </div>
            {s.lastError && <div className="source-card-error">{s.lastError}</div>}
            <div className="source-card-footer"><Checkbox checked={s.enabled} onChange={enabled => toggleEnabled(s, enabled)} label="В мониторинге" /><button className="text-button" onClick={() => onOpenStore(s.id)}>Открыть источник</button></div>
          </article>)}
          {visibleStores.length === 0 && <div className="table-empty source-empty">{stores.length ? 'По этим фильтрам источники не найдены.' : 'Список источников пуст.'}</div>}
        </div>
        </>
      )}

      {/* Модалка добавления */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{form.role === 'own' ? 'Добавить свой магазин' : 'Добавить источник цен'}</h3>
            <div className="form-row">
              <div className="form-group">
                <label>Сравниваемый магазин</label>
                <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as FormState['role'], sourceType: e.target.value === 'own' ? 'website' : form.sourceType })}>
                  <option value="competitor">Конкурент</option>
                  <option value="own">Мой магазин</option>
                </select>
              </div>
              {form.role === 'competitor' && <div className="form-group">
                <label>Тип источника</label>
                <select value={form.sourceType} onChange={e => setForm({ ...form, sourceType: e.target.value as FormState['sourceType'] })}>
                  <option value="website">Сайт</option>
                  <option value="telegram">Публичный Telegram-канал</option>
                </select>
              </div>}
            </div>
            <div className="form-group">
              <label>Название (необязательно)</label>
              <input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="Например: Конкурент-Маркет"
              />
            </div>
            <div className="form-group">
              <label>{form.sourceType === 'telegram' ? 'Ссылка или @имя публичного канала *' : 'URL сайта *'}</label>
              <input
                value={form.url}
                onChange={e => setForm({ ...form, url: e.target.value })}
                placeholder={form.sourceType === 'telegram' ? 'https://t.me/channel или @channel' : 'https://shop.ru'}
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Категория</label>
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                  <option value="general">Общая</option>
                  <option value="electronics">Электроника</option>
                  <option value="clothing">Одежда</option>
                  <option value="food">Продукты</option>
                  <option value="services">Услуги</option>
                  <option value="other">Другое</option>
                </select>
              </div>
              <div className="form-group">
                <label>Интервал проверки</label>
                <select
                  value={form.checkIntervalMin}
                  onChange={e => setForm({ ...form, checkIntervalMin: Number(e.target.value) })}
                >
                  <option value={15}>Каждые 15 мин</option>
                  <option value={30}>Каждые 30 мин</option>
                  <option value={60}>Каждый час</option>
                  <option value={180}>Каждые 3 часа</option>
                  <option value={720}>Каждые 12 часов</option>
                  <option value={1440}>Раз в день</option>
                </select>
              </div>
            </div>
            {error && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 10 }}>{error}</div>}
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowModal(false)}>Отмена</button>
              <button className="btn primary" onClick={addStore} disabled={saving}>
                {saving ? 'Добавление…' : 'Добавить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {importPreview && (
        <div className="modal-overlay" onClick={() => !setupBusy && setImportPreview(null)}>
          <div className="modal setup-import-modal" onClick={e => e.stopPropagation()}>
            <h3>Загрузка настроек</h3>
            <div className="setup-import-file">{importPreview.fileName}</div>
            <p className="setup-import-summary">Будет добавлено <b>{importPreview.addedCount}</b> и обновлено <b>{importPreview.updatedCount}</b> источников. У совпавших источников сохранятся собранные товары и история цен.</p>
            <div className="setup-import-list">
              {importPreview.sources.slice(0, 8).map((source, index) => <div className="setup-import-row" key={`${source.url}-${index}`}>
                <span><b>{source.name}</b><small>{source.url}</small></span>
                <small className={source.action === 'update' ? 'setup-action-update' : 'setup-action-add'}>{source.action === 'update' ? 'Обновить' : 'Добавить'}</small>
              </div>)}
              {importPreview.sources.length > 8 && <div className="setup-import-more">И ещё {importPreview.sources.length - 8} источников</div>}
              {importPreview.sources.length === 0 && <div className="table-empty">В файле нет источников.</div>}
            </div>
            <p className="setup-import-note">Цены и история не передаются. Новые источники заполнятся при автоматической проверке.</p>
            {setupError && <div className="setup-transfer-error">{setupError}</div>}
            <div className="modal-actions">
              <button className="btn" onClick={() => setImportPreview(null)} disabled={setupBusy}>Отмена</button>
              <button className="btn primary" onClick={applySetup} disabled={setupBusy}>{setupBusy ? 'Загрузка…' : 'Импортировать'}</button>
            </div>
          </div>
        </div>
      )}

      {pendingRemoval && <FeedbackModal
        title="Удалить источник?"
        message={`Источник «${pendingRemoval.name}», его товары и история цен будут удалены без возможности восстановления.`}
        kind="confirm"
        confirmLabel="Удалить источник"
        busy={removing}
        onClose={() => setPendingRemoval(null)}
        onConfirm={removeStore}
      />}

    </div>
  )
}
