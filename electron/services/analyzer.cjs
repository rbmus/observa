const { getDomain } = require('tldts')

const NUMBER_WORDS = {
  one: '1', first: '1', один: '1', одна: '1', одного: '1',
  two: '2', two_months: '2', два: '2', две: '2', двух: '2',
  three: '3', три: '3', трёх: '3', трех: '3',
  four: '4', четыре: '4', четырёх: '4', четырех: '4',
  five: '5', пять: '5', шесть: '6', семь: '7', восемь: '8', девять: '9', двенадцать: '12'
}
const GENERIC_WORDS = new Set(['subscription', 'subscriptions', 'подписка', 'подписки', 'подписку', 'тариф', 'тарифа', 'тарифы', 'план', 'плана', 'планов', 'service', 'услуга', 'услуги', 'доступ', 'access', 'цена', 'price', 'оплата', 'платёж', 'платеж', 'за', 'на', 'в', 'для', 'per', 'month', 'months', 'monthly', 'месяц', 'месяца', 'месяцев', 'мес', 'год', 'года', 'лет', 'year', 'years', 'yearly', 'annual', 'annually', 'день', 'дня', 'дней', 'day', 'days', 'daily', 'неделя', 'недели', 'недель', 'week', 'weeks', 'weekly', 'популярный', 'популярная', 'popular', 'скидка', 'экономия', 'save'])
const UNIT_MONTHS = { month: 1, year: 12, week: 0.25, day: 1 / 30 }
const INVALID_PRODUCT_NAME = /ничего не выбрано|выберите приложения|товар без названия|без названия|^(?:поддержк\p{L}*|support(?:\s+service)?)$/iu

function cleanComparableName(value) {
  return String(value || '').replace(/[\u00a0\u202f]/g, ' ')
    .replace(/\d[\d\s.,]*\s*(?:₽|руб(?:лей|ля)?|р\.|rub|usd|eur|€|\$|gbp|£)(?:\s*\/\s*(?:шт\.?|мес\.?|month))?/giu, ' ')
    .replace(/[−–—-]\s*\d+(?:[.,]\d+)?\s*%/g, ' ')
    .replace(/(?<![\p{L}\p{N}])(?:популярн\p{L}*|popular)(?![\p{L}\p{N}])/giu, ' ')
    .replace(/(?:\s*[·|]\s*)?(?:\/\s*(?:мес\.?|месяц\p{L}*|months?))\s*$/iu, ' ')
    .replace(/(?<=[а-яё])\d{2,}(?=$|\s)/giu, '')
    .replace(/\s+/g, ' ').replace(/^[\s·|:–—-]+|[\s·|:–—-]+$/g, '').trim()
}

