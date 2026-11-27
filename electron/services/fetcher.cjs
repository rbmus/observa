const axios = require('axios')
const cheerio = require('cheerio')

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8'
}

const CURRENCY_MAP = { '₽': 'RUB', руб: 'RUB', 'р.': 'RUB', rub: 'RUB', '$': 'USD', usd: 'USD', '€': 'EUR', eur: 'EUR', '£': 'GBP', gbp: 'GBP' }
const PRICE_RE = /(?:^|[^\d])((?:\d{1,3}(?:[\s\u00a0.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?))\s*(₽|руб(?:\.|лей|ля)?|р\.|RUB|\$|USD|€|EUR|£|GBP)(?![\p{L}])/giu
const SKIP_PRICE_CLASS = /old|was|strike|cross|previous|regular|review|rating|discount|saving|эконом/i

function normalizeCurrency(raw) {
  if (!raw) return 'RUB'
  return CURRENCY_MAP[String(raw).trim().toLowerCase()] || String(raw).trim().toUpperCase()
}

function normalizeUrl(href, base) {
  if (!href) return null
  const value = String(href).trim()
  if (!value || /^(?:data:|javascript:|#)/i.test(value)) return null
  try {
    const parsed = new URL(value.startsWith('//') ? `https:${value}` : value, base)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch { return null }
}

function cleanName(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/[\s\u00a0]+/g, ' ').replace(/^\s*[-–—|:]+|[-–—|:]+\s*$/g, '').trim().slice(0, 300)
}

function parsePriceValue(value) {
  if (value === null || value === undefined) return null
  let raw = String(value).trim().replace(/[^\d.,\s\u00a0]/g, '').replace(/[\s\u00a0]/g, '')
  if (!raw || !/\d/.test(raw)) return null
  const comma = raw.lastIndexOf(',')
  const dot = raw.lastIndexOf('.')
  const decimalIndex = Math.max(comma, dot)
  if (comma !== -1 && dot !== -1) {
    const fractionLength = raw.length - decimalIndex - 1
    raw = fractionLength > 0 && fractionLength <= 2 ? raw.slice(0, decimalIndex).replace(/[.,]/g, '') + '.' + raw.slice(decimalIndex + 1) : raw.replace(/[.,]/g, '')
  } else if (decimalIndex !== -1) {
    const fractionLength = raw.length - decimalIndex - 1
    raw = fractionLength === 3 ? raw.replace(/[.,]/g, '') : raw.slice(0, decimalIndex).replace(/[.,]/g, '') + '.' + raw.slice(decimalIndex + 1)
  }
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 && n <= 10000000 ? n : null
}

function parsePriceText(text) {
  const matches = []
  PRICE_RE.lastIndex = 0
  let match
  while ((match = PRICE_RE.exec(String(text || ''))) !== null) {
    const price = parsePriceValue(match[1])
    if (price !== null) matches.push({ price, currency: normalizeCurrency(match[2]) })
  }
  return matches
}

function readImage(value, baseUrl) {
  if (Array.isArray(value)) return readImage(value[0], baseUrl)
  if (value && typeof value === 'object') return normalizeUrl(value.url || value.contentUrl || value['@id'], baseUrl)
  return normalizeUrl(value, baseUrl)
}

function readOffers(value) {
  const offers = Array.isArray(value) ? value : [value]
  const results = []
  for (const offer of offers) {
    if (!offer || typeof offer !== 'object') continue
    const currency = normalizeCurrency(offer.priceCurrency || offer.priceSpecification?.priceCurrency)
    const raw = offer.price ?? offer.lowPrice ?? offer.priceSpecification?.price ?? offer.priceSpecification?.minPrice
    const price = parsePriceValue(raw)
    if (price !== null) results.push({
      name: cleanName(offer.name || offer.itemOffered?.name),
      price,
      currency,
      url: offer.url,
      imageUrl: offer.image || offer.itemOffered?.image || null
    })
  }
  return results
}

function parseStructuredData($, baseUrl) {
  const items = []
  const visit = (node, inherited = {}) => {
    if (!node) return
    if (Array.isArray(node)) return node.forEach(item => visit(item, inherited))
    if (typeof node !== 'object') return
    if (node['@graph']) visit(node['@graph'], inherited)
    const type = node['@type']
    const types = (Array.isArray(type) ? type : [type]).map(item => String(item || '').toLowerCase())
    const isOffer = types.includes('offer') || types.includes('aggregateoffer')
    if (isOffer && (inherited.name || node.name || node.itemOffered?.name)) {
      for (const offer of readOffers(node)) items.push({
        ...inherited,
        ...offer,
        name: offer.name || inherited.name,
        url: normalizeUrl(offer.url || node.url, baseUrl) || inherited.url,
        imageUrl: readImage(offer.imageUrl, baseUrl) || inherited.imageUrl
      })
    } else {
      const isCatalogItem = types.some(item => ['product', 'service', 'individualproduct', 'productmodel', 'softwareapplication', 'mobileapplication', 'creativework'].includes(item))
      if (isCatalogItem) {
        const name = cleanName(node.name || node.headline)
        const offers = readOffers(node.offers)
        const offersNode = Array.isArray(node.offers) ? node.offers[0] : node.offers
        const priceSpecs = offersNode?.priceSpecification
        offers.push(...readOffers(priceSpecs))
        if (name) {
          const common = {
            name,
            url: normalizeUrl(node.url || node['@id'], baseUrl),
            imageUrl: readImage(node.image || node.photo || node.logo, baseUrl)
          }
          for (const offer of offers) items.push({ ...common, ...offer, name: offer.name || common.name, url: normalizeUrl(offer.url, baseUrl) || common.url, imageUrl: readImage(offer.imageUrl, baseUrl) || common.imageUrl })
          if (!offers.length) items.push(common)
        }
      }
    }
    // Some sites put an Offer in a separate JSON-LD node and reference it from Product.
    if (node.offers && typeof node.offers === 'object') visit(node.offers, { name: cleanName(node.name), url: normalizeUrl(node.url, baseUrl), imageUrl: readImage(node.image || node.logo, baseUrl) })
    for (const [key, child] of Object.entries(node)) {
      if (key !== '@graph' && key !== 'offers' && child && typeof child === 'object') visit(child, inherited)
    }
  }
  $('script[type="application/ld+json"]').each((_, el) => {
    try { visit(JSON.parse($(el).contents().text())) } catch { /* ignore malformed structured data */ }
  })
  return items.filter(item => item.name && item.price != null)
}

function pickImage($, $scope, baseUrl) {
  let best = null
  let bestScore = -1
  $scope.find('img, source[srcset], meta[property*="image" i], [style*="background-image" i], [data-background-image], [data-bg]').each((_, el) => {
    const $el = $(el)
    // srcset candidates: pick the largest declared width, not just the last one.
    let srcsetUrl = null
    let srcsetWidth = -1
    for (const attr of [$el.attr('data-srcset'), $el.attr('data-lazy-srcset'), $el.attr('data-original-srcset'), $el.attr('srcset')]) {
      if (!attr) continue
      for (const entry of String(attr).split(',')) {
        const [candidateUrl, descriptor] = entry.trim().split(/\s+/)
        if (!candidateUrl) continue
        const width = descriptor && descriptor.endsWith('w') ? Number(descriptor.slice(0, -1)) : 0
        if (width >= srcsetWidth) { srcsetUrl = candidateUrl; srcsetWidth = width }
      }
    }
    const styleImage = ($el.attr('style') || '').match(/url\(["']?([^"')]+)["']?\)/i)?.[1]
    const candidates = [$el.attr('content'), $el.attr('data-zoom-image'), $el.attr('data-large_image'), $el.attr('data-original'), $el.attr('data-original-src'), $el.attr('data-lazy-src'), $el.attr('data-src'), $el.attr('data-src-original'), $el.attr('data-echo'), $el.attr('data-img'), $el.attr('data-image'), $el.attr('data-background-image'), $el.attr('data-bg'), srcsetUrl, $el.attr('src'), styleImage]
    for (const candidate of candidates) {
      const imageUrl = normalizeUrl(candidate, baseUrl)
      if (!imageUrl || /\.(?:svg)(?:[?#]|$)/i.test(imageUrl) || /(logo|sprite|pixel|1x1|spacer|loading|placeholder|avatar|review|rating)/i.test(imageUrl)) continue
      const width = Number($el.attr('width')) || Number($el.attr('data-width')) || 0
      const height = Number($el.attr('height')) || Number($el.attr('data-height')) || 0
      let score = 1
      if (width >= 150 && height >= 150) score += 3
      if (/product|catalog|item|goods/i.test(imageUrl)) score += 2
      if (/thumb|small|preview/i.test(imageUrl)) score -= 1
      if (score > bestScore) { best = imageUrl; bestScore = score }
      break
    }
  })
  return best
}

function titleFromScope($, $scope) {
  const selectors = [
    '[itemprop="name"]', '[data-product-name]', '[class*="product-title" i]', '[class*="product_name" i]',
    '[class*="card-title" i]', '[class*="item-title" i]', '[class*="product-name" i]', '[class*="name" i]', '[class*="title" i]',
    'h1', 'h2', 'h3', 'h4', 'a[title]', 'img[alt]'
  ]
  for (const selector of selectors) {
    const $node = $scope.find(selector).addBack(selector).first()
    if (!$node.length) continue
    const name = cleanName($node.attr('content') || $node.attr('data-product-name') || $node.attr('title') || $node.attr('alt') || $node.text())
    if (name.length >= 3 && !parsePriceText(name).length && !/^(?:купить|подробнее|в корзину|заказать)$/i.test(name)) return name
  }
  return ''
}

function extractMicrodata($, baseUrl) {
  const items = []
  $('[itemtype*="Product" i], [itemtype*="Service" i]').each((_, el) => {
    const $scope = $(el)
    const name = cleanName($scope.find('[itemprop="name"]').first().attr('content') || $scope.find('[itemprop="name"]').first().text())
    const rawPrice = $scope.find('[itemprop="price"]').first().attr('content') || $scope.find('[itemprop="price"]').first().text()
    const currency = normalizeCurrency($scope.find('[itemprop="priceCurrency"]').first().attr('content') || $scope.find('[itemprop="priceCurrency"]').first().text())
    const price = parsePriceValue(rawPrice)
    if (!name || price === null) return
    const imageNode = $scope.find('[itemprop="image"]').first()
    const image = imageNode.attr('content') || imageNode.attr('src') || imageNode.attr('href')
    const urlNode = $scope.find('[itemprop="url"]').first()
    items.push({ name, price, currency, imageUrl: normalizeUrl(image, baseUrl) || pickImage($, $scope, baseUrl), url: normalizeUrl(urlNode.attr('href') || urlNode.attr('content'), baseUrl) || normalizeUrl($scope.find('a[href]').first().attr('href'), baseUrl) })
  })
  return items
}

function findCard($, $priceNode, baseUrl) {
  const $ancestors = $priceNode.parents().slice(0, 7)
  let fallback = $priceNode.parent()
  $ancestors.each((_, ancestor) => {
    const $candidate = $(ancestor)
    const text = $candidate.text()
    if (text.length > 1800) return false
    const hasName = Boolean(titleFromScope($, $candidate))
    const hasImage = Boolean(pickImage($, $candidate, baseUrl))
    const hasLink = Boolean($candidate.find('a[href]').length)
    if (hasName && (hasImage || hasLink)) { fallback = $candidate; return false }
    if (text.length < 900) fallback = $candidate
    return undefined
  })
  return fallback
}

function extractCatalogCards($, baseUrl) {
  const items = []
  const selectors = [
    '[itemprop="price"]', '[data-price]', 'meta[property="product:price:amount"]', 'meta[itemprop="price"]',
    '[class*="price" i]:not([class*="old" i]):not([class*="was" i]):not([class*="review" i]):not([class*="rating" i])'
  ].join(',')
  $(selectors).each((_, el) => {
    const $priceNode = $(el)
    if (SKIP_PRICE_CLASS.test($priceNode.attr('class') || '') || $priceNode.closest('[hidden], [aria-hidden="true"]').length) return
    const raw = $priceNode.attr('content') || $priceNode.attr('data-price') || $priceNode.text()
    const explicitCurrency = $priceNode.attr('data-currency') || $priceNode.attr('itemprop') === 'price' && $priceNode.parent().find('[itemprop="priceCurrency"]').attr('content')
    const prices = parsePriceText(raw)
    if (!prices.length) {
      const numeric = parsePriceValue(raw)
      if (numeric !== null && ($priceNode.is('[data-price], [itemprop="price"], meta[property="product:price:amount"], meta[itemprop="price"]'))) {
        const nearbyText = $priceNode.parent().text()
        prices.push({ price: numeric, currency: normalizeCurrency(explicitCurrency || parsePriceText(nearbyText)[0]?.currency) })
      }
    }
    if (!prices.length) return
    const $card = findCard($, $priceNode, baseUrl)
    const name = titleFromScope($, $card)
    if (!name || name.length < 3) return
    const price = prices[0]
    items.push({
      name,
      ...price,
      currency: explicitCurrency ? normalizeCurrency(explicitCurrency) : price.currency,
      url: normalizeUrl($card.find('a[href]').first().attr('href') || $card.attr('href'), baseUrl),
      imageUrl: pickImage($, $card, baseUrl)
    })
  })
  return items
}

const TIER_UNIT_HINT = /шт\.?|приложени\p{L}*|apps?\b|application|мес\.?|месяц\p{L}*|год\p{L}*|лет\b|подписк\p{L}*|аккаунт\p{L}*|ключ\p{L}*|license|subscription|install|установк\p{L}*|month|year|day|недел\p{L}*/iu

/** Many service shops price by tier ("1–2 приложения — 790 ₽/шт"), not per
 * catalog item. Short price blocks that mention a unit become offers. */
/** SPAs often embed the whole catalog as a JS array (`const APPS=[{name,icon,uid}]`).
 * Bracket-match each large array literal and keep entries that look like products. */
function extractEmbeddedJsonItems(html, baseUrl) {
  const items = []
  const assignmentRe = /(?:const|let|var)\s+[A-Za-z_$][\w$]{1,40}\s*=\s*\[/g
  let match
  while ((match = assignmentRe.exec(html))) {
    const start = match.index + match[0].length - 1
    let depth = 0
    let end = -1
    let inStr = false
    let esc = false
    for (let i = start; i < html.length && i - start < 2_000_000; i++) {
      const c = html[i]
      if (inStr) {
        if (esc) esc = false
        else if (c === '\\') esc = true
        else if (c === '"') inStr = false
        continue
      }
      if (c === '"') inStr = true
      else if (c === '[') depth++
      else if (c === ']') { depth--; if (!depth) { end = i; break } }
    }
    if (end < 0) continue
    const raw = html.slice(start, end + 1)
    if (raw.length < 200 || raw.length > 1_500_000) continue
    let arr
    try { arr = JSON.parse(raw) } catch { continue }
    if (!Array.isArray(arr) || arr.length < 3) continue
    const named = arr.filter(x => x && typeof x === 'object' && typeof (x.name || x.title) === 'string' && String(x.name || x.title).trim().length >= 2)
    if (named.length < Math.min(3, Math.ceil(arr.length * 0.6))) continue
    for (const item of named.slice(0, 500)) {
      const itemName = cleanName(item.name || item.title)
      if (itemName.length > 60 || CATALOG_ITEM_JUNK.test(itemName)) continue
      const promo = Number(item.promo_price)
      const price = parsePriceValue(item.price ?? item.price_rub ?? item.cost ?? item.amount ?? (Number.isFinite(promo) && promo >= 100 ? promo : null))
      items.push({
        name: itemName,
        price,
        currency: normalizeCurrency(item.currency || item.priceCurrency || 'RUB'),
        url: normalizeUrl(item.url || item.link || item.product_url, baseUrl),
        imageUrl: normalizeUrl(item.icon || item.image || item.img || item.logo || item.picture || item.image_url, baseUrl),
        sourceKey: item.uid || item.id ? `embed:${item.uid || item.id}` : null
      })
    }
    assignmentRe.lastIndex = end + 1
  }
  return items
}

/** Catalog cards that carry a name/image/link but no price node — typical for
 * shops that charge a flat per-install tariff instead of per-item prices. */
const CATALOG_ITEM_JUNK = /[?？]$|^(?:мои|корзина|кабинет|заказ|избранн|профиль|настройк|поддержк|выйти|войти|регистрац|каталог|apple\s+silicon|intel|x64|x86|arm64?|amd|macos|windows|linux|faq|blog|news|о\s+компании|контакты|отзывы|вопросы)/iu

function extractCatalogItems($, baseUrl) {
  const items = []
  const seen = new Set()
  $(`${CARD_SELECTOR}`).each((_, el) => {
    const $card = $(el)
    if ($card.find('[class*="price" i],[itemprop="price"],[data-price]').length) return
    if ($card.closest('header, nav, [role="navigation"], footer').length) return
    // Strict name sources only — a[title]/img[alt] fallbacks pick up CTA labels
    // like "Спросить в поддержке" on button rows inside cards.
    let name = ''
    for (const sel of ['[itemprop="name"]', '[data-product-name]', '[class*="product-title" i]', '[class*="product_name" i]', '[class*="card-title" i]', '[class*="item-title" i]', '[class*="product-name" i]', '[class*="name" i]', '[class*="title" i]', 'h1', 'h2', 'h3', 'h4']) {
      const $node = $card.find(sel).addBack(sel).first()
      if (!$node.length) continue
      const candidate = cleanName($node.attr('content') || $node.attr('data-product-name') || $node.text())
      if (candidate.length >= 3 && candidate.length <= 60 && !parsePriceText(candidate).length && !CATALOG_ITEM_JUNK.test(candidate)) { name = candidate; break }
    }
    if (!name) return
    if (!name || name.length < 3 || parsePriceText(name).length) return
    const url = normalizeUrl($card.attr('href') || $card.find('a[href]').first().attr('href'), baseUrl)
    const imageUrl = pickImage($, $card, baseUrl)
    // Sub-elements (icon/name/version blocks) carry no link or picture of their
    // own — only real cards qualify.
    if (!url && !imageUrl) return
    const key = name.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    const uid = $card.attr('data-uid') || $card.attr('data-id') || $card.find('[data-uid]').first().attr('data-uid')
    items.push({
      name,
      price: null,
      currency: 'RUB',
      url,
      imageUrl,
      sourceKey: uid ? `card:${uid}` : null
    })
  })
  return items
}

/** Entry-tier unit price from tariff blocks ("1–2 приложения — 790 ₽/шт").
 * Used as the fallback price for price-less catalog items. */
function pickUnitPrice(tiers) {
  const appTiers = tiers.filter(t => /приложени|apps?\b|установк|install|игр|games?/iu.test(t.name || ''))
  if (!appTiers.length) return null
  // The entry tier (smallest order) carries the highest per-unit price.
  const entry = appTiers.reduce((best, t) => (t.price > best.price ? t : best))
  return { price: entry.price, currency: entry.currency }
}

function extractPriceTiers($, baseUrl) {
  const items = []
  const UNIT_SUFFIX = /\/\s*(?:шт\.?|мес\.?|месяц\w*|год\w*|apps?|app|year|month|day|недел\w*|per\s*\w+)/giu
  $('[class*="price" i], [class*="tariff" i], [class*="tier" i], [class*="cost" i], [class*="plan-" i]').each((_, el) => {
    const $el = $(el)
    if ($el.closest('[hidden], [aria-hidden="true"]').length) return
    // One element often stacks several offers ("1–2 приложения · 790 ₽/шт.
    // От 3 приложений · 600 ₽/шт."). Name each price from the text since the
    // previous price — separators like «·» sit between name and price.
    const rawText = String($el.text())
    const matches = []
    PRICE_RE.lastIndex = 0
    let match
    while ((match = PRICE_RE.exec(rawText)) !== null) matches.push(match)
    let cursor = 0
    for (const m of matches) {
      const nameRegion = rawText.slice(cursor, m.index)
      const context = `${nameRegion} ${rawText.slice(m.index + m[0].length, m.index + m[0].length + 40)}`
      cursor = m.index + m[0].length
      const price = parsePriceValue(m[1])
      if (price === null || !TIER_UNIT_HINT.test(context)) continue
      let name = cleanName(
        nameRegion
          .replace(PRICE_RE, ' ')
          .replace(UNIT_SUFFIX, ' ')
          .split(/[•\n]/).pop()
      )
      name = cleanName(name.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[\s·•|/\\:;,+\-–—]+$/g, ''))
      if (name.length < 3) continue
      if (/^(?:за|на|в|и|от|до)\s+\S{1,12}$/iu.test(name) && !/приложени|apps?\b|установк|install|игр|games?|подписк|subscription/iu.test(name)) continue
      items.push({ name, price, currency: normalizeCurrency(m[2]), url: normalizeUrl($el.closest('a[href]').attr('href'), baseUrl) })
    }
  })
  return items
}

function normalizeItem(item, baseUrl) {
  const name = cleanName(item.name || item.title)
  const price = parsePriceValue(item.price)
  if (!name || price === null) return null
  return { name, price, currency: normalizeCurrency(item.currency || item.priceCurrency), url: normalizeUrl(item.url, baseUrl), imageUrl: normalizeUrl(item.imageUrl, baseUrl) }
}

function dedupe(items) {
  const result = []
  const byKey = new Map()
  for (const source of items) {
    const item = normalizeItem(source, source.url || 'https://example.com')
    if (!item) continue
    const key = `${item.name.toLocaleLowerCase()}|${item.price}|${item.currency}`
    const existing = byKey.get(key)
    if (existing) {
      if (!existing.imageUrl && item.imageUrl) existing.imageUrl = item.imageUrl
      if (!existing.url && item.url) existing.url = item.url
      continue
    }
    byKey.set(key, item)
    result.push(item)
  }
  return result
}

/** Some storefronts expose a public pricing API instead of a catalog —
 * e.g. vseapki.com `/api/v1/public-pricing` describes a per-install tariff
 * (base price per position, bulk step, markup). We quote a few pack sizes. */
function quotePricingModel(pricing, n) {
  const base = Number(pricing.baseUnitPriceMinor)
  const min = Number(pricing.minimumUnitPriceMinor ?? 0)
  const stepMinor = Number(pricing.positionPriceStepMinor ?? 0)
  const finalStep = Number(pricing.finalPriceStepRubMinor) > 0 ? Number(pricing.finalPriceStepRubMinor) : 5000
  const markupPct = Number(pricing.globalMarkupPercent ?? 0) || 0
  const withMarkup = amount => Math.ceil(amount * (1 + markupPct / 100))
  const roundStep = amount => Math.round(amount / finalStep) * finalStep
  let positions
  if (pricing.pricingModelVersion === 2 && Number.isSafeInteger(stepMinor) && stepMinor > 0) {
    positions = Array.from({ length: n }, (_, i) => Math.max(min, base - i * stepMinor))
  } else {
    const maxItems = Math.max(1, Number(pricing.maximumItems ?? 100) - 1)
    const maxDiscount = Number(pricing.maximumDiscountPercent ?? 60)
    positions = Array.from({ length: n }, () => {
      const discount = Math.min(maxDiscount, ((n - 1) * maxDiscount) / maxItems)
      return Math.max(min, Math.round((base * (1 - discount / 100))))
    })
  }
  const total = roundStep(withMarkup(positions.reduce((a, b) => a + b, 0)))
  return { totalMinor: total, unitMinor: Math.ceil(total / n) }
}

async function fetchPublicPricingCatalog(url) {
  let origin
  try { origin = new URL(url).origin } catch { return null }
  let pricing
  try {
    const res = await axios.get(`${origin}/api/v1/public-pricing`, { headers: HEADERS, timeout: 12000, maxRedirects: 3, validateStatus: s => s >= 200 && s < 400 })
    pricing = res.data
  } catch { return null }
  if (!pricing || typeof pricing !== 'object' || !Number.isFinite(Number(pricing.baseUnitPriceMinor)) || Number(pricing.baseUnitPriceMinor) <= 0) return null

  const currency = normalizeCurrency(pricing.currency || 'RUB')
  const counts = [1, 2, 3, 5, 10, 20].filter(n => !Number.isFinite(Number(pricing.maximumItems)) || n <= Number(pricing.maximumItems))
  const products = counts.map(n => {
    const quote = quotePricingModel(pricing, n)
    const unitRub = quote.unitMinor / 100
    const name = n === 1 ? 'Установка приложения (iOS)' : `Установка ${n} приложений (iOS)`
    return {
      name,
      price: unitRub,
      currency,
      url,
      imageUrl: null,
      sourceKey: `pricing-tier:${n}`
    }
  })
  return { url, title: new URL(url).hostname, fetchedAt: new Date().toISOString(), products }
}

/** Magap storefronts render their catalog in a Mini App; the HTML shell is empty.
 * Their public catalog API is the source of truth for active items and prices. */
async function fetchMagapCatalog(url) {
  const storefrontUrl = new URL(url)
  const match = storefrontUrl.pathname.match(/^\/b\/([a-z0-9_-]+)(?:\/|$)/i)
  if (!match || !/^(?:www\.)?magap\.ru$/i.test(storefrontUrl.hostname)) return null

  const slug = match[1]
  const apiBase = `${storefrontUrl.origin}/api/business`
  const requestOptions = { headers: HEADERS, timeout: 20000, maxRedirects: 5 }
  const businessResponse = await axios.get(`${apiBase}/public/${encodeURIComponent(slug)}`, requestOptions)
  const business = businessResponse.data
  if (!business || !business.id) throw new Error(`Magap: магазин «${slug}» не найден`)
  if (business.status && business.status !== 'active') throw new Error(`Magap: магазин «${business.name || slug}» не активен`)

  const productsResponse = await axios.get(`${apiBase}/${encodeURIComponent(slug)}/products`, requestOptions)
  // Платформенные иконки Magap лежат в /icons/, часть — в /icons/catalog/.
  // Проверено по живым URL: catalog → telegram, ea-play, fortnite,
  // midjourney, ps-plus-*, roblox, steam; root → apple, xbox,
  // playstation, steam, ai, roblox.
  const iconByPlatform = [
    { re: /ps\s*plus\s*extra/i, icon: 'ps-plus-extra', catalog: true },
    { re: /ps\s*plus\s*deluxe/i, icon: 'ps-plus-deluxe', catalog: true },
    { re: /ps\s*plus\s*(?:essential|basic)/i, icon: 'ps-plus-essential', catalog: true },
    { re: /ea\s*play/i, icon: 'ea-play', catalog: true },
    { re: /fortnite/i, icon: 'fortnite', catalog: true },
    { re: /midjourney/i, icon: 'midjourney', catalog: true },
    { re: /telegram|телеграм|\bstars?\b/i, icon: 'telegram', catalog: true },
    { re: /apple|app store/i, icon: 'apple' },
    { re: /xbox/i, icon: 'xbox' },
    { re: /playstation|psn|ps plus/i, icon: 'playstation' },
    { re: /steam/i, icon: 'steam' },
    { re: /нейросет|\bai\b|chatgpt|\bgpt\b/i, icon: 'ai' },
    { re: /roblox/i, icon: 'roblox' }
  ]
  const products = (Array.isArray(productsResponse.data) ? productsResponse.data : [])
    .filter(item => item && item.is_active !== false)
    .map(item => {
      const price = parsePriceValue(item.price_rub ?? item.price_stars)
      if (!item.title || price === null) return null
      return {
        name: cleanName(item.title),
        price,
        currency: normalizeCurrency(item.currency || 'RUB'),
        url,
        // Magap currently leaves image_url empty for every product. Use its
        // published platform artwork as a useful fallback until item photos exist.
        imageUrl: normalizeUrl(item.image_url, storefrontUrl.origin) || (() => {
          const match = iconByPlatform.find(({ re }) => re.test(`${item.platform || ''} ${item.title || ''}`))
          return match ? normalizeUrl(`/icons/${match.catalog ? 'catalog/' : ''}${match.icon}.png`, storefrontUrl.origin) : null
        })(),
        sourceKey: `magap:${item.sku || item.id}`
      }
    })
    .filter(Boolean)

  // The storefront sells iOS apps through a separate catalog endpoint. App
  // installs share one tariff — `apps/quote` returns the real per-unit price
  // (790 ₽ for a single install, cheaper in packs). Apps without their own
  // promo price inherit that tariff so they become comparable offers.
  let appProducts = []
  try {
    const appsResponse = await axios.get(`${apiBase}/${encodeURIComponent(slug)}/apps`, requestOptions)
    let installPrice = null
    try {
      const quote = await axios.post(`${apiBase}/${encodeURIComponent(slug)}/apps/quote`, { n: 1 }, requestOptions)
      installPrice = parsePriceValue(quote.data?.unit_price ?? quote.data?.total)
    } catch { /* quote is optional */ }
    appProducts = (Array.isArray(appsResponse.data) ? appsResponse.data : [])
      .filter(item => item && item.is_active !== false)
      .map(item => {
        const promo = Number(item.promo_price)
        // promo_price below ~100 ₽ is a placeholder, not a real tariff.
        const ownPrice = Number.isFinite(promo) && promo >= 100 ? promo : null
        const price = parsePriceValue(item.price_rub ?? ownPrice ?? installPrice)
        if (!item.name || price === null) return null
        return {
          name: cleanName(item.name),
          price,
          currency: normalizeCurrency(item.currency || 'RUB'),
          url,
          imageUrl: normalizeUrl(item.icon_url, storefrontUrl.origin),
          sourceKey: `magap-app:${item.id}`
        }
      })
      .filter(Boolean)
  } catch { /* the apps catalog is optional */ }

  return {
    url,
    title: cleanName(business.name) || slug,
    fetchedAt: new Date().toISOString(),
    products: [...products, ...appProducts].slice(0, 500)
  }
}

/** Parse already-loaded HTML into a product catalog. */
function parseHtmlToProducts(html, pageUrl) {
  const $ = cheerio.load(html)
  const title = cleanName($('meta[property="og:site_name"]').attr('content') || $('title').first().text()) || new URL(pageUrl).hostname

  const structured = parseStructuredData($, pageUrl)
  const microdata = extractMicrodata($, pageUrl)
  $('script, style, noscript, svg, template').remove()
  const cards = extractCatalogCards($, pageUrl)
  const tiers = extractPriceTiers($, pageUrl)
  const catalogItems = extractCatalogItems($, pageUrl)
  const embeddedItems = extractEmbeddedJsonItems(html, pageUrl)

  // Shops with a flat per-install tariff list apps without prices — the
  // entry-tier price ("1–2 приложения — 790 ₽/шт") is their unit price.
  const unitPrice = pickUnitPrice(tiers)
  const unpriced = [...catalogItems, ...embeddedItems].filter(item => item.price == null)
  for (const item of unpriced) {
    if (unitPrice) { item.price = unitPrice.price; item.currency = unitPrice.currency || item.currency }
  }
  const pricedExtras = [...catalogItems, ...embeddedItems].filter(item => item.price != null)

  // A complete structured catalog is authoritative. Merging in every visible
  // currency mention would otherwise turn FAQ/support copy into fake products.
  let products = dedupe([
    ...(structured.length ? structured : [...microdata, ...cards, ...tiers]),
    ...pricedExtras
  ])

  // Product detail pages sometimes publish only Open Graph / standard meta tags.
  if (!products.length) {
    const name = cleanName($('meta[property="og:title"]').attr('content') || $('meta[name="twitter:title"]').attr('content') || $('h1').first().text())
    const price = parsePriceValue($('meta[property="product:price:amount"]').attr('content') || $('meta[property="og:price:amount"]').attr('content'))
    const currency = normalizeCurrency($('meta[property="product:price:currency"]').attr('content') || $('meta[property="og:price:currency"]').attr('content'))
    const imageUrl = normalizeUrl($('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content'), pageUrl)
    if (name && price !== null) products = [{ name, price, currency, imageUrl, url: pageUrl }]
  }

  // One product page with JSON-LD and no product image in its scope can still use OG artwork.
  if (products.length === 1 && !products[0].imageUrl) products[0].imageUrl = normalizeUrl($('meta[property="og:image"]').attr('content'), pageUrl)

  // Marketing blocks often pair a hero price button with the page slogan —
  // drop "products" that are just a copy of the main heading.
  if (products.length > 1) {
    const hero = cleanName($('h1').first().text()).replace(/\s+/g, '').toLowerCase()
    if (hero.length >= 10) {
      products = products.filter(item => item.name.replace(/\s+/g, '').toLowerCase() !== hero)
    }
  }
  return { title, products, $ }
}

async function fetchStaticPage(url) {
  const response = await axios.get(url, { headers: HEADERS, timeout: 20000, maxRedirects: 5, validateStatus: status => status >= 200 && status < 400 })
  const finalUrl = response.request?.res?.responseUrl || url
  return { finalUrl, html: response.data }
}

// Many storefronts render their catalog with JavaScript, so the static HTML
// contains no products at all. A hidden Electron window gives us the real DOM.
let renderWindow = null
let renderQueue = Promise.resolve()

function getRenderWindow() {
  if (!renderWindow || renderWindow.isDestroyed()) {
    const { BrowserWindow } = require('electron')
    renderWindow = new BrowserWindow({
      show: false,
      width: 1366,
      height: 900,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    renderWindow.webContents.setAudioMuted(true)
  }
  return renderWindow
}

async function domSignature(webContents) {
  try {
    return await webContents.executeJavaScript(
      `JSON.stringify({r:document.readyState,n:document.querySelectorAll('a,article,li,[class*=card],[class*=app],[class*=product],[class*=item],[class*=price]').length,l:document.body?document.body.innerText.length:0})`,
      true
    )
  } catch { return '' }
}

async function fetchRenderedHTML(url) {
  const job = renderQueue.then(() => renderPage(url))
  renderQueue = job.catch(() => {})
  return job
}

async function renderPage(url) {
  const win = getRenderWindow()
  await win.loadURL(url, { timeout: 30000 })
  const startedAt = Date.now()
  const deadline = startedAt + 15000
  const minWait = 4000
  let previous = ''
  let stable = 0
  // Catalogs lazy-load a few seconds after `load` — never dump before minWait,
  // then stop early once the DOM signature stops changing. Scrolling triggers
  // IntersectionObserver-based lazy images and infinite catalogs.
  while (Date.now() < deadline && (Date.now() - startedAt < minWait || stable < 2)) {
    await new Promise(resolve => setTimeout(resolve, 800))
    try {
      await win.webContents.executeJavaScript('window.scrollBy(0, 700); window.scrollY', true)
    } catch { /* page may be mid-navigation */ }
    const signature = await domSignature(win.webContents)
    stable = signature && signature === previous ? stable + 1 : 0
    previous = signature
  }
  return win.webContents.executeJavaScript('document.documentElement.outerHTML')
}

const MIN_PRODUCTS_TO_SKIP_RENDER = 8
const MAX_RENDERED_PAGES = 8
const MAX_CRAWL_PAGES = 16
const CRAWL_CONCURRENCY = 3
const MAX_DETAIL_PAGES = 12
const MAX_PRODUCTS = 1000

const SKIP_HREF = /\.(?:png|jpe?g|gif|webp|svg|ico|css|js|pdf|zip|rar|xml|json)(?:[?#]|$)|\/(?:blog|news|faq|guide|help|support|wiki|docs|about|privacy|terms|login|auth|cart|checkout|account|personal)(?:[/?#]|$)/i
const CATALOG_HINT = /catalog|category|katalog|apps?\b|tovar|goods|shop|product|service|uslugi|price|pricing|offer|plan|tarif|collection|games?|igry|popular/i
const CATALOG_TEXT = /каталог|все\s+товар|прайс|тариф|приложен|игр|товар|услуг|подписк|популярн|купить|цены|следующ|далее|›|»/i
const PAGE_HINT = /[?&](?:page|p|offset)=\d+|\/page[s]?\/\d+/i
const CARD_SELECTOR = '[class*="card" i],[class*="product" i],[class*="item" i],[class*="app" i],[class*="goods" i],[class*="offer" i],[class*="tile" i],[class*="thumb" i]'

function sameOriginLink($, el, pageUrl, base) {
  const href = normalizeUrl($(el).attr('href'), pageUrl)
  if (!href) return null
  let parsed
  try { parsed = new URL(href) } catch { return null }
  if (parsed.origin !== base.origin || SKIP_HREF.test(href)) return null
  return { href, parsed }
}

function discoverCatalogLinks($, pageUrl) {
  const base = new URL(pageUrl)
  const scored = new Map()
  const pagePath = base.pathname.replace(/\/+$/, '') || '/'
  $('a[href]').each((_, el) => {
    const link = sameOriginLink($, el, pageUrl, base)
    if (!link) return
    const { href, parsed } = link
    const path = parsed.pathname.replace(/\/+$/, '') || '/'
    if (path === pagePath && !parsed.search) return
    const text = cleanName($(el).text())
    const rel = String($(el).attr('rel') || '')
    let score = 0
    if (rel.toLowerCase().split(/\s+/).includes('next') || PAGE_HINT.test(href)) score += 4 // pagination
    if (CATALOG_HINT.test(path)) score += 3
    if (CATALOG_TEXT.test(text)) score += 2
    if (path.split('/').filter(Boolean).length <= 2) score += 1
    if (parsed.search && !PAGE_HINT.test(href)) score -= 1
    if (!score) return
    // Pagination links share a path — keep the query in the dedupe key for them.
    const key = PAGE_HINT.test(href) ? `${parsed.origin}${path}${parsed.search}` : `${parsed.origin}${path}`
    const url = `${parsed.origin}${path}${parsed.search}`
    if (!scored.has(key) || scored.get(key).score < score) scored.set(key, { url, score })
  })
  return [...scored.values()].sort((a, b) => b.score - a.score).map(item => item.url)
}

/** Anchors inside product-card containers point at detail pages — those often
 * carry the price in JSON-LD/OG even when the listing shows none. */
function discoverDetailLinks($, pageUrl) {
  const base = new URL(pageUrl)
  const links = []
  const seen = new Set()
  $(`a[href]`).each((_, el) => {
    const $a = $(el)
    const $card = $a.closest(CARD_SELECTOR)
    if (!$card.length) return
    // Require a price-ish descendant so nav/footer links in wide containers don't qualify.
    if (!$card.find('[class*="price" i],[itemprop="price"],[data-price]').length) return
    const link = sameOriginLink($, el, pageUrl, base)
    if (!link) return
    const path = link.parsed.pathname.replace(/\/+$/, '') || '/'
    const pagePath = base.pathname.replace(/\/+$/, '') || '/'
    if (path === pagePath && !link.parsed.search) return
    if (seen.has(link.href)) return
    seen.add(link.href)
    links.push(link.href)
  })
  return links
}

/** Many shops publish a sitemap — it lists every catalog/product URL even when
 * navigation only exposes a few sections. Follows robots.txt → sitemap index →
 * url entries, same-origin only. */
async function fetchSitemapLinks(origin) {
  const candidates = []
  try {
    const robots = await axios.get(`${origin}/robots.txt`, { headers: HEADERS, timeout: 10000, maxRedirects: 3, validateStatus: s => s >= 200 && s < 400 })
    for (const line of String(robots.data).split('\n')) {
      const m = line.match(/^\s*sitemap:\s*(\S+)/i)
      if (m) candidates.push(m[1])
    }
  } catch { /* no robots.txt */ }
  candidates.push(`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`)

  const locs = []
  const seenMaps = new Set()
  const fetchMap = async mapUrl => {
    if (seenMaps.has(mapUrl) || seenMaps.size >= 8) return
    seenMaps.add(mapUrl)
    try {
      const res = await axios.get(mapUrl, { headers: HEADERS, timeout: 12000, maxRedirects: 3, validateStatus: s => s >= 200 && s < 400, responseType: 'text', transformResponse: [d => d] })
      const xml = String(res.data)
      if (/<sitemapindex/i.test(xml)) {
        const children = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map(m => m[1]).slice(0, 5)
        for (const child of children) await fetchMap(child)
        return
      }
      for (const m of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) locs.push(m[1])
    } catch { /* skip broken sitemaps */ }
  }
  for (const mapUrl of candidates.slice(0, 4)) await fetchMap(mapUrl)

  const base = new URL(origin)
  const scored = new Map()
  for (const loc of locs) {
    let parsed
    try { parsed = new URL(loc) } catch { continue }
    if (parsed.origin !== base.origin || SKIP_HREF.test(parsed.href)) continue
    const path = parsed.pathname
    let score = 0
    if (CATALOG_HINT.test(path)) score += 3
    if (PAGE_HINT.test(parsed.href)) score += 2
    if (parsed.search) score -= 1
    if (!score) continue
    const key = PAGE_HINT.test(parsed.href) ? parsed.href : `${parsed.origin}${path.replace(/\/+$/, '') || '/'}`
    if (!scored.has(key) || scored.get(key).score < score) scored.set(key, { url: parsed.href, score })
  }
  return [...scored.values()].sort((a, b) => b.score - a.score).map(item => item.url)
}

function mergeProducts(into, items, pageUrl) {
  const seen = new Set(into.map(item => `${item.name.toLowerCase()}|${item.price}|${item.currency}`))
  for (const item of items) {
    const key = `${item.name.toLowerCase()}|${item.price}|${item.currency}`
    if (seen.has(key)) continue
    seen.add(key)
    into.push(item.url ? item : { ...item, url: pageUrl })
  }
}

/** Fetches a public catalog page. Structured commerce metadata is preferred over visual heuristics.
 * Falls back to a JS-rendered DOM and same-domain catalog crawling when the
 * static HTML exposes too few products. */
async function fetchAndParse(url, onProgress) {
  const progress = (phase, extra = {}) => {
    try { onProgress?.({ phase, ...extra }) } catch { /* progress is best-effort */ }
  }
  const magapCatalog = await fetchMagapCatalog(url)
  if (magapCatalog) { progress('done', { pages: 1, products: magapCatalog.products.length }); return magapCatalog }
  const pricingCatalog = await fetchPublicPricingCatalog(url)
  if (pricingCatalog) { progress('done', { pages: 1, products: pricingCatalog.products.length }); return pricingCatalog }

  let renderedPages = 0
  const maybeRender = async (parsed, finalUrl) => {
    if (parsed.products.length >= MIN_PRODUCTS_TO_SKIP_RENDER || renderedPages >= MAX_RENDERED_PAGES) return parsed
    renderedPages++
    try {
      const renderedHtml = await fetchRenderedHTML(finalUrl)
      const rendered = parseHtmlToProducts(renderedHtml, finalUrl)
      if (rendered.products.length > parsed.products.length) return rendered
    } catch (error) {
      console.error(`[OBSERVA] Рендер страницы не удался (${finalUrl}):`, error.message)
    }
    return parsed
  }

  const fetchPage = async pageUrl => {
    let finalUrl = pageUrl
    let html = null
    try {
      const staticPage = await fetchStaticPage(pageUrl)
      finalUrl = staticPage.finalUrl
      html = staticPage.html
    } catch (error) {
      if (pageUrl !== url) throw error
      // The main page may still render even when a plain GET fails.
    }
    const parsed = html ? parseHtmlToProducts(html, finalUrl) : { title: '', products: [], $: null }
    return { ...(await maybeRender(parsed, finalUrl)), finalUrl }
  }

  const first = await fetchPage(url)
  const products = [...first.products]
  const title = first.title
  progress('fetch', { pages: 1, products: products.length })
  const visited = new Set([first.finalUrl])
  const detailCandidates = first.$ ? discoverDetailLinks(first.$, first.finalUrl) : []

  // Breadth-first crawl: every discovered catalog/pagination link is queued,
  // scored links first, and each fetched page can contribute new links.
  const queued = new Set()
  const queue = []
  const enqueue = links => {
    for (const link of links) {
      if (visited.has(link) || queued.has(link)) continue
      if (visited.size + queued.size >= MAX_CRAWL_PAGES) continue // +1 for the first page
      queued.add(link)
      queue.push(link)
    }
  }
  enqueue(discoverCatalogLinks(first.$, first.finalUrl))
  try {
    enqueue(await fetchSitemapLinks(new URL(first.finalUrl).origin))
  } catch { /* sitemap is best-effort */ }

  const fetchInto = async pageUrl => {
    visited.add(pageUrl)
    try {
      const page = await fetchPage(pageUrl)
      if (page.$) {
        for (const link of discoverDetailLinks(page.$, page.finalUrl)) if (!detailCandidates.includes(link)) detailCandidates.push(link)
        if (products.length < MAX_PRODUCTS) {
          mergeProducts(products, page.products, page.finalUrl)
          enqueue(discoverCatalogLinks(page.$, page.finalUrl))
        }
      }
    } catch (error) {
      console.error(`[OBSERVA] Не удалось загрузить каталог ${pageUrl}:`, error.message)
    }
  }

  while (queue.length && products.length < MAX_PRODUCTS) {
    const batch = queue.splice(0, CRAWL_CONCURRENCY)
    await Promise.all(batch.map(fetchInto))
    progress('crawl', { pages: visited.size, products: products.length, queue: queue.length })
  }

  progress('details', { pages: visited.size, products: products.length })
  // Detail pages linked from product cards — they often expose prices that
  // the listing itself doesn't render.
  const detailQueue = detailCandidates.filter(link => !visited.has(link)).slice(0, MAX_DETAIL_PAGES)
  for (let i = 0; i < detailQueue.length && products.length < MAX_PRODUCTS; i += CRAWL_CONCURRENCY) {
    await Promise.all(detailQueue.slice(i, i + CRAWL_CONCURRENCY).map(async link => {
      visited.add(link)
      try {
        const page = await fetchPage(link)
        if (page.products.length) mergeProducts(products, page.products, page.finalUrl)
      } catch (error) {
        console.error(`[OBSERVA] Не удалось загрузить страницу товара ${link}:`, error.message)
      }
    }))
  }

  progress('done', { pages: visited.size, products: Math.min(products.length, MAX_PRODUCTS) })
  return { url: first.finalUrl, title, fetchedAt: new Date().toISOString(), products: products.slice(0, MAX_PRODUCTS) }
}

module.exports = { fetchAndParse, parsePriceValue, parsePriceText, normalizeUrl }
