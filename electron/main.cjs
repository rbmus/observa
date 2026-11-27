const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, nativeImage, Notification } = require('electron')
const path = require('path')
const fs = require('fs')
const net = require('net')
const ExcelJS = require('exceljs')
const { autoUpdater } = require('electron-updater')
const { StoreService } = require(path.join(__dirname, 'services/storeService.cjs'))
const { PriceChecker } = require(path.join(__dirname, 'services/priceChecker.cjs'))
const { Analyzer, cleanComparableName, normalizeMatchName, similarityCore } = require(path.join(__dirname, 'services/analyzer.cjs'))

let mainWindow = null
let storeService = null
let priceChecker = null
let analyzer = null
let tray = null
let trayCheckingAll = false
let isQuitting = false
let pendingNavigation = null
let analyticsSummaryCache = null
let settingsFilePath = null
let appSettings = null
let splashWindow = null

// Батчим уведомления об изменениях цен: одна проверка источника может дать
// десятки price:changed — пользователю нужна одна сводка, а не спам.
const pendingPriceNotifications = new Map()

// ---------- Автообновление через GitHub Releases ----------
let updateState = { status: 'idle', version: null, percent: 0, error: null }

function sendUpdateEvent(patch) {
  updateState = { ...updateState, ...patch }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:event', updateState)
  }
}

function setupAutoUpdater() {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => sendUpdateEvent({ status: 'checking', error: null }))
  autoUpdater.on('update-available', info => sendUpdateEvent({ status: 'available', version: info.version, releaseNotes: normalizeReleaseNotes(info.releaseNotes) }))
  autoUpdater.on('update-not-available', () => sendUpdateEvent({ status: 'latest', releaseNotes: null }))
  autoUpdater.on('download-progress', p => sendUpdateEvent({ status: 'downloading', percent: Math.round(p.percent || 0) }))
  autoUpdater.on('update-downloaded', info => {
    sendUpdateEvent({ status: 'downloaded', version: info.version, releaseNotes: normalizeReleaseNotes(info.releaseNotes) })
    const notification = new Notification({ title: 'OBSERVA', body: `Готово обновление ${info.version} — перезапустите приложение` })
    notification.on('click', () => openWindow('settings'))
    notification.show()
  })
  autoUpdater.on('error', err => sendUpdateEvent({ status: 'error', error: err?.message || String(err) }))
  autoUpdater.checkForUpdates().catch(() => {})
}

function flushPriceNotification(storeId) {
  const entry = pendingPriceNotifications.get(storeId)
  pendingPriceNotifications.delete(storeId)
  if (!entry || !appSettings?.notifyPriceChanges || !Notification.isSupported()) return
  const storeName = storeService?.getById(storeId)?.name || entry.storeName || 'Источник'
  let body
  if (entry.changes.length === 1) {
    const change = entry.changes[0]
    body = `${change.productName}: ${formatNotifyPrice(change.oldPrice, change.currency)} → ${formatNotifyPrice(change.newPrice, change.currency)}`
  } else if (entry.changes.length > 1) {
    body = `${entry.changes.length} изменений цен. Например: ${entry.changes[0].productName}`
  } else if (entry.error) {
    body = `Ошибка проверки: ${entry.error}`
  } else {
    return
  }
  const notification = new Notification({ title: `OBSERVA — ${storeName}`, body })
  notification.on('click', () => openWindow('analytics'))
  notification.show()
}

function formatNotifyPrice(price, currency) {
  if (price == null) return '—'
  try { return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: currency || 'RUB', maximumFractionDigits: 0 }).format(price) }
  catch { return `${price} ${currency || ''}`.trim() }
}

const DEFAULT_SETTINGS = {
  autoStartMonitoring: true,
  closeToTray: true,
  launchAtLogin: true,
  startMinimized: true,
  defaultCheckIntervalMin: 60,
  maxConcurrentChecks: 3,
  notifyPriceChanges: true,
  ownStoreFavicon: null
}

function normalizeSettings(value = {}) {
  const validIntervals = new Set([15, 30, 60, 180, 720, 1440])
  const concurrency = Number(value.maxConcurrentChecks)
  return {
    autoStartMonitoring: value.autoStartMonitoring !== false,
    closeToTray: value.closeToTray !== false,
    launchAtLogin: value.launchAtLogin !== false,
    startMinimized: value.startMinimized !== false,
    defaultCheckIntervalMin: validIntervals.has(Number(value.defaultCheckIntervalMin)) ? Number(value.defaultCheckIntervalMin) : DEFAULT_SETTINGS.defaultCheckIntervalMin,
    maxConcurrentChecks: Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 8 ? concurrency : DEFAULT_SETTINGS.maxConcurrentChecks,
    notifyPriceChanges: value.notifyPriceChanges !== false,
    ownStoreFavicon: typeof value.ownStoreFavicon === 'string' && value.ownStoreFavicon.startsWith('data:image/') ? value.ownStoreFavicon : null
  }
}