function normalizeMatchName(value) {
  let text = String(value || '').toLocaleLowerCase('ru').replace(/ё/g, 'е')
  text = text.replace(/[−–—-]\s*\d+(?:[.,]\d+)?\s*%/g, ' ')
    .replace(/\d[\d\s.,]*\s*(?:₽|руб(?:лей|ля)?|р\.|rub|usd|eur|€|\$|gbp|£)/giu, ' ')
    .replace(/(?<![\p{L}\p{N}])(?:мес\.?|месячн\p{L}*|monthly|months?|per\s*month)(?![\p{L}\p{N}])/giu, ' month ')
    .replace(/(?<![\p{L}\p{N}])(?:месяц\p{L}*|monthly|months?)(?![\p{L}\p{N}])/giu, ' month ')
    .replace(/(?<![\p{L}\p{N}])(?:годов\p{L}*|год\p{L}*|лет|annual(?:ly)?|yearly|years?)(?![\p{L}\p{N}])/giu, ' year ')
    .replace(/(?<![\p{L}\p{N}])(?:недел\p{L}*|weekly|weeks?)(?![\p{L}\p{N}])/giu, ' week ')
    .replace(/(?<![\p{L}\p{N}])(?:дневн\p{L}*|день|дня|дней|daily|days?)(?![\p{L}\p{N}])/giu, ' day ')
    .replace(/(?<![\p{L}\p{N}])(?:quarterly|quarter)(?![\p{L}\p{N}])/giu, ' 3 month ')
    .replace(/(?<![\p{L}\p{N}])(?:приложен\p{L}*|апп\p{L}*|applications?|apps?)(?![\p{L}\p{N}])/giu, ' app ')
  let tokens = text.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean).map(token => NUMBER_WORDS[token] || token)
  const periods = []
  const consumed = new Set()
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!['month', 'year', 'week', 'day'].includes(token)) continue
    let quantity = 1
    if (i > 0 && /^\d+$/.test(tokens[i - 1])) { quantity = Number(tokens[i - 1]); consumed.add(i - 1) }
    const months = Math.round(quantity * UNIT_MONTHS[token] * 100) / 100
    periods.push(months)
    consumed.add(i)
  }
  const otherNumbers = tokens.filter((token, index) => /^\d+$/.test(token) && !consumed.has(index)).sort((a, b) => Number(a) - Number(b))
  const words = tokens.filter((token, index) => !consumed.has(index) && !/^\d+$/.test(token) && !GENERIC_WORDS.has(token))
  const allTokens = [...words, ...periods.map(months => `duration${months}`), ...otherNumbers]
  const sorted = [...new Set(allTokens)].sort()
  return { key: sorted.join(' '), tokens: sorted, variant: `${periods.sort((a, b) => a - b).join(',')}|${otherNumbers.join(',')}` }
}

function similarity(a, b) {
  if (!a.key || !b.key) return 0
  if (a.key === b.key) return 1
  if (a.variant !== b.variant) return 0
  const hasDuration = name => name.tokens.some(token => token.startsWith('duration'))
  const coreTokens = name => name.tokens.filter(token => !token.startsWith('duration'))
  if (hasDuration(a) && hasDuration(b) && (!coreTokens(a).length || !coreTokens(b).length)) return 0.7
  const intersection = a.tokens.filter(token => b.tokens.includes(token)).length
  if (!intersection) return 0
  const tokenScore = 2 * intersection / (a.tokens.length + b.tokens.length)
  const left = a.key.replace(/\s/g, '')
  const right = b.key.replace(/\s/g, '')
  if (Math.min(left.length, right.length) < 5) return tokenScore
  const previous = Array.from({ length: right.length + 1 }, (_, i) => i)
  for (let i = 1; i <= left.length; i++) {
    let diagonal = previous[0]
    previous[0] = i
    for (let j = 1; j <= right.length; j++) {
      const old = previous[j]
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1))
      diagonal = old
    }
  }
  const textScore = 1 - previous[right.length] / Math.max(left.length, right.length)
  return Math.max(tokenScore, textScore * 0.92)
}

function storeIdentity(store) {
  try {
    const parsed = new URL(store.url)
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    if (store.sourceType === 'telegram') return `${host}/${parsed.pathname.split('/').filter(Boolean).filter(part => part !== 's').join('/')}`
    // Subdomains belong to the same seller (installios.ru / orders.installios.ru),
    // so comparisons treat them as one store instead of fake competitors.
    return getDomain(host) || host
  } catch { return String(store.name || store.id).toLocaleLowerCase('ru').trim() }
}

/**
 * Аналитический движок: сводки, динамика цен, сравнение магазинов.
 */
class Analyzer {
  constructor(storeService) {
    this.storeService = storeService
  }

