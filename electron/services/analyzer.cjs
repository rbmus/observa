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

// Канонические kind-ы для атрибута «N <единица>»: русские и английские
// варианты одного понятия должны давать одинаковый variant, иначе
// «Netflix 4 устройства» и «Netflix 4 devices» не совпадут.
function attributeKind(kind) {
  if (/^(?:устройств|devices?|screens?|экран)/u.test(kind)) return 'device'
  if (/^(?:профил|profiles?)/u.test(kind)) return 'profile'
  if (/^(?:аккаунт|accounts?)/u.test(kind)) return 'account'
  if (/^(?:пользовател|users?)/u.test(kind)) return 'user'
  if (/^(?:лицензи|licenses?)/u.test(kind)) return 'license'
  return kind
}

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
  // SKU-атрибуты (объём памяти, качество видео, число устройств/профилей)
  // выносим в variant: «iPhone 15 128GB» и «iPhone 15 256GB» — разные товары,
  // а «Netflix 4K» и «Netflix HD» сравнивать по цене некорректно.
  const attributes = []
  text = text
    .replace(/(\d+(?:[.,]\d+)?)\s*(тб|гб|tb|gb)(?![\p{L}\p{N}])/giu, (match, amount, unit) => {
      const normalizedUnit = unit.startsWith('т') || unit === 'tb' ? 'tb' : 'gb'
      attributes.push(`size${String(amount).replace(',', '.')} ${normalizedUnit}`)
      return ' '
    })
    .replace(/(?<![\p{L}\p{N}])(4k|uhd|fhd|full\s*hd|ultra\s*hd|hd)(?![\p{L}\p{N}])/giu, match => {
      const compact = match.replace(/\s+/g, '')
      const quality = compact === 'ultrahd' ? 'uhd' : compact === 'fullhd' ? 'fhd' : compact
      attributes.push(`quality${quality}`)
      return ' '
    })
    .replace(/(\d+)\s*(устройств\p{L}*|devices?|screens?|экран\p{L}*|профил\p{L}*|profiles?|аккаунт\p{L}*|accounts?|пользовател\p{L}*|users?|лицензи\p{L}*|licenses?)/giu, (match, amount, kind) => {
      attributes.push(`count${amount} ${attributeKind(kind)}`)
      return ' '
    })
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
  const attributeKey = [...new Set(attributes)].sort().join(',')
  return { key: sorted.join(' '), tokens: sorted, variant: `${periods.sort((a, b) => a - b).join(',')}|${otherNumbers.join(',')}|${attributeKey}` }
}