function saveSettings(patch) {
  appSettings = normalizeSettings({ ...appSettings, ...patch })
  fs.writeFileSync(settingsFilePath, JSON.stringify(appSettings, null, 2), 'utf8')
  if (priceChecker) {
    priceChecker.maxConcurrentChecks = appSettings.maxConcurrentChecks
    if (appSettings.autoStartMonitoring && !priceChecker.running) priceChecker.start()
    else if (!appSettings.autoStartMonitoring && priceChecker.running) priceChecker.stop()
  }
  if (process.platform === 'win32') {
    app.setLoginItemSettings({
      openAtLogin: appSettings.launchAtLogin,
      args: appSettings.startMinimized ? ['--hidden'] : []
    })
  }
  updateTrayMenu()
  return appSettings
}

function invalidateAnalytics() {
  analyticsSummaryCache = null
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:data-changed')
}

function getAnalyticsSummary() {
  if (!analyticsSummaryCache) analyticsSummaryCache = analyzer.buildSummary(storeService.getAll())
  return analyticsSummaryCache
}

function openWindow(page) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  if (!page) return
  if (mainWindow.webContents.isLoading()) {
    pendingNavigation = page
    return
  }
  mainWindow.webContents.send('app:navigate', page)
}

function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) return
  const loginItem = process.platform === 'win32' ? app.getLoginItemSettings() : { openAtLogin: false }
  const template = [
    { label: 'АНАЛИЗ', enabled: false },
    { label: 'Обзор', click: () => openWindow('dashboard') },
    { label: 'Сравнения цен', click: () => openWindow('analytics') },
    { type: 'separator' },
    { label: 'УПРАВЛЕНИЕ', enabled: false },
    { label: 'Мониторинг', click: () => openWindow('monitoring') },
    { label: 'Источники', click: () => openWindow('stores') },
    { label: 'Настройки', click: () => openWindow('settings') },
    { type: 'separator' },
    {
      label: trayCheckingAll ? 'Обновление цен…' : 'Обновить цены',
      enabled: !trayCheckingAll,
      click: async () => {
        if (!priceChecker || trayCheckingAll) return
        trayCheckingAll = true
        updateTrayMenu()
        try {
          await priceChecker.checkAll()
          tray.setToolTip('OBSERVA — проверка цен завершена')
        } catch (error) {
          console.error('[OBSERVA] Ошибка обновления цен из системного трея:', error)
          tray.setToolTip('OBSERVA — не удалось обновить цены')
        } finally {
          trayCheckingAll = false
          updateTrayMenu()
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Запускать при входе в Windows',
      type: 'checkbox',
      checked: Boolean(appSettings?.launchAtLogin ?? loginItem.openAtLogin),
      click: item => {
        saveSettings({ launchAtLogin: item.checked })
      }
    },
    { label: 'Открыть OBSERVA', click: () => openWindow() },
    { label: 'Выйти из OBSERVA', click: () => { isQuitting = true; app.quit() } }
  ]
  tray.setContextMenu(Menu.buildFromTemplate(template))
}

function createTray() {
  if (tray) return
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon-app.png')
    : path.join(__dirname, '../icon-app.png')
  const image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) {
    console.error('[OBSERVA] Не удалось загрузить иконку системного трея:', iconPath)
    return
  }
  tray = new Tray(image.resize({ width: 16, height: 16 }))
  tray.setToolTip('OBSERVA — мониторинг цен')
  tray.on('click', () => openWindow())
  updateTrayMenu()
}

function parseWebUrl(value) {
  let parsed
  try { parsed = new URL(value) } catch { throw new Error('Укажите корректный URL сайта') }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('Поддерживаются только HTTP/HTTPS ссылки без логина и пароля в URL')
  }
  return parsed.href
}

const SETUP_FORMAT = 'observa-source-setup'
const SETUP_VERSION = 1
const SETUP_INTERVALS = new Set([15, 30, 60, 180, 720, 1440])