  buildSummary(stores) {
    const totalProducts = stores.reduce((acc, s) => acc + s.products.length, 0)
    const enabledStores = stores.filter(s => s.enabled).length

    const allItems = []
    for (const store of stores) {
      for (const p of store.products) {
        allItems.push({ store, product: p })
      }
    }

    const allOffers = allItems.filter(({ product }) => String(product.name || '').trim() && !INVALID_PRODUCT_NAME.test(String(product.name || '').trim())).map(({ store, product }) => ({
      productId: product.id,
      productName: String(product.name).trim(),
      storeKey: storeIdentity(store),
      storeName: store.name,
      storeId: store.id,
      role: store.role === 'own' ? 'own' : 'competitor',
      sourceType: store.sourceType === 'telegram' ? 'telegram' : 'website',
      price: product.price == null || !Number.isFinite(Number(product.price)) ? null : Number(product.price),
      currency: product.currency || 'RUB',
      lastChecked: product.lastChecked || store.lastCheck || null,
      lastSuccessCheck: store.lastSuccessCheck || (store.status === 'ok' ? store.lastCheck : null),
      stale: store.enabled !== false && (!product.lastChecked || Date.now() - new Date(product.lastChecked).getTime() > Math.max(Number(store.checkIntervalMin || 60) * 2 * 60 * 1000, 60 * 60 * 1000)),
      staleAfterMs: Math.max(Number(store.checkIntervalMin || 60) * 2 * 60 * 1000, 60 * 60 * 1000),
      url: product.url || store.url,
      imageUrl: product.imageUrl || null,
      category: product.category || store.category || 'general'
    }))

    const prices = allItems.map(i => i.product.price).filter(p => p != null)
    const priceStats = prices.length ? {
      min: Math.min(...prices),
      max: Math.max(...prices),
      avg: prices.reduce((a, b) => a + b, 0) / prices.length,
      count: prices.length
    } : null

    const priceChanges = []
    const recentPriceChanges = []
    for (const store of stores) {
      for (const p of store.products) {
        if (INVALID_PRODUCT_NAME.test(String(p.name || '').trim())) continue
        const history = this.storeService
          ? this.storeService.getHistory(store.id, p.id)
          : []
        if (history.length >= 2) {
          const first = history[0].price
          const lastEntry = history[history.length - 1]
          const last = lastEntry.price
          const previous = history[history.length - 2]
          if (first > 0) {
            priceChanges.push({
              storeId: store.id,
              storeName: store.name,
              productId: p.id,
              productName: p.name,
              firstPrice: first,
              lastPrice: last,
              lastChangedAt: lastEntry.timestamp,
              currency: lastEntry.currency || p.currency || 'RUB',
              changePercent: ((last - first) / first) * 100,
              points: history.length
            })
            if (previous.price > 0) recentPriceChanges.push({
              storeId: store.id,
              storeName: store.name,
              productId: p.id,
              productName: p.name,
              firstPrice: previous.price,
              previousPrice: previous.price,
              lastPrice: last,
              changedAt: previous.timestamp,
              lastChangedAt: lastEntry.timestamp,
              currency: lastEntry.currency || p.currency || 'RUB',
              changePercent: ((last - previous.price) / previous.price) * 100,
              suspectedMismatch: Math.abs(((last - previous.price) / previous.price) * 100) > 200,
              points: history.length
            })
          }
        }
      }
    }

    priceChanges.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
    const uniquePriceChanges = new Map()
    for (const change of priceChanges) {
      const sourceStore = stores.find(store => store.id === change.storeId)
      const key = `${sourceStore ? storeIdentity(sourceStore) : change.storeId}|${normalizeMatchName(change.productName).key}`
      const existing = uniquePriceChanges.get(key)
      if (!existing || String(change.lastChangedAt).localeCompare(String(existing.lastChangedAt)) > 0) uniquePriceChanges.set(key, change)
    }
    const latestChangeByProduct = new Map()
    for (const change of recentPriceChanges) {
      const sourceStore = stores.find(store => store.id === change.storeId)
      const key = `${sourceStore ? storeIdentity(sourceStore) : change.storeId}|${normalizeMatchName(change.productName).key}`
      const existing = latestChangeByProduct.get(key)
      if (!existing || String(change.lastChangedAt).localeCompare(String(existing.lastChangedAt)) > 0) latestChangeByProduct.set(key, change)
    }
    const candidateMap = new Map()
    for (const { store, product } of allItems) {
      if (product.price == null || !Number.isFinite(Number(product.price))) continue
      const currency = product.currency || 'RUB'
      const originalName = String(product.name || '').trim()
      if (INVALID_PRODUCT_NAME.test(originalName)) continue
      const productName = cleanComparableName(originalName)
      if (INVALID_PRODUCT_NAME.test(productName)) continue
      const matchName = normalizeMatchName(productName)
      if (!matchName.key) continue
      const candidate = {
        matchName,
        productId: product.id,
        productName,
        nameQuality: Number(originalName === productName) * 100 - Math.max(0, originalName.length - productName.length) / 100,
        currency,
        storeId: store.id,
        storeKey: storeIdentity(store),
        storeName: store.name,
        role: store.role === 'own' ? 'own' : 'competitor',
        sourceType: store.sourceType === 'telegram' ? 'telegram' : 'website',
        price: Number(product.price),
        lastChecked: product.lastChecked || store.lastCheck || null,
        url: product.url || store.url
      }
      const key = `${candidate.storeKey}|${currency.toUpperCase()}|${matchName.key}`
      const existing = candidateMap.get(key)
      if (!existing || (candidate.role === 'own' && existing.role !== 'own') || (candidate.role === existing.role && (candidate.nameQuality > existing.nameQuality || (candidate.nameQuality === existing.nameQuality && String(candidate.lastChecked || '').localeCompare(String(existing.lastChecked || '')) > 0)))) candidateMap.set(key, candidate)
    }
    const candidates = [...candidateMap.values()]

    // Greedy, store-aware fuzzy matching: a comparison group never contains
    // two different offers from the same store or incompatible plan durations.
    const rules = this.storeService?.getComparisonRules?.() || { manualMatches: [], separatedPairs: [] }
    const refKey = offer => `${offer.storeId}|${offer.productId}`
    const separatedPairKeys = new Set((rules.separatedPairs || []).map(pair => JSON.stringify(pair.slice().sort())))
    const isSeparated = (left, right) => separatedPairKeys.has(JSON.stringify([refKey(left), refKey(right)].sort()))
    const groups = []
    const manuallyAssigned = new Set()
    const byRef = new Map(candidates.map(candidate => [refKey(candidate), candidate]))
    for (const match of rules.manualMatches || []) {
      const refs = (match.refs || []).map(ref => byRef.get(`${ref.storeId}|${ref.productId}`)).filter(Boolean)
      if (refs.length < 2 || new Set(refs.map(offer => offer.storeKey)).size !== refs.length || new Set(refs.map(offer => offer.currency.toUpperCase())).size !== 1) continue
      const combinedName = match.label || refs[0].productName
      groups.push({
        productName: combinedName,
        matchName: normalizeMatchName(combinedName),
        currency: refs[0].currency,
        offers: refs,
        confidence: 1,
        manual: true
      })
      refs.forEach(offer => manuallyAssigned.add(refKey(offer)))
    }
    const tokenIndex = new Map()
    candidates.filter(candidate => !manuallyAssigned.has(refKey(candidate))).sort((a, b) => b.matchName.tokens.length - a.matchName.tokens.length || a.productName.localeCompare(b.productName, 'ru')).forEach(candidate => {
      const candidateGroups = new Set()
      for (const token of candidate.matchName.tokens) for (const index of tokenIndex.get(token) || []) candidateGroups.add(index)
      let bestIndex = -1
      let bestScore = 0
      for (const index of candidateGroups) {
        const group = groups[index]
        if (group.manual) continue
        if (group.currency.toUpperCase() !== candidate.currency.toUpperCase()) continue
        if (group.offers.some(offer => offer.storeKey === candidate.storeKey)) continue
        if (group.offers.some(offer => isSeparated(candidate, offer))) continue
        const score = similarity(group.matchName, candidate.matchName)
        const periodOnly = group.matchName.tokens.some(token => token.startsWith('duration')) && candidate.matchName.tokens.some(token => token.startsWith('duration')) && (group.matchName.tokens.every(token => token.startsWith('duration')) || candidate.matchName.tokens.every(token => token.startsWith('duration')))
        const minimumScore = periodOnly ? 0.68 : Math.min(group.matchName.tokens.length, candidate.matchName.tokens.length) <= 1 ? 0.82 : 0.62
        if (score >= minimumScore && score > bestScore) { bestIndex = index; bestScore = score }
      }
      if (bestIndex < 0) {
        bestIndex = groups.length
        groups.push({ productName: candidate.productName, matchName: candidate.matchName, currency: candidate.currency, offers: [], confidence: 1 })
      } else {
        groups[bestIndex].confidence = Math.min(groups[bestIndex].confidence, bestScore)
      }
      groups[bestIndex].offers.push(candidate)
      for (const token of candidate.matchName.tokens) {
        if (!tokenIndex.has(token)) tokenIndex.set(token, new Set())
        tokenIndex.get(token).add(bestIndex)
      }
    })

    // Groups need offers from 2+ stores to count as a comparison — except own
    // offers, which always stay visible so nothing from our catalog is hidden.
    const priceMatrix = groups.filter(group => new Set(group.offers.map(offer => offer.storeKey)).size > 1 || group.offers.some(offer => offer.role === 'own')).map(group => {
      const offers = group.offers.map(({ matchName, ...offer }) => offer)
      const ownOffers = offers.filter(offer => offer.role === 'own').sort((a, b) => a.price - b.price)
      const competitorOffers = offers.filter(offer => offer.role === 'competitor')
      const bestCompetitor = competitorOffers.length
        ? [...competitorOffers].sort((a, b) => a.price - b.price)[0]
        : null
      const ownOffer = ownOffers.length ? ownOffers[0] : null
      const difference = ownOffer && bestCompetitor ? ownOffer.price - bestCompetitor.price : null
      return {
        productName: group.productName,
        currency: group.currency,
        matchedNames: [...new Set(offers.map(offer => offer.productName))],
        matchConfidence: group.confidence,
        manual: Boolean(group.manual),
        offers,
        ownOffers,
        bestCompetitor,
        difference,
        differencePercent: difference !== null && bestCompetitor.price > 0
          ? difference / bestCompetitor.price * 100
          : null
      }
    }).sort((a, b) => {
      if (a.ownOffers.length !== b.ownOffers.length) return b.ownOffers.length - a.ownOffers.length
      return a.productName.localeCompare(b.productName, 'ru')
    })

    const comparisons = priceMatrix.map(row => {
      const offerPrices = row.offers.map(offer => offer.price)
      return {
        name: row.productName,
        offers: row.offers,
        minPrice: Math.min(...offerPrices),
        maxPrice: Math.max(...offerPrices),
        spreadPercent: Math.min(...offerPrices) > 0 ? (Math.max(...offerPrices) - Math.min(...offerPrices)) / Math.min(...offerPrices) * 100 : 0
      }
    }).sort((a, b) => b.spreadPercent - a.spreadPercent)

    return {
      storesCount: stores.length,
      competitorStoresCount: stores.filter(s => s.role !== 'own').length,
      ownStoresCount: stores.filter(s => s.role === 'own').length,
      enabledStores,
      totalProducts,
      priceStats,
      topGainers: [...uniquePriceChanges.values()].filter(c => c.changePercent > 0).sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent)).slice(0, 10),
      topLosers: [...uniquePriceChanges.values()].filter(c => c.changePercent < 0).sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent)).slice(0, 10),
      recentPriceChanges: [...latestChangeByProduct.values()].sort((a, b) => String(b.lastChangedAt).localeCompare(String(a.lastChangedAt))).slice(0, 12),
      comparisons: comparisons.slice(0, 50),
      priceMatrix,
      allOffers,
      storesStatus: stores.map(s => ({
        id: s.id,
        name: s.name,
        status: s.status,
        productsCount: s.products.length,
        lastCheck: s.lastCheck,
        lastError: s.lastError
      }))
    }
  }
}

module.exports = { Analyzer, cleanComparableName, normalizeMatchName, similarity }
