const fs = require('fs')
const crypto = require('crypto')
const path = require('path')
const { cleanTelegramName } = require('./telegramText.cjs')

class StoreService {
  constructor(filePath) {
    this.filePath = filePath
    this._normalizationChanged = false
    this.data = this._load()
    if (this._normalizationChanged) this._save()
    else this._createDailyBackup()
  }

  _backupPath(date = new Date().toISOString().slice(0, 10)) {
    return `${this.filePath}.backup-${date}`
  }

  _createDailyBackup() {
    try {
      if (!fs.existsSync(this.filePath)) return
      const backupPath = this._backupPath()
      if (!fs.existsSync(backupPath)) fs.copyFileSync(this.filePath, backupPath)
      const prefix = `${path.basename(this.filePath)}.backup-`
      const backups = fs.readdirSync(path.dirname(this.filePath))
        .filter(name => name.startsWith(prefix))
        .sort().reverse()
      for (const old of backups.slice(14)) fs.rmSync(path.join(path.dirname(this.filePath), old), { force: true })
    } catch (error) {
      console.error('[OBSERVA] Не удалось создать резервную копию:', error.message)
    }
  }

  _normalizeData(data) {
    data.stores = (data.stores || []).map(store => {
      const sourceType = store.sourceType || (/^https?:\/\/(?:www\.)?t\.me\//i.test(store.url || '') ? 'telegram' : 'website')
      return {
        ...store,
        role: store.role || 'competitor',
        sourceType,
        products: (store.products || []).map(product => {
          const manualFields = product.manualFields || {}
          const name = sourceType === 'telegram' && !manualFields.name
            ? cleanTelegramName(product.name) || 'Предложение из Telegram'
            : product.name
          if (name !== product.name) this._normalizationChanged = true
          return { ...product, name, manualFields }
        })
      }
    })
    data.priceHistory = data.priceHistory || {}
    data.manualMatches = Array.isArray(data.manualMatches) ? data.manualMatches : []
    data.separatedPairs = Array.isArray(data.separatedPairs) ? data.separatedPairs : []
    // GC: правила сравнения ссылаются на товары по id — после удаления
    // источников/товаров вне штатных методов (ручная правка файла, старые
    // версии) в данных остаются «висячие» ссылки. Чистим их при загрузке.
    const validRefs = new Set()
    for (const store of data.stores) {
      for (const product of store.products || []) validRefs.add(`${store.id}|${product.id}`)
    }
    const rulesBefore = JSON.stringify([data.manualMatches, data.separatedPairs])
    data.manualMatches = data.manualMatches
      .map(group => ({ ...group, refs: (group.refs || []).filter(ref => validRefs.has(`${ref.storeId}|${ref.productId}`)) }))
      .filter(group => group.refs.length > 1)
    data.separatedPairs = data.separatedPairs.filter(pair => Array.isArray(pair) && pair.length === 2 && pair.every(key => validRefs.has(key)))
    if (JSON.stringify([data.manualMatches, data.separatedPairs]) !== rulesBefore) this._normalizationChanged = true
    return data
  }

  _load() {
    if (!fs.existsSync(this.filePath)) return this._normalizeData({ stores: [], priceHistory: {} })
    try {
      return this._normalizeData(JSON.parse(fs.readFileSync(this.filePath, 'utf-8')))
    } catch (error) {
      console.error('[OBSERVA] Основной файл данных повреждён, ищу резервную копию:', error.message)
      const directory = path.dirname(this.filePath)
      const prefix = `${path.basename(this.filePath)}.backup-`
      const backups = fs.readdirSync(directory).filter(name => name.startsWith(prefix)).sort().reverse()
      for (const name of backups) {
        try {
          const data = this._normalizeData(JSON.parse(fs.readFileSync(path.join(directory, name), 'utf-8')))
          console.warn(`[OBSERVA] Данные восстановлены из ${name}`)
          const restorePath = `${this.filePath}.${process.pid}.restore.tmp`
          fs.copyFileSync(path.join(directory, name), restorePath)
          fs.renameSync(restorePath, this.filePath)
          return data
        } catch (backupError) {
          console.error(`[OBSERVA] Резервная копия ${name} повреждена:`, backupError.message)
        }
      }
    }
    return this._normalizeData({ stores: [], priceHistory: {} })
  }

  _save() {
    this._createDailyBackup()
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`
    const serialized = JSON.stringify(this.data, null, 2)
    let descriptor
    try {
      descriptor = fs.openSync(temporaryPath, 'w')
      fs.writeFileSync(descriptor, serialized, 'utf-8')
      fs.fsyncSync(descriptor)
      fs.closeSync(descriptor)
      descriptor = null
      fs.renameSync(temporaryPath, this.filePath)
    } catch (error) {
      if (descriptor != null) fs.closeSync(descriptor)
      try { fs.rmSync(temporaryPath, { force: true }) } catch { /* ignore temp cleanup errors */ }
      throw error
    }
  }

  getAll() {
    return this.data.stores
  }

  getById(id) {
    return this.data.stores.find(s => s.id === id) || null
  }

  add(store) {
    const now = new Date().toISOString()
    const newStore = {
      id: crypto.randomUUID(),
      name: store.name || 'Без названия',
      url: store.url,
      category: store.category || 'general',
      role: store.role === 'own' ? 'own' : 'competitor',
      sourceType: store.sourceType === 'telegram' ? 'telegram' : 'website',
      checkIntervalMin: store.checkIntervalMin || 60,
      enabled: store.enabled !== false,
      products: store.products || [],
      lastCheck: null,
      status: 'idle', // idle | checking | ok | error
      lastError: null,
      createdAt: now,
      updatedAt: now
    }
    this.data.stores.push(newStore)
    this._save()
    return newStore
  }

  update(id, patch) {
    const idx = this.data.stores.findIndex(s => s.id === id)
    if (idx === -1) return null
    this.data.stores[idx] = {
      ...this.data.stores[idx],
      ...patch,
      id: this.data.stores[idx].id,
      updatedAt: new Date().toISOString()
    }
    this._save()
    return this.data.stores[idx]
  }

  remove(id) {
    this.data.stores = this.data.stores.filter(s => s.id !== id)
    // чистим историю
    for (const key of Object.keys(this.data.priceHistory)) {
      if (key.startsWith(id + ':')) delete this.data.priceHistory[key]
    }
    const hasRef = ref => ref.storeId === id
    this.data.manualMatches = this.data.manualMatches.map(group => ({ ...group, refs: group.refs.filter(ref => !hasRef(ref)) })).filter(group => group.refs.length > 1)
    const refPrefix = `${id}|`
    this.data.separatedPairs = this.data.separatedPairs.filter(pair => !pair.some(key => key.startsWith(refPrefix)))
    this._save()
    return true
  }

  addProduct(storeId, product, options = {}) {
    const store = this.getById(storeId)
    if (!store) return null
    const newProduct = {
      id: crypto.randomUUID(),
      name: product.name || 'Товар без названия',
      url: product.url || null,
      sourceUrl: product.sourceUrl || product.url || null,
      price: product.price != null ? Number(product.price) : null,
      currency: product.currency || 'RUB',
      imageUrl: product.imageUrl || null,
      sourceKey: product.sourceKey || null,
      manualFields: product.manualFields || {},
      category: product.category || 'general',
      lastChecked: null,
      createdAt: new Date().toISOString()
    }
    store.products.push(newProduct)
    if (options.save !== false) this._save()
    return newProduct
  }

  removeProduct(storeId, productId) {
    const store = this.getById(storeId)
    if (!store) return false
    store.products = store.products.filter(p => p.id !== productId)
    delete this.data.priceHistory[`${storeId}:${productId}`]
    const removedRef = `${storeId}|${productId}`
    this.data.manualMatches = this.data.manualMatches.map(group => ({ ...group, refs: group.refs.filter(ref => `${ref.storeId}|${ref.productId}` !== removedRef) })).filter(group => group.refs.length > 1)
    this.data.separatedPairs = this.data.separatedPairs.filter(pair => !pair.includes(removedRef))
    this._save()
    return true
  }

  removeProducts(storeId, productIds) {
    const store = this.getById(storeId)
    if (!store) return 0
    const ids = new Set(productIds)
    const before = store.products.length
    store.products = store.products.filter(p => !ids.has(p.id))
    for (const productId of ids) {
      delete this.data.priceHistory[`${storeId}:${productId}`]
      const removedRef = `${storeId}|${productId}`
      this.data.manualMatches = this.data.manualMatches.map(group => ({ ...group, refs: group.refs.filter(ref => `${ref.storeId}|${ref.productId}` !== removedRef) })).filter(group => group.refs.length > 1)
      this.data.separatedPairs = this.data.separatedPairs.filter(pair => !pair.includes(removedRef))
    }
    const removed = before - store.products.length
    if (removed) this._save()
    return removed
  }

  updateProduct(storeId, productId, patch) {
    const store = this.getById(storeId)
    const product = store?.products.find(item => item.id === productId)
    if (!product) return null
    Object.assign(product, patch, { id: product.id })
    this._save()
    return product
  }

  getComparisonRules() {
    return { manualMatches: this.data.manualMatches, separatedPairs: this.data.separatedPairs }
  }

  setManualMatch(refs, label) {
    const uniqueRefs = [...new Map(refs.map(ref => [`${ref.storeId}|${ref.productId}`, { storeId: ref.storeId, productId: ref.productId }])).values()]
    if (uniqueRefs.length < 2) throw new Error('Для совпадения выберите минимум два предложения')
    const sourceKeys = new Set()
    const currencyCodes = new Set()
    for (const ref of uniqueRefs) {
      const product = this.getById(ref.storeId)?.products.find(item => item.id === ref.productId)
      if (!product || product.price == null) throw new Error('Некоторые предложения уже удалены или не имеют цены')
      if (sourceKeys.has(ref.storeId)) throw new Error('В группе может быть только одно предложение от источника')
      sourceKeys.add(ref.storeId)
      currencyCodes.add(String(product.currency || 'RUB').toUpperCase())
    }
    if (currencyCodes.size !== 1) throw new Error('Нельзя сравнивать предложения в разных валютах')
    const selected = new Set(uniqueRefs.map(ref => `${ref.storeId}|${ref.productId}`))
    const retained = []
    for (const group of this.data.manualMatches) {
      const refsLeft = group.refs.filter(ref => !selected.has(`${ref.storeId}|${ref.productId}`))
      if (refsLeft.length > 1) retained.push({ ...group, refs: refsLeft })
    }
    this.data.manualMatches = [...retained, { id: crypto.randomUUID(), label: String(label || '').slice(0, 160), refs: uniqueRefs }]
    const allSelected = new Set(uniqueRefs.map(ref => `${ref.storeId}|${ref.productId}`))
    this.data.separatedPairs = this.data.separatedPairs.filter(pair => !pair.every(key => allSelected.has(key)))
    this._save()
  }

  separateMatch(refs) {
    const uniqueRefs = [...new Map(refs.map(ref => [`${ref.storeId}|${ref.productId}`, { storeId: ref.storeId, productId: ref.productId }])).values()]
    const selected = new Set(uniqueRefs.map(ref => `${ref.storeId}|${ref.productId}`))
    this.data.manualMatches = this.data.manualMatches.map(group => ({
      ...group,
      refs: group.refs.filter(ref => !selected.has(`${ref.storeId}|${ref.productId}`))
    })).filter(group => group.refs.length > 1)
    const existing = new Set(this.data.separatedPairs.map(pair => pair.slice().sort().join('|')))
    for (let left = 0; left < uniqueRefs.length; left++) for (let right = left + 1; right < uniqueRefs.length; right++) {
      const pair = [`${uniqueRefs[left].storeId}|${uniqueRefs[left].productId}`, `${uniqueRefs[right].storeId}|${uniqueRefs[right].productId}`].sort()
      const key = pair.join('|')
      if (!existing.has(key)) { existing.add(key); this.data.separatedPairs.push(pair) }
    }
    this._save()
  }

  getProducts(storeId) {
    const store = this.getById(storeId)
    return store ? store.products : []
  }

  // ---------- История цен ----------
  recordPrice(storeId, productId, price, currency = 'RUB', options = {}) {
    const key = `${storeId}:${productId}`
    if (!this.data.priceHistory[key]) this.data.priceHistory[key] = []
    const history = this.data.priceHistory[key]
    const last = history[history.length - 1]
    const now = new Date().toISOString()
    if (last && last.price === price &&
        new Date(now) - new Date(last.timestamp) < 60 * 1000) {
      return // не дублируем в течение минуты
    }
    history.push({ timestamp: now, price: Number(price), currency })
    // храним максимум 1000 точек на товар
    if (history.length > 1000) history.splice(0, history.length - 1000)
    if (options.save !== false) this._save()
  }

  getHistory(storeId, productId) {
    return this.data.priceHistory[`${storeId}:${productId}`] || []
  }

  getAllHistory(storeId) {
    const result = {}
    for (const [key, value] of Object.entries(this.data.priceHistory)) {
      if (key.startsWith(storeId + ':')) {
        result[key.split(':')[1]] = value
      }
    }
    return result
  }
}

module.exports = { StoreService }