function normalizeSetupSource(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Источник ${index + 1}: ожидался объект`)
  const sourceType = raw.sourceType === 'telegram' ? 'telegram' : raw.sourceType === 'website' ? 'website' : null
  const role = raw.role === 'own' ? 'own' : raw.role === 'competitor' ? 'competitor' : null
  if (!sourceType || !role) throw new Error(`Источник ${index + 1}: неизвестный тип источника или роль`)
  const interval = Number(raw.checkIntervalMin)
  if (!SETUP_INTERVALS.has(interval)) throw new Error(`Источник ${index + 1}: интервал проверки не поддерживается`)

  let url
  if (sourceType === 'telegram') {
    let parsed
    try { parsed = new URL(String(raw.url || '')) } catch { throw new Error(`Источник ${index + 1}: некорректная ссылка Telegram`) }
    if (!['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me'].includes(parsed.hostname.toLowerCase()) || parsed.username || parsed.password) {
      throw new Error(`Источник ${index + 1}: разрешены только публичные ссылки t.me`)
    }
    const parts = parsed.pathname.split('/').filter(Boolean)
    const channel = (parts[0]?.toLowerCase() === 's' ? parts[1] : parts[0]) || ''
    if (!/^[a-z][a-z0-9_]{4,31}$/i.test(channel)) throw new Error(`Источник ${index + 1}: ссылка должна вести на публичный канал Telegram`)
    url = `https://t.me/s/${channel}`
  } else {
    url = parseWebUrl(String(raw.url || ''))
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    const ipVersion = net.isIP(hostname)
    const parts = hostname.split('.').map(Number)
    const privateV4 = ipVersion === 4 && (parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0] >= 224 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168))
    const privateV6 = ipVersion === 6 && (/^(::1|::|fc|fd|fe80)/i.test(hostname))
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || privateV4 || privateV6) {
      throw new Error(`Источник ${index + 1}: локальные адреса нельзя загрузить из файла настроек`)
    }
  }

  const name = String(raw.name || '').trim().slice(0, 120) || new URL(url).hostname
  const category = String(raw.category || 'general').trim().slice(0, 80) || 'general'
  return { name, url, role, sourceType, category, checkIntervalMin: interval, enabled: raw.enabled !== false }
}

function parseSetupConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.format !== SETUP_FORMAT || value.version !== SETUP_VERSION) {
    throw new Error('Файл не является совместимой конфигурацией OBSERVA')
  }
  if (!Array.isArray(value.sources) || value.sources.length > 500) throw new Error('В файле должно быть не более 500 источников')
  return { format: SETUP_FORMAT, version: SETUP_VERSION, sources: value.sources.map(normalizeSetupSource) }
}

function setupSourceKey(source) {
  const parsed = new URL(source.url)
  parsed.hash = ''
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  return `${source.sourceType}|${source.role}|${parsed.href.replace(/\/$/, '')}`
}

function previewSetupImport(config) {
  const used = new Set()
  const existing = storeService.getAll()
  const sources = config.sources.map(source => {
    const key = setupSourceKey(source)
    const match = existing.find(store => !used.has(store.id) && setupSourceKey({ ...source, url: store.url, sourceType: store.sourceType || source.sourceType, role: store.role || 'competitor' }) === key)
    if (match) used.add(match.id)
    return { ...source, action: match ? 'update' : 'add' }
  })
  return { sources, addedCount: sources.filter(source => source.action === 'add').length, updatedCount: sources.filter(source => source.action === 'update').length }
}

function createWindow() {
  const startHidden = process.argv.includes('--hidden') || (appSettings?.startMinimized && appSettings?.launchAtLogin && app.getLoginItemSettings().wasOpenedAtLogin)
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon-app.png')
    : path.join(__dirname, '../icon-app.png')
  const isMac = process.platform === 'darwin'
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#131313',
    icon: iconPath,
    show: false,
    frame: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    title: 'OBSERVA',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !app.isPackaged
    }
  })

  if (!startHidden) createSplash()

  if (process.env.VITE_DEV_SERVER_URL || !app.isPackaged) {
    mainWindow.loadURL('http://127.0.0.1:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close()
    splashWindow = null
    if (!startHidden) mainWindow?.show()
  })
  mainWindow.on('closed', () => { mainWindow = null })
  mainWindow.on('close', event => {
    if (isQuitting) return
    if (appSettings?.closeToTray !== false) {
      event.preventDefault()
      mainWindow.hide()
    } else {
      isQuitting = true
      app.quit()
    }
  })
  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingNavigation) {
      mainWindow.webContents.send('app:navigate', pendingNavigation)
      pendingNavigation = null
    }
  })
}

function createSplash() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="544" height="616" viewBox="0 0 544 616"><defs><radialGradient id="g" cx="0" cy="0" r="1" gradientTransform="matrix(-272 615 -544 -240.165 544 0.277)" gradientUnits="userSpaceOnUse"><stop stop-color="white"/><stop offset="1" stop-color="#8D8D8D"/></radialGradient><mask id="m"><path d="M413.734 83.939 544 0v512.962L413.734 615.555V83.939Z M206.408 208.5l131.184-83.973v388.394L206.408 615.555V208.5Z M0 344l130.266-83.855v252.921L0 615.555V344Z" fill="white"/></mask></defs><rect width="544" height="616" fill="url(#g)" mask="url(#m)"/></svg>`
  splashWindow = new BrowserWindow({
    width: 520, height: 340, frame: false, resizable: false, show: false,
    center: true, backgroundColor: '#131313', skipTaskbar: true, alwaysOnTop: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;background:#131313}body{display:grid;place-items:center}.logo{width:92px;height:auto;filter:drop-shadow(0 8px 24px rgba(255,255,255,.08))}</style></head><body><img class="logo" alt="OBSERVA" src="data:image/svg+xml,${encodeURIComponent(svg)}"></body></html>`
  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  splashWindow.once('ready-to-show', () => { if (splashWindow && !splashWindow.isDestroyed()) splashWindow.show() })
}

