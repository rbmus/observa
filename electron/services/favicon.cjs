const axios = require('axios')
const cheerio = require('cheerio')

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8'
}

const cache = new Map()
const CACHE_TTL = 24 * 60 * 60 * 1000
const MAX_CACHE = 500

function normalizeIconUrl(href, base) {
  if (!href) return null
  const value = String(href).trim()
  if (!value || /^(?:data:|javascript:|#)/i.test(value)) return null
  try {
    const parsed = new URL(value.startsWith('//') ? `https:${value}` : value, base)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch { return null }
}

function iconScore($link) {
  const rel = String($link.attr('rel') || '').toLowerCase()
  const type = String($link.attr('type') || '').toLowerCase()
  const sizes = String($link.attr('sizes') || '')
  let score = 0
  if (rel.includes('apple-touch-icon')) score += 40
  if (rel.includes('icon')) score += 20
  if (/svg/.test(type)) score += 15
  if (/png|x-icon|vnd\.microsoft\.icon/.test(type)) score += 8
  const sizeMatch = sizes.match(/(\d+)x\d+/i)
  if (sizeMatch) score += Math.min(Number(sizeMatch[1]), 512) / 16
  return score
}

function extractIconLinks(html, pageUrl) {
  const $ = cheerio.load(html)
  const icons = []
  $('link[rel]').each((_, el) => {
    const $link = $(el)
    const rel = String($link.attr('rel') || '').toLowerCase()
    if (!/(?:^|\s)(?:shortcut\s+icon|icon|apple-touch-icon(?:-precomposed)?)(?:\s|$)/.test(rel)) return
    const href = normalizeIconUrl($link.attr('href'), pageUrl)
    if (!href) return
    icons.push({ href, score: iconScore($link) })
  })
  // Manifest may declare additional icons.
  const manifestHref = normalizeIconUrl($('link[rel="manifest"]').first().attr('href'), pageUrl)
  icons.sort((a, b) => b.score - a.score)
  const seen = new Set()
  return icons.map(i => i.href).filter(href => !seen.has(href) && seen.add(href)).slice(0, 4)
}

async function resolveFavicon(url) {
  let parsed
  try { parsed = new URL(url) } catch { return [] }
  if (!['http:', 'https:'].includes(parsed.protocol)) return []
  const key = parsed.origin
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.icons

  let icons = []
  try {
    const response = await axios.get(parsed.href, {
      headers: HEADERS,
      timeout: 10000,
      maxRedirects: 5,
      maxContentLength: 2 * 1024 * 1024,
      validateStatus: status => status >= 200 && status < 400,
      responseType: 'text',
      transformResponse: [data => data]
    })
    const finalUrl = response.request?.res?.responseUrl || parsed.href
    const contentType = String(response.headers?.['content-type'] || '')
    if (/text\/html|application\/xhtml/i.test(contentType) && typeof response.data === 'string') {
      icons = extractIconLinks(response.data, finalUrl)
    }
  } catch { /* fall through to defaults */ }

  if (cache.size >= MAX_CACHE) cache.clear()
  cache.set(key, { at: Date.now(), icons })
  return icons
}

module.exports = { resolveFavicon }
