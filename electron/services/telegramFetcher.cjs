const axios = require('axios')
const cheerio = require('cheerio')
const { cleanTelegramName } = require('./telegramText.cjs')

const CURRENCIES = { '₽': 'RUB', 'руб': 'RUB', 'р': 'RUB', 'р.': 'RUB', '$': 'USD', 'usd': 'USD', '€': 'EUR', 'eur': 'EUR' }

function normalizeTelegramChannelUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) throw new Error('Укажите публичную ссылку на Telegram-канал')
  if (raw.startsWith('@')) return normalizeTelegramChannelUrl(`https://t.me/s/${raw.slice(1)}`)
  let parsed
  try { parsed = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`) }
  catch { throw new Error('Ссылка на Telegram-канал некорректна') }
  if (!['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me'].includes(parsed.hostname.toLowerCase())) {
    throw new Error('Для источника Telegram укажите ссылку t.me на публичный канал')
  }
  const parts = parsed.pathname.split('/').filter(Boolean)
  const username = parts[0]?.toLowerCase() === 's' ? parts[1] : parts[0]
  if (!username || username.startsWith('+') || username === 'joinchat' || !/^[a-z][a-z0-9_]{4,31}$/i.test(username)) {
    throw new Error('Нужна публичная ссылка вида t.me/имя_канала')
  }
  return `https://t.me/s/${username}`
}

function parseNumber(raw) {
  let value = String(raw).replace(/\s|\u00a0/g, '')
  const comma = value.lastIndexOf(',')
  const dot = value.lastIndexOf('.')
  const decimal = Math.max(comma, dot)
  if (comma >= 0 && dot >= 0) {
    value = value.slice(0, decimal).replace(/[,.]/g, '') + '.' + value.slice(decimal + 1)
  } else if (decimal >= 0) {
    const fraction = value.length - decimal - 1
    value = fraction === 3
      ? value.replace(/[,.]/g, '')
      : value.slice(0, decimal).replace(/[,.]/g, '') + '.' + value.slice(decimal + 1)
  }
  const result = Number(value)
  return Number.isFinite(result) && result > 0 && result <= 10000000 ? result : null
}

function extractPhoto($, $post) {
  const style = $post.find('.tgme_widget_message_photo_wrap').first().attr('style') || ''
  const match = style.match(/url\(['"]?(.*?)['"]?\)/i)
  return match?.[1] || null
}

async function fetchTelegramChannel(value) {
  const url = normalizeTelegramChannelUrl(value)
  const response = await axios.get(url, {
    timeout: 20000,
    maxRedirects: 5,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36' },
    validateStatus: status => status >= 200 && status < 400
  })
  const $ = cheerio.load(response.data)
  const title = $('.tgme_channel_info_header_title').first().text().trim() || url
  const products = []
  const seen = new Set()
  const pricePattern = /([\d\s\u00a0.,]+?)\s*(₽|руб\.?|р\.?|RUB|USD|\$|EUR|€)/gi

  $('.tgme_widget_message[data-post]').each((_, element) => {
    const $post = $(element)
    const postId = $post.attr('data-post')
    const $text = $post.find('.tgme_widget_message_text').first().clone()
    $text.find('tg-emoji, .emoji, [data-entity-type="MessageEntityCustomEmoji"]').remove()
    const text = cleanTelegramName($text.text())
    if (!postId || !text) return
    const normalizedLines = text.split(/\n+/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
    const matches = []
    let match
    pricePattern.lastIndex = 0
    while ((match = pricePattern.exec(text)) !== null) {
      const price = parseNumber(match[1])
      const currency = CURRENCIES[match[2].toLowerCase()]
      if (price && currency) matches.push({ price, currency, raw: match[0].trim() })
    }
    if (!matches.length) return

    const lineFor = raw => normalizedLines.find(line => line.includes(raw)) || normalizedLines[0]
    const permalink = `https://t.me/${postId}`
    const imageUrl = extractPhoto($, $post)
    const baseName = cleanTelegramName(normalizedLines.find(line => {
      pricePattern.lastIndex = 0
      return !pricePattern.test(line) && line.length > 3
    }) || title)
    pricePattern.lastIndex = 0

    matches.forEach((item, index) => {
      const sourceLine = lineFor(item.raw)
      const cleanLine = cleanTelegramName(sourceLine.replace(pricePattern, '').replace(/[\s:—–-]+/g, ' '))
      pricePattern.lastIndex = 0
      const name = cleanTelegramName(matches.length > 1 && cleanLine.length > 3
        ? `${baseName} · ${cleanLine}`
        : baseName)
      if (name.length < 2) return
      const key = `${postId}:${index}`
      if (seen.has(key)) return
      seen.add(key)
      products.push({ name: name.slice(0, 300), price: item.price, currency: item.currency, url: permalink, imageUrl, sourceKey: `telegram:${key}` })
    })
  })

  if (!title) throw new Error('Не удалось прочитать публичный Telegram-канал')
  return { url, title, fetchedAt: new Date().toISOString(), products: products.slice(0, 500) }
}

module.exports = { fetchTelegramChannel, normalizeTelegramChannelUrl }