app.whenReady().then(() => {
  const dataDir = path.join(app.getPath('userData'), 'observa-data')
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

  settingsFilePath = path.join(dataDir, 'settings.json')
  try { appSettings = normalizeSettings(JSON.parse(fs.readFileSync(settingsFilePath, 'utf8'))) }
  catch {
    const osLaunchSetting = process.platform === 'win32' ? app.getLoginItemSettings() : null
    appSettings = normalizeSettings({ ...DEFAULT_SETTINGS, ...(osLaunchSetting ? { launchAtLogin: osLaunchSetting.openAtLogin } : {}) })
    fs.writeFileSync(settingsFilePath, JSON.stringify(appSettings, null, 2), 'utf8')
  }
  if (process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: appSettings.launchAtLogin, args: appSettings.startMinimized ? ['--hidden'] : [] })

  storeService = new StoreService(path.join(dataDir, 'stores.json'))
  analyzer = new Analyzer(storeService)
  priceChecker = new PriceChecker(storeService, analyzer, (event, payload) => {
    invalidateAnalytics()
    if (event === 'price:changed' && payload?.storeId) {
      const entry = pendingPriceNotifications.get(payload.storeId) || { changes: [], error: null }
      entry.changes.push(payload)
      pendingPriceNotifications.set(payload.storeId, entry)
    } else if ((event === 'store:error' || event === 'store:checked') && payload?.storeId) {
      const entry = pendingPriceNotifications.get(payload.storeId) || { changes: [], error: null }
      if (event === 'store:error') entry.error = payload.error || 'ошибка проверки'
      flushPriceNotification(payload.storeId)
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('monitor:event', { event, ...payload })
    }
  })

  priceChecker.maxConcurrentChecks = appSettings.maxConcurrentChecks
  if (appSettings.autoStartMonitoring) priceChecker.start()

  createWindow()
  createTray()
  setupAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // The app remains available from the system tray until the user selects Exit.
})

app.on('before-quit', () => { isQuitting = true })

// ---------- IPC: магазины ----------
ipcMain.handle('stores:list', () => storeService.getAll())
ipcMain.handle('stores:get', (_, id) => storeService.getById(id))
ipcMain.handle('stores:add', (_, store) => { const result = storeService.add(store); invalidateAnalytics(); return result })
ipcMain.handle('stores:update', (_, id, patch) => {
  if (patch && typeof patch === 'object' && 'customIcon' in patch) {
    const value = patch.customIcon
    patch = { ...patch, customIcon: typeof value === 'string' && value.startsWith('data:image/') && value.length <= 500_000 ? value : null }
  }
  const result = storeService.update(id, patch); invalidateAnalytics(); return result
})
ipcMain.handle('stores:remove', (_, id) => { const result = storeService.remove(id); invalidateAnalytics(); return result })
ipcMain.handle('stores:addProduct', (_, storeId, product) => { const result = storeService.addProduct(storeId, product); invalidateAnalytics(); return result })
ipcMain.handle('stores:removeProduct', (_, storeId, productId) => { const result = storeService.removeProduct(storeId, productId); invalidateAnalytics(); return result })
ipcMain.handle('stores:removeProducts', (_, storeId, productIds) => { const result = storeService.removeProducts(storeId, Array.isArray(productIds) ? productIds : []); invalidateAnalytics(); return result })
ipcMain.handle('stores:updateProduct', (_, storeId, productId, patch) => {
  if (!patch || typeof patch !== 'object') throw new Error('Некорректные данные товара')
  const normalized = {}
  if (patch.name !== undefined) {
    normalized.name = String(patch.name).trim().slice(0, 300)
    if (!normalized.name) throw new Error('Название товара не может быть пустым')
  }
  if (patch.price !== undefined) {
    normalized.price = patch.price === null || patch.price === '' ? null : Number(patch.price)
    if (normalized.price !== null && (!Number.isFinite(normalized.price) || normalized.price < 0)) throw new Error('Укажите корректную цену')
  }
  if (patch.url !== undefined) normalized.url = patch.url ? parseWebUrl(String(patch.url).trim()) : null
  if (patch.currency !== undefined) normalized.currency = String(patch.currency).trim().toUpperCase().slice(0, 8) || 'RUB'
  if (patch.manualFields !== undefined) normalized.manualFields = {
    name: Boolean(patch.manualFields?.name), price: Boolean(patch.manualFields?.price), url: Boolean(patch.manualFields?.url)
  }
  const result = storeService.updateProduct(storeId, productId, normalized)
  invalidateAnalytics()
  return result
})

