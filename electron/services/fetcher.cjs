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
  try { return new URL(value.startsWith('//') ? `https:${value}` : value, base).href } catch { return null }
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
    const srcset = ($el.attr('data-srcset') || $el.attr('srcset') || '').split(',').pop()?.trim().split(/\s+/)[0]
    const styleImage = ($el.attr('style') || '').match(/url\(["']?([^"')]+)["']?\)/i)?.[1]
    const candidates = [$el.attr('content'), $el.attr('data-zoom-image'), $el.attr('data-large_image'), $el.attr('data-original'), $el.attr('data-original-src'), $el.attr('data-lazy-src'), $el.attr('data-lazy'), $el.attr('data-src'), $el.attr('data-image'), $el.attr('data-background-image'), $el.attr('data-bg'), srcset, $el.attr('src'), styleImage]
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
    '[class*="card-title" i]', '[class*="item-title" i]', '[class*="product-name" i]', '[class*="title" i]',
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
  const iconByPlatform = [
    [/apple|app store/i, 'apple'], [/xbox/i, 'xbox'], [/playstation|psn|ps plus/i, 'playstation'],
    [/steam/i, 'steam'], [/нейросет|\bai\b|chatgpt/i, 'ai']
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
          const icon = iconByPlatform.find(([pattern]) => pattern.test(`${item.platform || ''} ${item.title || ''}`))?.[1]
          return icon ? normalizeUrl(`/icons/${icon}.png`, storefrontUrl.origin) : null
        })(),
        sourceKey: `magap:${item.sku || item.id}`
      }
    })
    .filter(Boolean)

  return {
    url,
    title: cleanName(business.name) || slug,
    fetchedAt: new Date().toISOString(),
    products: products.slice(0, 500)
  }
}

/** Fetches a public catalog page. Structured commerce metadata is preferred over visual heuristics. */
async function fetchAndParse(url) {
  const magapCatalog = await fetchMagapCatalog(url)
  if (magapCatalog) return magapCatalog

  const response = await axios.get(url, { headers: HEADERS, timeout: 20000, maxRedirects: 5, validateStatus: status => status >= 200 && status < 400 })
  const $ = cheerio.load(response.data)
  const title = cleanName($('meta[property="og:site_name"]').attr('content') || $('title').first().text()) || new URL(url).hostname

  const structured = parseStructuredData($, response.request?.res?.responseUrl || url)
  const microdata = extractMicrodata($, response.request?.res?.responseUrl || url)
  $('script, style, noscript, svg, template').remove()
  const cards = extractCatalogCards($, response.request?.res?.responseUrl || url)
  // A complete structured catalog is authoritative. Merging in every visible
  // currency mention would otherwise turn FAQ/support copy into fake products.
  let products = dedupe(structured.length ? structured : [...microdata, ...cards])

  // Product detail pages sometimes publish only Open Graph / standard meta tags.
  if (!products.length) {
    const name = cleanName($('meta[property="og:title"]').attr('content') || $('meta[name="twitter:title"]').attr('content') || $('h1').first().text())
    const price = parsePriceValue($('meta[property="product:price:amount"]').attr('content') || $('meta[property="og:price:amount"]').attr('content'))
    const currency = normalizeCurrency($('meta[property="product:price:currency"]').attr('content') || $('meta[property="og:price:currency"]').attr('content'))
    const imageUrl = normalizeUrl($('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content'), response.request?.res?.responseUrl || url)
    if (name && price !== null) products = [{ name, price, currency, imageUrl, url: response.request?.res?.responseUrl || url }]
  }

  // One product page with JSON-LD and no product image in its scope can still use OG artwork.
  if (products.length === 1 && !products[0].imageUrl) products[0].imageUrl = normalizeUrl($('meta[property="og:image"]').attr('content'), url)
  return { url, title, fetchedAt: new Date().toISOString(), products: products.slice(0, 500) }
}

module.exports = { fetchAndParse, parsePriceValue, parsePriceText, normalizeUrl }
