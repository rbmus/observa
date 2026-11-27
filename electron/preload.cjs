const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('observa', {
  platform: process.platform,
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsUpdate: (patch) => ipcRenderer.invoke('settings:update', patch),
  // stores
  storesList: () => ipcRenderer.invoke('stores:list'),
  storesGet: (id) => ipcRenderer.invoke('stores:get', id),
  storesAdd: (store) => ipcRenderer.invoke('stores:add', store),
  storesUpdate: (id, patch) => ipcRenderer.invoke('stores:update', id, patch),
  storesRemove: (id) => ipcRenderer.invoke('stores:remove', id),
  storesAddProduct: (storeId, product) => ipcRenderer.invoke('stores:addProduct', storeId, product),
  storesRemoveProduct: (storeId, productId) => ipcRenderer.invoke('stores:removeProduct', storeId, productId),
  storesRemoveProducts: (storeId, productIds) => ipcRenderer.invoke('stores:removeProducts', storeId, productIds),
  storesUpdateProduct: (storeId, productId, patch) => ipcRenderer.invoke('stores:updateProduct', storeId, productId, patch),
  sourcesExportSetup: () => ipcRenderer.invoke('sources:exportSetup'),
  sourcesReadSetup: () => ipcRenderer.invoke('sources:readSetup'),
  sourcesApplySetup: (sources) => ipcRenderer.invoke('sources:applySetup', sources),

  // monitor
  monitorStatus: () => ipcRenderer.invoke('monitor:status'),
  monitorStartAtLogin: () => ipcRenderer.invoke('monitor:startAtLogin'),
  monitorSetStartAtLogin: (enabled) => ipcRenderer.invoke('monitor:setStartAtLogin', enabled),
  monitorStart: () => ipcRenderer.invoke('monitor:start'),
  monitorStop: () => ipcRenderer.invoke('monitor:stop'),
  monitorCheckNow: (storeId) => ipcRenderer.invoke('monitor:checkNow', storeId),
  monitorCheckAll: () => ipcRenderer.invoke('monitor:checkAll'),
  monitorCancelChecks: () => ipcRenderer.invoke('monitor:cancelChecks'),
  monitorHistory: (storeId, productId) => ipcRenderer.invoke('monitor:history', storeId, productId),
  monitorProducts: (storeId) => ipcRenderer.invoke('monitor:products', storeId),
  monitorFetchPage: (url, sourceType, storeId) => ipcRenderer.invoke('monitor:fetchPage', url, sourceType, storeId),
  openExternal: (url) => ipcRenderer.invoke('monitor:openExternal', url),
  faviconResolve: (url) => ipcRenderer.invoke('favicon:resolve', url),
  onMonitorEvent: (cb) => {
    const listener = (_, data) => cb(data)
    ipcRenderer.on('monitor:event', listener)
    return () => ipcRenderer.removeListener('monitor:event', listener)
  },
  onAppNavigate: (cb) => {
    const listener = (_, page) => cb(page)
    ipcRenderer.on('app:navigate', listener)
    return () => ipcRenderer.removeListener('app:navigate', listener)
  },
  onDataChanged: (cb) => {
    const listener = () => cb()
    ipcRenderer.on('app:data-changed', listener)
    return () => ipcRenderer.removeListener('app:data-changed', listener)
  },

  // window
  winMinimize: () => ipcRenderer.invoke('window:minimize'),
  winToggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  winClose: () => ipcRenderer.invoke('window:close'),

  // updates
  appVersion: () => ipcRenderer.invoke('app:version'),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  onUpdateEvent: (cb) => {
    const listener = (_, data) => cb(data)
    ipcRenderer.on('update:event', listener)
    return () => ipcRenderer.removeListener('update:event', listener)
  },

  // analytics
  analyticsSummary: () => ipcRenderer.invoke('analytics:summary'),
  analyticsSimilarProducts: (storeId, productId) => ipcRenderer.invoke('analytics:similarProducts', storeId, productId),
  analyticsPriceDynamics: (storeId, productId) => ipcRenderer.invoke('analytics:priceDynamics', storeId, productId),
  analyticsSaveMatch: (refs, label) => ipcRenderer.invoke('analytics:saveMatch', refs, label),
  analyticsSeparateMatch: (refs) => ipcRenderer.invoke('analytics:separateMatch', refs),
  analyticsExportCsv: (rows) => ipcRenderer.invoke('analytics:exportCsv', rows),
  analyticsExportExcel: (rows) => ipcRenderer.invoke('analytics:exportExcel', rows),
  analyticsExportPdf: (rows) => ipcRenderer.invoke('analytics:exportPdf', rows)
})