// ---------- IPC: перенос настроек источников ----------
ipcMain.handle('sources:exportSetup', async () => {
  const sources = storeService.getAll().map(store => normalizeSetupSource({
    name: store.name,
    url: store.url,
    role: store.role || 'competitor',
    sourceType: store.sourceType || (/^https?:\/\/(?:www\.)?t\.me\//i.test(store.url || '') ? 'telegram' : 'website'),
    category: store.category,
    checkIntervalMin: SETUP_INTERVALS.has(Number(store.checkIntervalMin)) ? Number(store.checkIntervalMin) : 60,
    enabled: store.enabled
  }, 0))
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Экспорт настроек OBSERVA',
    defaultPath: 'observa-sources.json',
    filters: [{ name: 'Конфигурация OBSERVA', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePath) return { saved: false, count: 0 }
  const config = { format: SETUP_FORMAT, version: SETUP_VERSION, exportedAt: new Date().toISOString(), sources }
  await fs.promises.writeFile(result.filePath, JSON.stringify(config, null, 2), 'utf8')
  return { saved: true, count: sources.length }
})

ipcMain.handle('sources:readSetup', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Загрузить настройки OBSERVA',
    properties: ['openFile'],
    filters: [{ name: 'Конфигурация OBSERVA', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePaths[0]) return null
  const filePath = result.filePaths[0]
  const stat = await fs.promises.stat(filePath)
  if (stat.size > 2 * 1024 * 1024) throw new Error('Файл настроек слишком большой (максимум 2 МБ)')
  let parsed
  try { parsed = JSON.parse(await fs.promises.readFile(filePath, 'utf8')) }
  catch { throw new Error('Не удалось прочитать JSON. Проверьте файл настроек.') }
  const config = parseSetupConfig(parsed)
  return { fileName: path.basename(filePath), ...previewSetupImport(config) }
})

ipcMain.handle('sources:applySetup', (_, incoming) => {
  const config = parseSetupConfig({ format: SETUP_FORMAT, version: SETUP_VERSION, sources: incoming })
  const plan = previewSetupImport(config)
  let addedCount = 0
  let updatedCount = 0
  const used = new Set()
  for (const source of plan.sources) {
    const key = setupSourceKey(source)
    const existing = storeService.getAll().find(store => !used.has(store.id) && setupSourceKey({ ...source, url: store.url, sourceType: store.sourceType || source.sourceType, role: store.role || 'competitor' }) === key)
    if (existing) {
      used.add(existing.id)
      storeService.update(existing.id, {
        name: source.name, url: source.url, role: source.role, sourceType: source.sourceType,
        category: source.category, checkIntervalMin: source.checkIntervalMin, enabled: source.enabled
      })
      updatedCount++
    } else {
      storeService.add(source)
      addedCount++
    }
  }
  invalidateAnalytics()
  return { addedCount, updatedCount }
})

// ---------- IPC: мониторинг ----------
ipcMain.handle('monitor:status', () => priceChecker.getStatus())
ipcMain.handle('monitor:startAtLogin', () => process.platform === 'win32' && app.getLoginItemSettings().openAtLogin)
ipcMain.handle('monitor:setStartAtLogin', (_, enabled) => {
  if (process.platform !== 'win32') return false
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled), args: ['--hidden'] })
  updateTrayMenu()
  return app.getLoginItemSettings().openAtLogin
})
ipcMain.handle('monitor:start', () => { priceChecker.start(); return priceChecker.getStatus() })
ipcMain.handle('monitor:stop', () => { priceChecker.stop(); return priceChecker.getStatus() })
ipcMain.handle('monitor:checkNow', (_, storeId) => priceChecker.checkStore(storeId))
ipcMain.handle('monitor:checkAll', () => priceChecker.checkAll({ includeDisabled: true }))
ipcMain.handle('monitor:cancelChecks', () => priceChecker.cancelPending())
ipcMain.handle('monitor:history', (_, storeId, productId) => storeService.getHistory(storeId, productId))
ipcMain.handle('monitor:products', (_, storeId) => storeService.getProducts(storeId))
ipcMain.handle('monitor:fetchPage', async (_, url, sourceType = 'website', storeId = null) => {
  const reportProgress = storeId
    ? payload => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('monitor:event', { event: 'monitor:progress', storeId, ...payload }) }
    : null
  if (sourceType === 'telegram') {
    const { fetchTelegramChannel } = require(path.join(__dirname, 'services/telegramFetcher.cjs'))
    return fetchTelegramChannel(url)
  }
  const { fetchAndParse } = require(path.join(__dirname, 'services/fetcher.cjs'))
  return fetchAndParse(parseWebUrl(url), reportProgress)
})
ipcMain.handle('monitor:openExternal', (_, url) => shell.openExternal(parseWebUrl(url)))
ipcMain.handle('favicon:resolve', async (_, url) => {
  try {
    const { resolveFavicon } = require(path.join(__dirname, 'services/favicon.cjs'))
    return await resolveFavicon(parseWebUrl(url))
  } catch { return [] }
})

