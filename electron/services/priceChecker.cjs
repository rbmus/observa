const { fetchAndParse } = require('./fetcher.cjs')
const { fetchTelegramChannel } = require('./telegramFetcher.cjs')

/**
 * Движок мониторинга: 24/7 проверка цен с настраиваемым интервалом.
 */
class PriceChecker {
  constructor(storeService, analyzer, emit) {
    this.storeService = storeService
    this.analyzer = analyzer
    this.emit = emit || (() => {})
    this.running = false
    this.timer = null
    this.checkingStores = new Set()
    this.checkQueue = []
    this.inFlightChecks = new Map()
    this.activeChecks = 0
    this.maxConcurrentChecks = 3
    this.status = {
      running: false,
      startedAt: null,
      lastTickAt: null,
      totalChecks: 0,
      totalErrors: 0
    }
  }

  start() {
    if (this.running) return
    this.running = true
    this.status.running = true
    this.status.startedAt = new Date().toISOString()
    this._schedule(5000) // первый тик через 5 сек после старта
    console.log('[OBSERVA] Мониторинг запущен (24/7)')
  }

  stop() {
    this.running = false
    this.status.running = false
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    console.log('[OBSERVA] Мониторинг остановлен')
  }

  _schedule(delayMs) {
    if (!this.running) return
    this.timer = setTimeout(() => this._tick(), delayMs)
  }

  async _tick() {
    if (!this.running) return
    this.status.lastTickAt = new Date().toISOString()

    const stores = this.storeService.getAll().filter(s => s.enabled)
    for (const store of stores) {
      const intervalMs = (store.checkIntervalMin || 60) * 60 * 1000
      const lastCheck = store.lastCheck ? new Date(store.lastCheck).getTime() : 0
      if (Date.now() - lastCheck >= intervalMs) {
        this.checkStore(store.id).catch(e => console.error(`[OBSERVA] checkStore ${store.id}:`, e.message))
      }
    }

    // следующий тик через 1 минуту
    this._schedule(60 * 1000)
  }

  async checkStore(storeId) {
    if (this.inFlightChecks.has(storeId)) return this.inFlightChecks.get(storeId)
    const store = this.storeService.getById(storeId)
    if (!store) return { ok: false, error: 'store not found' }

    const promise = new Promise((resolve, reject) => {
      this.checkQueue.push({ storeId, resolve, reject })
      this._pumpQueue()
    })
    this.inFlightChecks.set(storeId, promise)
    return promise
  }