function similarity(a, b) {
  if (!a.key || !b.key) return 0
  // variant проверяем до key: SKU-атрибуты (объём, качество, число устройств)
  // не входят в tokens/key, поэтому «iPhone 128GB» и «iPhone 256GB» имеют
  // одинаковый key, но обязаны не совпадать.
  if (a.variant !== b.variant) return 0
  if (a.key === b.key) return 1
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

// Мягкая похожесть без variant-гейта: длительности и SKU-атрибуты не учитываются.
// Используется для подсказок «похожие товары», где «Telegram Premium» и
// «Telegram Premium 3 месяца» — один и тот же продукт.
function similarityCore(a, b) {
  if (!a.key || !b.key) return 0
  const coreTokens = name => name.tokens.filter(token => !token.startsWith('duration') && !/^\d+$/.test(token))
  const left = coreTokens(a)
  const right = coreTokens(b)
  if (!left.length || !right.length) return 0
  const intersection = left.filter(token => right.includes(token)).length
  if (!intersection) return 0
  return (2 * intersection) / (left.length + right.length)
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
      const matchName = normalizeMatchName(change.productName)
      const key = `${sourceStore ? storeIdentity(sourceStore) : change.storeId}|${matchName.key}|${matchName.variant}`
      const existing = uniquePriceChanges.get(key)
      if (!existing || String(change.lastChangedAt).localeCompare(String(existing.lastChangedAt)) > 0) uniquePriceChanges.set(key, change)
    }
    const latestChangeByProduct = new Map()
    for (const change of recentPriceChanges) {
      const sourceStore = stores.find(store => store.id === change.storeId)
      const matchName = normalizeMatchName(change.productName)
      const key = `${sourceStore ? storeIdentity(sourceStore) : change.storeId}|${matchName.key}|${matchName.variant}`
      const existing = latestChangeByProduct.get(key)
      if (!existing || String(change.lastChangedAt).localeCompare(String(existing.lastChangedAt)) > 0) latestChangeByProduct.set(key, change)
    }
    const candidateBuckets = new Map()
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
      // variant входит в ключ бакета: «Netflix 4K» и «Netflix HD» имеют
      // одинаковый key, но это разные SKU — не должны дедуплицироваться.
      const key = `${candidate.storeKey}|${currency.toUpperCase()}|${matchName.key}|${matchName.variant}`
      if (!candidateBuckets.has(key)) candidateBuckets.set(key, [])
      candidateBuckets.get(key).push(candidate)
    }
    // Несколько листингов с одинаковым нормализованным именем могут
    // существовать в одном магазине (разные цены/условия). Лучший становится
    // оффером сравнения, остальные сохраняем в sameNameOffers — они больше
    // не теряются молча.
    const candidates = []
    for (const bucket of candidateBuckets.values()) {
      bucket.sort((a, b) => {
        const roleDiff = (b.role === 'own' ? 1 : 0) - (a.role === 'own' ? 1 : 0)
        if (roleDiff) return roleDiff
        if (b.nameQuality !== a.nameQuality) return b.nameQuality - a.nameQuality
        const checked = String(b.lastChecked || '').localeCompare(String(a.lastChecked || ''))
        if (checked) return checked
        return a.price - b.price
      })
      const [best, ...rest] = bucket
      if (rest.length) best.sameNameOffers = rest.slice(0, 10).map(item => item.productName)
      candidates.push(best)
    }

    // Store-aware fuzzy matching: a comparison group never contains
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
    // Union-find clustering: кандидаты объединяются в группы сравнения по
    // рёбрам «похожести». Рёбра обрабатываются от большего score к меньшему,
    // поэтому результат не зависит от порядка обхода; несовместимые объединения
    // (тот же магазин, разные валюты, разделённые пользователем пары)
    // отклоняются, а не «побеждают» молча.
    const autoCandidates = candidates
      .filter(candidate => !manuallyAssigned.has(refKey(candidate)))
      .sort((a, b) => b.matchName.tokens.length - a.matchName.tokens.length || a.productName.localeCompare(b.productName, 'ru'))
    const candidateByRef = new Map(autoCandidates.map(candidate => [refKey(candidate), candidate]))
    const parent = new Map(autoCandidates.map(candidate => [refKey(candidate), refKey(candidate)]))
    const findRoot = key => {
      let root = key
      while (parent.get(root) !== root) root = parent.get(root)
      let current = key
      while (parent.get(current) !== current) { const next = parent.get(current); parent.set(current, root); current = next }
      return root
    }
    const clusters = new Map()
    for (const candidate of autoCandidates) {
      clusters.set(refKey(candidate), {
        offers: [candidate],
        storeKeys: new Set([candidate.storeKey]),
        currency: candidate.currency.toUpperCase(),
        rep: candidate,
        confidence: 1
      })
    }
    const preferRep = (candidate, current) => candidate.matchName.tokens.length > current.matchName.tokens.length ||
      (candidate.matchName.tokens.length === current.matchName.tokens.length && candidate.matchName.key.length > current.matchName.key.length)
    const minimumScoreFor = (left, right) => {
      const hasDuration = name => name.tokens.some(token => token.startsWith('duration'))
      const periodOnly = hasDuration(left) && hasDuration(right) && (left.tokens.every(token => token.startsWith('duration')) || right.tokens.every(token => token.startsWith('duration')))
      return periodOnly ? 0.68 : Math.min(left.tokens.length, right.tokens.length) <= 1 ? 0.82 : 0.62
    }
    // Пары кандидатов находим через инвертированный индекс по токенам.
    // Слишком частые токены пропускаем — они почти не несут сигнала и
    // взрывают число пар.
    const MAX_POSTING = 300
    const tokenPostings = new Map()
    for (const candidate of autoCandidates) {
      for (const token of candidate.matchName.tokens) {
        if (!tokenPostings.has(token)) tokenPostings.set(token, [])
        tokenPostings.get(token).push(candidate)
      }
    }
    const pairScores = new Map()
    for (const posting of tokenPostings.values()) {
      if (posting.length < 2 || posting.length > MAX_POSTING) continue
      for (let left = 0; left < posting.length; left++) {
        for (let right = left + 1; right < posting.length; right++) {
          const a = posting[left]
          const b = posting[right]
          if (a.storeKey === b.storeKey) continue
          if (a.currency.toUpperCase() !== b.currency.toUpperCase()) continue
          const pairKey = JSON.stringify([refKey(a), refKey(b)].sort())
          if (pairScores.has(pairKey)) continue
          const score = similarity(a.matchName, b.matchName)
          if (score >= 0.4) pairScores.set(pairKey, score)
        }
      }
    }
    const edges = [...pairScores.entries()]
      .map(([pairKey, score]) => {
        const [leftRef, rightRef] = JSON.parse(pairKey)
        return { leftRef, rightRef, score }
      })
      .sort((a, b) => b.score - a.score)
    for (const edge of edges) {
      const leftRoot = findRoot(edge.leftRef)
      const rightRoot = findRoot(edge.rightRef)
      if (leftRoot === rightRoot) continue
      const leftCluster = clusters.get(leftRoot)
      const rightCluster = clusters.get(rightRoot)
      if (!leftCluster || !rightCluster) continue
      if (leftCluster.currency !== rightCluster.currency) continue
      if (edge.score < minimumScoreFor(leftCluster.rep.matchName, rightCluster.rep.matchName)) continue
      if ([...rightCluster.storeKeys].some(storeKey => leftCluster.storeKeys.has(storeKey))) continue
      if (leftCluster.offers.some(offer => rightCluster.offers.some(other => isSeparated(offer, other)))) continue
      parent.set(rightRoot, leftRoot)
      leftCluster.offers.push(...rightCluster.offers)
      for (const storeKey of rightCluster.storeKeys) leftCluster.storeKeys.add(storeKey)
      leftCluster.confidence = Math.min(leftCluster.confidence, rightCluster.confidence, edge.score)
      if (preferRep(rightCluster.rep, leftCluster.rep)) leftCluster.rep = rightCluster.rep
      clusters.delete(rightRoot)
    }

    // Авто-слияние 1:1 — взаимные ближайшие совпадения. Если кандидат A
    // считает своим лучшим матчем B (среди кандидатов других магазинов),
    // а B — A, соответствие однозначно и не требует ручного подтверждения:
    // объединяем даже при score ниже общего порога. Пары внутри уже
    // слитых кластеров пропускаем.
    const bestMatchByRef = new Map()
    for (const [pairKey, score] of pairScores) {
      const [leftRef, rightRef] = JSON.parse(pairKey)
      if (findRoot(leftRef) === findRoot(rightRef)) continue
      for (const [self, other] of [[leftRef, rightRef], [rightRef, leftRef]]) {
        const current = bestMatchByRef.get(self)
        if (!current || score > current.score) bestMatchByRef.set(self, { otherRef: other, score })
      }
    }
    const mutualPairs = new Set()
    for (const [ref, best] of bestMatchByRef) {
      const back = bestMatchByRef.get(best.otherRef)
      if (back && back.otherRef === ref && best.score >= 0.5) {
        mutualPairs.add(JSON.stringify([ref, best.otherRef].sort()))
      }
    }
    for (const pairKey of mutualPairs) {
      const [leftRef, rightRef] = JSON.parse(pairKey)
      const leftRoot = findRoot(leftRef)
      const rightRoot = findRoot(rightRef)
      if (leftRoot === rightRoot) continue
      const leftCluster = clusters.get(leftRoot)
      const rightCluster = clusters.get(rightRoot)
      if (!leftCluster || !rightCluster) continue
      if (leftCluster.currency !== rightCluster.currency) continue
      if ([...rightCluster.storeKeys].some(storeKey => leftCluster.storeKeys.has(storeKey))) continue
      if (leftCluster.offers.some(offer => rightCluster.offers.some(other => isSeparated(offer, other)))) continue
      parent.set(rightRoot, leftRoot)
      leftCluster.offers.push(...rightCluster.offers)
      for (const storeKey of rightCluster.storeKeys) leftCluster.storeKeys.add(storeKey)
      leftCluster.confidence = Math.min(leftCluster.confidence, rightCluster.confidence, bestMatchByRef.get(leftRef).score)
      if (preferRep(rightCluster.rep, leftCluster.rep)) leftCluster.rep = rightCluster.rep
      clusters.delete(rightRoot)
    }
    for (const cluster of clusters.values()) {
      groups.push({
        productName: cluster.rep.productName,
        matchName: cluster.rep.matchName,
        currency: cluster.rep.currency,
        offers: cluster.offers,
        confidence: cluster.confidence,
        manual: false
      })
    }

    // Пары «чуть не дотянувшие» до авто-объединения отдаём как подсказки:
    // пользователь подтверждает их вручную на вкладке проверки совпадений.
    const groupIndexByRef = new Map()
    groups.forEach((group, index) => group.offers.forEach(offer => groupIndexByRef.set(refKey(offer), index)))
    const suggestionByGroupPair = new Map()
    for (const [pairKey, score] of pairScores) {
      if (score < 0.5) continue
      const [leftRef, rightRef] = JSON.parse(pairKey)
      const leftIndex = groupIndexByRef.get(leftRef)
      const rightIndex = groupIndexByRef.get(rightRef)
      if (leftIndex == null || rightIndex == null || leftIndex === rightIndex) continue
      const left = candidateByRef.get(leftRef)
      const right = candidateByRef.get(rightRef)
      if (!left || !right) continue
      if (score >= minimumScoreFor(left.matchName, right.matchName)) continue
      const groupPairKey = [leftIndex, rightIndex].sort((a, b) => a - b).join('|')
      const existing = suggestionByGroupPair.get(groupPairKey)
      if (existing && existing.score >= score) continue
      suggestionByGroupPair.set(groupPairKey, {
        score,
        currency: left.currency,
        productName: left.matchName.tokens.length >= right.matchName.tokens.length ? left.productName : right.productName,
        offers: [left, right]
      })
    }
    const matchSuggestions = [...suggestionByGroupPair.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map(suggestion => ({
        score: suggestion.score,
        currency: suggestion.currency,
        productName: suggestion.productName,
        offers: suggestion.offers.map(offer => ({
          storeId: offer.storeId,
          productId: offer.productId,
          storeName: offer.storeName,
          productName: offer.productName,
          price: offer.price,
          currency: offer.currency,
          sourceType: offer.sourceType,
          url: offer.url
        }))
      }))

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
      matchSuggestions,
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

module.exports = { Analyzer, cleanComparableName, normalizeMatchName, similarity, similarityCore }