// ---------- IPC: обновления ----------
ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('update:status', () => ({ ...updateState, packaged: app.isPackaged, version: app.getVersion() }))
ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) return { ok: false, error: 'Автообновление доступно только в установленной версии приложения' }
  try {
    sendUpdateEvent({ status: 'checking', error: null })
    await autoUpdater.checkForUpdates()
    return { ok: true }
  } catch (error) {
    sendUpdateEvent({ status: 'error', error: error?.message || String(error) })
    return { ok: false, error: error?.message || String(error) }
  }
})
ipcMain.handle('update:download', () => {
  if (app.isPackaged && updateState.status === 'available') autoUpdater.downloadUpdate().catch(() => {})
})
ipcMain.handle('update:install', () => {
  if (app.isPackaged && updateState.status === 'downloaded') autoUpdater.quitAndInstall()
})

// ---------- IPC: окно ----------
ipcMain.handle('window:minimize', () => mainWindow?.minimize())
ipcMain.handle('window:toggleMaximize', () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
})
ipcMain.handle('window:close', () => mainWindow?.close())
ipcMain.handle('settings:get', () => appSettings)
ipcMain.handle('settings:update', (_, patch) => {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Некорректные настройки')
  const allowed = ['autoStartMonitoring', 'closeToTray', 'launchAtLogin', 'startMinimized', 'defaultCheckIntervalMin', 'maxConcurrentChecks', 'ownStoreFavicon']
  const safePatch = Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.includes(key)))
  return saveSettings(safePatch)
})

// ---------- IPC: аналитика ----------
ipcMain.handle('analytics:summary', () => getAnalyticsSummary())
ipcMain.handle('analytics:similarProducts', (_, storeId, productId) => {
  const stores = storeService.getAll()
  const store = stores.find(s => s.id === storeId)
  const product = store?.products.find(p => p.id === productId)
  if (!product) return null
  const summary = getAnalyticsSummary()
  const ref = `${storeId}|${productId}`
  const imageByRef = new Map(summary.allOffers.map(offer => [`${offer.storeId}|${offer.productId}`, offer.imageUrl]))
  const toOffer = offer => ({
    productId: offer.productId,
    productName: offer.productName,
    storeId: offer.storeId,
    storeName: offer.storeName,
    storeKey: offer.storeKey,
    role: offer.role,
    sourceType: offer.sourceType,
    price: offer.price,
    currency: offer.currency,
    lastChecked: offer.lastChecked || null,
    url: offer.url || null,
    imageUrl: offer.imageUrl || imageByRef.get(`${offer.storeId}|${offer.productId}`) || null,
    category: offer.category || 'general',
    history: storeService.getHistory(offer.storeId, offer.productId).slice(-300)
  })
  // Мягкое сопоставление по всем известным предложениям: длительности и
  // SKU-атрибуты игнорируются — «Telegram Premium» и «Telegram Premium 3
  // месяца» считаются одним продуктом. Тот же similarityCore, что и в
  // движке аналитики, плюс уважение к парам, разделённым пользователем.
  const target = normalizeMatchName(cleanComparableName(product.name))
  const separatedPairKeys = new Set((storeService.getComparisonRules().separatedPairs || [])
    .map(pair => JSON.stringify(pair.slice().sort())))
  const isSeparatedFromTarget = offer => separatedPairKeys.has(JSON.stringify([ref, `${offer.storeId}|${offer.productId}`].sort()))
  const keywordOffers = target.key
    ? summary.allOffers
        .filter(offer => !(offer.storeId === storeId && offer.productId === productId) && offer.price != null && !isSeparatedFromTarget(offer))
        .map(offer => ({ offer, match: normalizeMatchName(cleanComparableName(offer.productName)) }))
        .filter(({ match }) => match.key && similarityCore(target, match) >= 0.5)
        .map(({ offer }) => toOffer(offer))
    : []

  const byPrice = (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)
  const row = summary.priceMatrix.find(r => r.offers.some(offer => `${offer.storeId}|${offer.productId}` === ref))
  if (row) {
    // Union of the strict comparison group and keyword matches from other groups.
    const selfOffer = {
      productId: product.id, productName: product.name, storeId, storeName: store.name,
      storeKey: '', role: store.role === 'own' ? 'own' : 'competitor',
      sourceType: store.sourceType === 'telegram' ? 'telegram' : 'website',
      price: product.price ?? null, currency: product.currency || 'RUB',
      lastChecked: product.lastChecked || null, url: product.url || store.url,
      imageUrl: product.imageUrl || null, category: product.category || 'general',
      history: storeService.getHistory(storeId, product.id).slice(-300)
    }
    const merged = new Map()
    for (const offer of [...row.offers.map(toOffer), ...keywordOffers, toOffer(selfOffer)]) {
      merged.set(`${offer.storeId}|${offer.productId}`, offer)
    }
    return { productName: row.productName, currency: row.currency, offers: [...merged.values()].sort(byPrice) }
  }

  // The product never reached the comparison matrix (no price or singleton
  // competitor) — keyword matches are the answer.
  return { productName: product.name, currency: product.currency || 'RUB', offers: keywordOffers.sort(byPrice) }
})
ipcMain.handle('analytics:priceDynamics', (_, storeId, productId) =>
  storeService.getHistory(storeId, productId))