  _pumpQueue() {
    while (this.activeChecks < this.maxConcurrentChecks && this.checkQueue.length) {
      const job = this.checkQueue.shift()
      this.activeChecks++
      this.checkingStores.add(job.storeId)
      this._performCheck(job.storeId)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.activeChecks--
          this.checkingStores.delete(job.storeId)
          this.inFlightChecks.delete(job.storeId)
          this._pumpQueue()
        })
    }
  }

  async _performCheck(storeId) {
    const store = this.storeService.getById(storeId)
    if (!store) return { ok: false, error: 'store not found' }
    this.storeService.update(storeId, { status: 'checking' })
    this.emit('store:checking', { storeId })

    try {
      const result = store.sourceType === 'telegram'
        ? await fetchTelegramChannel(store.url)
        : await fetchAndParse(store.url)
      const now = new Date().toISOString()

      // обновляем/добавляем товары
      const existingByName = new Map(
        store.products.map(p => [p.sourceKey ? `source:${p.sourceKey}` : `name:${p.name.toLowerCase()}`, p])
      )
      const existingByUrl = new Map()
      const existingUrlCounts = new Map()
      const productUrlKey = value => {
        try { const parsedUrl = new URL(value); return `${parsedUrl.origin}${parsedUrl.pathname}` }
        catch { return null }
      }
      for (const product of store.products) {
        const key = (product.sourceUrl || product.url) && productUrlKey(product.sourceUrl || product.url)
        if (key) {
          existingUrlCounts.set(key, (existingUrlCounts.get(key) || 0) + 1)
          existingByUrl.set(key, product)
        }
      }
      for (const [key, count] of existingUrlCounts) if (count !== 1) existingByUrl.delete(key)
      const parsedUrlCounts = new Map()
      for (const parsed of result.products) {
        const key = parsed.url && productUrlKey(parsed.url)
        if (key) parsedUrlCounts.set(key, (parsedUrlCounts.get(key) || 0) + 1)
      }

      let added = 0, updated = 0
      const matchedProductIds = new Set()
      for (const parsed of result.products) {
        const key = parsed.sourceKey ? `source:${parsed.sourceKey}` : `name:${parsed.name.toLowerCase()}`
        // Match a product-specific URL too, so a better title from structured
        // data can repair a previously noisy heuristic name without losing history.
        const urlKey = parsed.url && productUrlKey(parsed.url)
        const existing = existingByName.get(key) || (urlKey && parsedUrlCounts.get(urlKey) === 1 && existingByUrl.get(urlKey))
        if (existing) {
          matchedProductIds.add(existing.id)
          const oldPrice = existing.price
          if (oldPrice !== parsed.price && !existing.manualFields?.price) {
            this.storeService.recordPrice(storeId, existing.id, parsed.price, parsed.currency, { save: false })
            this.emit('price:changed', {
              storeId,
              productId: existing.id,
              productName: existing.name,
              oldPrice,
              newPrice: parsed.price,
              currency: parsed.currency,
              changePercent: oldPrice ? ((parsed.price - oldPrice) / oldPrice * 100) : null
            })
          }
          if (!existing.manualFields?.price) {
            existing.price = parsed.price
            existing.currency = parsed.currency
          }
          if (parsed.name && !existing.manualFields?.name) existing.name = parsed.name
          existing.lastChecked = now
          if (parsed.url) existing.sourceUrl = parsed.url
          if (parsed.imageUrl) existing.imageUrl = parsed.imageUrl
          if (parsed.url && !existing.manualFields?.url) existing.url = parsed.url
          existingByName.set(parsed.sourceKey ? `source:${parsed.sourceKey}` : `name:${parsed.name.toLowerCase()}`, existing)
          updated++
        } else {
          const product = this.storeService.addProduct(storeId, {
            name: parsed.name,
            url: parsed.url,
            sourceUrl: parsed.url,
            price: parsed.price,
            currency: parsed.currency,
            imageUrl: parsed.imageUrl,
            sourceKey: parsed.sourceKey || null
          }, { save: false })
          matchedProductIds.add(product.id)
          this.storeService.recordPrice(storeId, product.id, parsed.price, parsed.currency, { save: false })
          added++
        }
      }

      // Автоочистка: предложения, которых больше нет на странице, удаляем —
      // но только если парсинг вернул достаточно товаров (защита от частичной
      // загрузки JS-страницы) и не трогаем поля, закреплённые вручную.
      const isLocked = product => Boolean(product.manualFields?.name || product.manualFields?.url || product.manualFields?.price)
      const prunable = store.products.filter(product => !isLocked(product) && !matchedProductIds.has(product.id))
      const autoCount = store.products.filter(product => !isLocked(product)).length
      const parsedCount = result.products.length
      let removed = 0
      if (parsedCount > 0 && parsedCount >= Math.max(2, Math.ceil(autoCount / 2))) {
        removed = this.storeService.removeProducts(storeId, prunable.map(product => product.id))
      }

      this.storeService.update(storeId, {
        status: 'ok',
        lastCheck: now,
        lastSuccessCheck: now,
        lastError: null,
        pageTitle: result.title
      })

      this.status.totalChecks++
      this.emit('store:checked', {
        storeId,
        title: result.title,
        productsFound: result.products.length,
        added,
        updated,
        removed,
        checkedAt: now
      })

      return { ok: true, title: result.title, productsFound: result.products.length, added, updated, removed }
    } catch (err) {
      this.status.totalErrors++
      const message = err.response
        ? `HTTP ${err.response.status}`
        : err.message
      this.storeService.update(storeId, {
        status: 'error',
        lastCheck: new Date().toISOString(),
        lastError: message
      })
      this.emit('store:error', { storeId, error: message })
      return { ok: false, error: message }
    }
  }

  async checkAll({ includeDisabled = false } = {}) {
    const stores = this.storeService.getAll().filter(s => includeDisabled || s.enabled)
    return Promise.all(stores.map(async store => ({ storeId: store.id, ...(await this.checkStore(store.id)) })))
  }

  getStatus() {
    return {
      ...this.status,
      checkingStores: [...this.checkingStores]
    }
  }
}

module.exports = { PriceChecker }
