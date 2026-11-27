const axios = require('axios')
const cheerio = require('cheerio')

// Полный Chrome UA DDG встречает 202-челленджем — короткий проходит.
const UA = 'Mozilla/5.0'
const TIMEOUT = 15000

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

/** Ищет каноническое название и описание продукта в DuckDuckGo.
 *  Возвращает { canonicalName, description } или null, если ничего не найдено. */
async function enrichProduct(query) {
  const q = cleanText(query)
  if (q.length < 3) return null
  let html = null
  try {
    const res = await axios.post('https://lite.duckduckgo.com/lite/', `q=${encodeURIComponent(q)}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
      timeout: TIMEOUT,
      maxRedirects: 3,
      validateStatus: s => s >= 200 && s < 400
    })
    html = res.data
  } catch { /* fallback ниже */ }
  if (!html) {
    try {
      const res = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
        headers: { 'User-Agent': UA },
        timeout: TIMEOUT,
        maxRedirects: 3,
        validateStatus: s => s >= 200 && s < 400
      })
      html = res.data
    } catch { return null }
  }
  const $ = cheerio.load(html)
  const titles = []
  $('a.result-link, a.result__a').each((_, el) => {
    const text = cleanText($(el).text())
    if (text && text.length >= 3 && text.length <= 200) titles.push(text)
  })
  const snippets = []
  $('td.result-snippet, .result__snippet, .result-snippet').each((_, el) => {
    const text = cleanText($(el).text())
    if (text && text.length >= 20) snippets.push(text)
  })
  // 202 — антибот-страница DDG: один повтор через паузу.
  if (!titles.length && !snippets.length) {
    await new Promise(resolve => setTimeout(resolve, 2500))
    try {
      const retry = await axios.post('https://lite.duckduckgo.com/lite/', `q=${encodeURIComponent(q)}`, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        timeout: TIMEOUT,
        maxRedirects: 3,
        validateStatus: s => s >= 200 && s < 400
      })
      const $retry = cheerio.load(retry.data)
      $retry('a.result-link, a.result__a').each((_, el) => {
        const text = cleanText($retry(el).text())
        if (text && text.length >= 3 && text.length <= 200) titles.push(text)
      })
      $retry('td.result-snippet, .result__snippet, .result-snippet').each((_, el) => {
        const text = cleanText($retry(el).text())
        if (text && text.length >= 20) snippets.push(text)
      })
    } catch { /* ignore */ }
  }
  if (!titles.length && !snippets.length) return null
  return {
    canonicalName: titles[0] || null,
    description: snippets.slice(0, 3).join(' ').slice(0, 600) || null
  }
}

module.exports = { enrichProduct }