ipcMain.handle('analytics:saveMatch', (_, refs, label) => {
  if (!Array.isArray(refs) || refs.length > 100) throw new Error('Выбрано слишком много предложений')
  storeService.setManualMatch(refs, label)
  invalidateAnalytics()
})
ipcMain.handle('analytics:separateMatch', (_, refs) => {
  if (!Array.isArray(refs) || refs.length > 100) throw new Error('Выбрано слишком много предложений')
  storeService.separateMatch(refs)
  invalidateAnalytics()
})

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
}
function priceLabel(price, currency) {
  return price == null ? '—' : `${Number(price).toLocaleString('ru-RU')} ${currency || 'RUB'}`
}
function csvCell(value) {
  let text = String(value ?? '')
  if (/^[\u0000-\u0020]*[=+@\-]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}
function validateMatrix(rows) {
  if (!Array.isArray(rows) || rows.length > 20000) throw new Error('Некорректная сводная таблица')
  return rows
}

ipcMain.handle('analytics:exportCsv', async (_, rows) => {
  validateMatrix(rows)
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Экспорт сводки в Excel',
    defaultPath: 'observa-price-summary.csv',
    filters: [{ name: 'CSV для Excel', extensions: ['csv'] }]
  })
  if (result.canceled || !result.filePath) return false
  const headers = ['Товар', 'Валюта', 'Мой магазин', 'Моя цена', 'Лучший конкурент', 'Цена конкурента', 'Разница (моя цена - цена конкурента)', 'Разница, %', 'Все предложения', 'Ссылка на источник']
  const lines = [headers.map(csvCell).join(';')]
  for (const row of rows) {
    const own = row.ownOffers?.[0]
    const best = row.bestCompetitor
    const offers = (row.offers || []).map(offer => `${offer.storeName}: ${priceLabel(offer.price, offer.currency)}`).join(' | ')
    lines.push([
      row.productName,
      row.currency,
      own?.storeName || '',
      own ? priceLabel(own.price, own.currency) : '',
      best?.storeName || '',
      best ? priceLabel(best.price, best.currency) : '',
      row.difference == null ? '' : priceLabel(row.difference, row.currency),
      row.differencePercent == null ? '' : `${Number(row.differencePercent).toFixed(1)}%`,
      offers,
      own?.url || best?.url || ''
    ].map(csvCell).join(';'))
  }
  await fs.promises.writeFile(result.filePath, `\uFEFF${lines.join('\r\n')}`, 'utf8')
  return true
})

