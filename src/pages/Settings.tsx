import { useCallback, useEffect, useState } from 'react'
import type { AppSettings } from '../types'
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
