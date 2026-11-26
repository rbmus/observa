export function formatPrice(price: number | null | undefined, currency = 'RUB'): string {
  if (price == null) return '—'
  const symbols: Record<string, string> = { RUB: '₽', USD: '$', EUR: '€' }
  const sym = symbols[currency] || currency
  return `${price.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ${sym}`
}

export function formatPercent(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}%`
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit'
    })
  } catch {
    return iso
  }
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'никогда'
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} ч назад`
  return `${Math.floor(h / 24)} дн назад`
}