ipcMain.handle('analytics:exportExcel', async (_, rows) => {
  validateMatrix(rows)
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Экспорт сводки цен в Excel',
    defaultPath: 'observa-price-summary.xlsx',
    filters: [{ name: 'Книга Excel', extensions: ['xlsx'] }]
  })
  if (result.canceled || !result.filePath) return false

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'OBSERVA'
  workbook.created = new Date()
  workbook.modified = new Date()

  const addTableSheet = (name, headers, rows, widths, numericColumns = []) => {
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
    sheet.columns = headers.map((header, index) => ({ header, key: `c${index}`, width: widths[index] || 18 }))
    sheet.addRows(rows)
    sheet.autoFilter = { from: 'A1', to: `${sheet.getColumn(headers.length).letter}${Math.max(1, rows.length + 1)}` }
    sheet.getRow(1).height = 28
    sheet.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF252525' } }
      cell.alignment = { vertical: 'middle', wrapText: true }
    })
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        row.height = 22
        row.eachCell(cell => {
          cell.alignment = { vertical: 'middle', wrapText: true }
          cell.border = { bottom: { style: 'hair', color: { argb: 'FFE4E7EB' } } }
        })
        if (rowNumber % 2 === 0) row.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F6F8' } } })
      }
    })
    for (const column of numericColumns) sheet.getColumn(column).numFmt = '#,##0.00;[Red]-#,##0.00'
    return sheet
  }

  const safeLink = value => /^https?:\/\//i.test(String(value || '')) ? String(value) : ''
  const summaryRows = rows.map(row => {
    const own = row.ownOffers?.[0]
    const best = row.bestCompetitor
    const sourceUrl = safeLink(own?.url || best?.url)
    return [
      row.productName || '', row.currency || '', own?.storeName || '', own?.price ?? null,
      best?.storeName || '', best?.price ?? null, row.difference ?? null,
      row.differencePercent == null ? null : Number(row.differencePercent) / 100,
      (row.offers || []).length, (row.matchedNames || []).join(' · '),
      sourceUrl ? { text: sourceUrl, hyperlink: sourceUrl } : ''
    ]
  })
  const summarySheet = addTableSheet('Сводка', [
    'Услуга / тариф', 'Валюта', 'Мой магазин', 'Моя цена', 'Лучший конкурент', 'Цена конкурента',
    'Разница', 'Разница, %', 'Предложений', 'Названия в источниках', 'Ссылка на источник'
  ], summaryRows, [34, 12, 24, 16, 26, 18, 16, 14, 14, 42, 48], [4, 6, 7])
  summarySheet.getColumn(8).numFmt = '0.0%'
  summarySheet.getColumn(11).font = { color: { argb: 'FF1677FF' }, underline: true }

  const detailRows = rows.flatMap(row => (row.offers || []).map(offer => {
    const sourceUrl = safeLink(offer.url)
    return [
      row.productName || '', offer.storeName || '', offer.role === 'own' ? 'Мой магазин' : 'Конкурент',
      offer.price ?? null, offer.currency || row.currency || '', offer.lastChecked ? new Date(offer.lastChecked) : null,
      row.matchConfidence == null ? null : Number(row.matchConfidence),
      sourceUrl ? { text: sourceUrl, hyperlink: sourceUrl } : ''
    ]
  }))
  const detailSheet = addTableSheet('Все предложения', [
    'Сопоставленная услуга', 'Источник', 'Роль', 'Цена', 'Валюта', 'Проверено', 'Уверенность совпадения', 'Ссылка'
  ], detailRows, [34, 28, 18, 16, 12, 22, 23, 48], [4])
  detailSheet.getColumn(6).numFmt = 'dd.mm.yyyy hh:mm'
  detailSheet.getColumn(7).numFmt = '0%'
  detailSheet.getColumn(8).font = { color: { argb: 'FF1677FF' }, underline: true }

  await workbook.xlsx.writeFile(result.filePath)
  return true
})

ipcMain.handle('analytics:exportPdf', async (_, rows) => {
  validateMatrix(rows)
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Сохранить сводку цен в PDF',
    defaultPath: 'observa-price-summary.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  if (result.canceled || !result.filePath) return false
  const tableRows = rows.map(row => {
    const own = row.ownOffers?.[0]
    const best = row.bestCompetitor
    const all = (row.offers || []).map(offer => `${escapeHtml(offer.storeName)}: ${escapeHtml(priceLabel(offer.price, offer.currency))}`).join('<br>')
    return `<tr><td>${escapeHtml(row.productName)}</td><td>${escapeHtml(own?.storeName || '—')}</td><td>${escapeHtml(own ? priceLabel(own.price, own.currency) : '—')}</td><td>${escapeHtml(best?.storeName || '—')}</td><td>${escapeHtml(best ? priceLabel(best.price, best.currency) : '—')}</td><td>${escapeHtml(row.difference == null ? '—' : priceLabel(row.difference, row.currency))}</td><td>${escapeHtml(row.differencePercent == null ? '—' : `${Number(row.differencePercent).toFixed(1)}%`)}</td><td>${all || '—'}</td></tr>`
  }).join('')
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Сводка цен OBSERVA</title><style>
    @page{size:A4 landscape;margin:12mm}body{font:10px Arial,sans-serif;color:#171717}h1{font-size:20px;margin:0 0 5px}.meta{color:#555;margin:0 0 14px}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}th,td{padding:6px 7px;border:1px solid #cfd3da;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eceff3;font-size:9px}tr{break-inside:auto;page-break-inside:auto}tbody tr:nth-child(even){background:#f8f9fb}small{color:#555}
    </style><h1>Сводка цен OBSERVA</h1><p class="meta">Сформировано: ${escapeHtml(new Date().toLocaleString('ru-RU'))} · Строк: ${rows.length}</p><table><thead><tr><th>Товар</th><th>Мой магазин</th><th>Моя цена</th><th>Лучший конкурент</th><th>Цена конкурента</th><th>Разница</th><th>Разница, %</th><th>Все предложения</th></tr></thead><tbody>${tableRows}</tbody></table></html>`
  const pdfWindow = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  try {
    await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const pdf = await pdfWindow.webContents.printToPDF({ pageSize: 'A4', landscape: true, printBackground: true, margins: { top: 0.3, bottom: 0.3, left: 0.3, right: 0.3 } })
    await fs.promises.writeFile(result.filePath, pdf)
    return true
  } finally { if (!pdfWindow.isDestroyed()) pdfWindow.destroy() }
})
