import { useCallback, useEffect, useState } from 'react'
import type { AppSettings, UpdateState } from '../types'
import { Icon } from '../components/icons'
import Loader from '../components/Loader'

const settingRows: { key: 'autoStartMonitoring' | 'closeToTray' | 'launchAtLogin' | 'startMinimized'; title: string; description: string; windowsOnly?: boolean }[] = [
  { key: 'autoStartMonitoring', title: 'Запускать мониторинг вместе с приложением', description: 'При старте OBSERVA планировщик начнёт проверять включённые источники.' },
  { key: 'closeToTray', title: 'Сворачивать окно в системный трей', description: 'Кнопка закрытия скроет окно; приложение и мониторинг продолжат работать.' },
  { key: 'launchAtLogin', title: 'Запускать OBSERVA при входе в Windows', description: 'Добавляет приложение в автозагрузку Windows.', windowsOnly: true },
  { key: 'startMinimized', title: 'Открывать в трее при автозапуске', description: 'При входе в Windows приложение запустится без главного окна.', windowsOnly: true },
]

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [version, setVersion] = useState('')
  const [updateInfo, setUpdateInfo] = useState<UpdateState | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const isWindows = window.navigator.platform.toLowerCase().includes('win')

  const loadSettings = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      if (typeof window.observa.settingsGet !== 'function') throw new Error('Эта версия приложения не поддерживает настройки. Перезапустите OBSERVA или установите последнюю сборку.')
      setSettings(await window.observa.settingsGet())
    } catch (e: any) { setError(e.message || 'Не удалось загрузить настройки') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void loadSettings() }, [loadSettings])

  useEffect(() => {
    window.observa.appVersion().then(setVersion).catch(() => {})
    window.observa.updateStatus().then(setUpdateInfo).catch(() => {})
    return window.observa.onUpdateEvent(setUpdateInfo)
  }, [])

  const checkUpdates = async () => {
    setUpdateBusy(true)
    const result = await window.observa.updateCheck()
    setUpdateBusy(false)
    if (!result.ok) setMessage(result.error || 'Не удалось проверить обновления')
  }

  const update = async (patch: Partial<AppSettings>, key: string) => {
    if (!settings) return
    setSaving(key); setError(''); setMessage('')
    try {
      const next = await window.observa.settingsUpdate(patch)
      setSettings(next)
      setMessage('Настройка сохранена')
      window.setTimeout(() => setMessage(''), 2200)
    } catch (e: any) { setError(e.message || 'Не удалось сохранить настройку') }
    finally { setSaving(null) }
  }

  if (loading) return <div className="page-loader"><Loader size={36} />Загрузка настроек…</div>
  if (!settings) return <div className="settings-page">
    <header className="page-header"><div><div className="page-title">Настройки</div><div className="page-subtitle">Не удалось подключиться к хранилищу настроек</div></div></header>
    <div className="settings-error" role="alert">{error || 'Настройки пока недоступны.'}</div>
    <button className="btn" onClick={() => void loadSettings()}><Icon name="refresh" size={14} /> Повторить загрузку</button>
  </div>

  return <div className="settings-page">
    <header className="page-header">
      <div><div className="page-title">Настройки</div><div className="page-subtitle">Параметры запуска OBSERVA и мониторинга цен</div></div>
      <div className="settings-save-state" aria-live="polite">{saving ? 'Сохраняю…' : message}</div>
    </header>

    <section className="settings-section">
      <div className="settings-section-heading"><span className="settings-section-icon"><Icon name="activity" size={17} /></span><div><h2>Поведение приложения</h2><p>Как OBSERVA работает в фоне и при запуске</p></div></div>
      <div className="dashboard-panel settings-card">
        {settingRows.map(row => {
          const disabled = Boolean(row.windowsOnly && !isWindows) || saving === row.key || (row.key === 'startMinimized' && !settings.launchAtLogin)
          return <label className={`settings-row ${disabled && row.windowsOnly && !isWindows ? 'unsupported' : ''}`} key={row.key}>
            <span className="settings-row-copy"><b>{row.title}</b><small>{row.description}{row.windowsOnly && !isWindows ? ' Доступно только в Windows.' : ''}</small></span>
            <input className="settings-switch" type="checkbox" checked={settings[row.key]} disabled={disabled} onChange={event => update({ [row.key]: event.target.checked }, row.key)} />
          </label>
        })}
      </div>
    </section>

    <section className="settings-section">
      <div className="settings-section-heading"><span className="settings-section-icon"><Icon name="alert" size={17} /></span><div><h2>Уведомления</h2><p>Системные уведомления macOS/Windows при событиях мониторинга</p></div></div>
      <div className="dashboard-panel settings-card">
        <label className="settings-row">
          <span className="settings-row-copy"><b>Уведомлять об изменении цен</b><small>Когда проверка находит новую цену, OBSERVA покажет уведомление. За один прогон источника приходит одна сводка.</small></span>
          <input className="settings-switch" type="checkbox" checked={settings.notifyPriceChanges} disabled={saving === 'notifyPriceChanges'} onChange={event => update({ notifyPriceChanges: event.target.checked }, 'notifyPriceChanges')} />
        </label>
      </div>
    </section>

    <section className="settings-section">
      <div className="settings-section-heading"><span className="settings-section-icon"><Icon name="download" size={17} /></span><div><h2>Обновления</h2><p>OBSERVA проверяет новые версии при запуске и может обновляться автоматически</p></div></div>
      <div className="dashboard-panel settings-card">
        <div className="settings-row">
          <span className="settings-row-copy">
            <b>Текущая версия</b>
            <small>{version ? `OBSERVA ${version}` : '…'}{updateInfo?.packaged === false ? ' · dev-сборка, автообновление отключено' : ''}</small>
          </span>
          <div className="page-actions">
            {updateInfo?.status === 'downloaded' && <button className="btn primary" onClick={() => window.observa.updateInstall()}><Icon name="refresh" size={14} /> Установить и перезапустить</button>}
            <button className="btn" onClick={checkUpdates} disabled={updateBusy || updateInfo?.packaged === false}>
              {updateBusy || updateInfo?.status === 'checking' || updateInfo?.status === 'downloading'
                ? updateInfo?.status === 'downloading' ? `Загрузка ${updateInfo?.percent ?? 0}%` : 'Проверяю…'
                : 'Проверить обновления'}
            </button>
          </div>
        </div>
        {updateInfo?.status === 'available' && <div className="settings-row"><span className="settings-row-copy"><b>Найдена версия {updateInfo?.version}</b><small>Скачивается автоматически…</small></span></div>}
        {updateInfo?.status === 'latest' && <div className="settings-row"><span className="settings-row-copy"><b>Установлена последняя версия</b><small>Обновлений нет.</small></span></div>}
        {updateInfo?.status === 'error' && updateInfo?.error && <div className="settings-error" role="alert">{updateInfo?.error}</div>}
      </div>
    </section>

    <section className="settings-section">
      <div className="settings-section-heading"><span className="settings-section-icon"><Icon name="clock" size={17} /></span><div><h2>Проверка цен</h2><p>Настройки применяются к новым источникам и очереди мониторинга</p></div></div>
      <div className="dashboard-panel settings-card settings-controls-card">
        <label className="settings-control-row"><span><b>Интервал для новых источников</b><small>Можно изменить отдельно в настройках каждого магазина.</small></span><select value={settings.defaultCheckIntervalMin} disabled={saving === 'defaultCheckIntervalMin'} onChange={event => update({ defaultCheckIntervalMin: Number(event.target.value) }, 'defaultCheckIntervalMin')}><option value={15}>15 минут</option><option value={30}>30 минут</option><option value={60}>1 час</option><option value={180}>3 часа</option><option value={720}>12 часов</option><option value={1440}>1 день</option></select></label>
        <label className="settings-control-row"><span><b>Одновременные проверки</b><small>Ограничивает нагрузку на сайты и приложение.</small></span><select value={settings.maxConcurrentChecks} disabled={saving === 'maxConcurrentChecks'} onChange={event => update({ maxConcurrentChecks: Number(event.target.value) }, 'maxConcurrentChecks')}><option value={1}>1 источник</option><option value={2}>2 источника</option><option value={3}>3 источника</option><option value={4}>4 источника</option><option value={5}>5 источников</option><option value={6}>6 источников</option><option value={8}>8 источников</option></select></label>
      </div>
    </section>
    {error && <div className="settings-error" role="alert">{error}</div>}
    <div className="settings-footnote">Настройки сохраняются на этом компьютере и не входят в файл переноса источников.</div>
  </div>
}
