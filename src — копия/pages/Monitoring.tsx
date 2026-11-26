import { useEffect, useState } from 'react'
import type { Store, MonitorStatus, MonitorEvent } from '../types'
import { formatPrice, formatPercent, formatDate } from '../utils/format'
import { Icon } from '../components/icons'
import Loader from '../components/Loader'

export default function Monitoring() {
  const [stores, setStores] = useState<Store[]>([])
  const [status, setStatus] = useState<MonitorStatus | null>(null)
  const [events, setEvents] = useState<(MonitorEvent & { at: string })[]>([])
  const [checking, setChecking] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [startAtLogin, setStartAtLogin] = useState(false)

  const refresh = () => {
    Promise.all([window.observa.storesList(), window.observa.monitorStatus()]).then(([s, st]) => {
      setStores(s)
      setStatus(st)
      setLoading(false)
    })
  }

  useEffect(() => {
    refresh()
    let timer: number | undefined
    const unsubscribe = window.observa.onMonitorEvent((e) => {
      setEvents(prev => [{ ...e, at: new Date().toISOString() }, ...prev].slice(0, 100))
      window.clearTimeout(timer)
      timer = window.setTimeout(refresh, 250)
    })
    window.observa.monitorStartAtLogin().then(setStartAtLogin)
    return () => { window.clearTimeout(timer); unsubscribe() }
  }, [])

  const toggleStartAtLogin = async () => {
    const enabled = await window.observa.monitorSetStartAtLogin(!startAtLogin)
    setStartAtLogin(enabled)
  }

  const toggleMonitor = async () => {
    if (status?.running) await window.observa.monitorStop()
    else await window.observa.monitorStart()
    refresh()
  }

  const checkStore = async (id: string) => {
    setChecking(id)
    await window.observa.monitorCheckNow(id)
    setChecking(null)
    refresh()
  }

  const checkAll = async () => {
    setChecking('all')
    await window.observa.monitorCheckAll()
    setChecking(null)
    refresh()
  }

  if (loading) {
    return <div className="page-loader"><Loader size={36} />Загрузка мониторинга…</div>
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Мониторинг</div>
          <div className="page-subtitle">
            Мониторинг продолжает работать, когда окно скрыто в системном трее.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" onClick={checkAll} disabled={checking === 'all'}>
            {checking === 'all' ? 'Проверка…' : <><Icon name="zap" size={14} /> Проверить все сейчас</>}
          </button>
          <button className={`btn ${status?.running ? 'danger' : 'primary'}`} onClick={toggleMonitor}>
            {status?.running ? <><Icon name="stop" size={14} /> Остановить</> : <><Icon name="play" size={14} /> Запустить мониторинг</>}
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Режим</div>
          <div className="stat-value small">
            <span className={`badge ${status?.running ? 'ok' : 'error'}`}>
              {status?.running ? <><Icon name="activity" size={11} /> РАБОТАЕТ</> : <><Icon name="clock" size={11} /> ОСТАНОВЛЕН</>}
            </span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Запущен</div>
          <div className="stat-value small">{status?.startedAt ? formatDate(status.startedAt) : '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Последний тик</div>
          <div className="stat-value small">{status?.lastTickAt ? formatDate(status.lastTickAt) : '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Успешных проверок</div>
          <div className="stat-value">{status?.totalChecks ?? 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Ошибок</div>
          <div className="stat-value" style={{ color: 'var(--red)' }}>{status?.totalErrors ?? 0}</div>
        </div>
      </div>

      {window.navigator.platform.toLowerCase().includes('win') && <section className="dashboard-panel monitoring-autostart">
        <div><b>Фоновый запуск Windows</b><p>OBSERVA запускается при входе в систему и продолжает проверять цены в трее.</p></div>
        <button className={`btn ${startAtLogin ? 'primary' : ''}`} onClick={toggleStartAtLogin}>{startAtLogin ? 'Включён' : 'Включить'}</button>
      </section>}

      <div className="section-title">Отслеживаемые магазины</div>
      <div className="table-wrap" style={{ marginBottom: 24 }}>
        <table>
          <thead>
            <tr>
              <th>Магазин</th>
              <th>Интервал</th>
              <th>Товаров</th>
              <th>Статус</th>
              <th>Последнее успешное обновление</th>
              <th>Ошибка</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {stores.map(s => (
              <tr key={s.id}>
                <td>
                  <div style={{ fontWeight: 500 }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{s.url}</div>
                </td>
                <td>{s.checkIntervalMin} мин</td>
                <td>{s.products.length}</td>
                <td>
                  <span className={`badge ${s.status}`}>
                    {s.status === 'ok' ? 'OK' : s.status === 'error' ? 'Ошибка' : s.status === 'checking' ? 'Проверка…' : 'Ожидание'}
                  </span>
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{formatDate(s.lastSuccessCheck || (s.status === 'ok' ? s.lastCheck : null))}</td>
                <td style={{ fontSize: 12, color: 'var(--red)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {s.lastError || '—'}
                </td>
                <td>
                  <button
                    className="btn small"
                    onClick={() => checkStore(s.id)}
                    disabled={checking === s.id || s.status === 'checking'}
                  >
                    {checking === s.id ? '…' : 'Проверить'}
                  </button>
                </td>
              </tr>
            ))}
            {stores.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 30, color: 'var(--text-secondary)' }}>
                Добавьте магазины во вкладке «Магазины»
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="section-title">Изменения цен</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Время</th>
              <th>Товар</th>
              <th>Было</th>
              <th>Стало</th>
              <th>Изменение</th>
            </tr>
          </thead>
          <tbody>
            {events.filter(e => e.event === 'price:changed').map((e, i) => (
              <tr key={i}>
                <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{formatDate(e.at)}</td>
                <td>{e.productName}</td>
                <td>{formatPrice(e.oldPrice ?? null, e.currency)}</td>
                <td style={{ fontWeight: 600 }}>{formatPrice(e.newPrice ?? null, e.currency)}</td>
                <td className={e.changePercent && e.changePercent > 0 ? 'price-up' : 'price-down'}>
                  {formatPercent(e.changePercent)}
                </td>
              </tr>
            ))}
            {events.filter(e => e.event === 'price:changed').length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--text-secondary)' }}>
                Изменений цен пока не зафиксировано
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
