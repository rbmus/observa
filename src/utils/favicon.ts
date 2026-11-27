import { useCallback, useEffect, useMemo, useState } from 'react'

/** Ordered fallback sources for a site icon. The first entries hit the site
 * itself; the rest are public favicon services. */
export function faviconCandidates(url: string): string[] {
  let parsed: URL
  try { parsed = new URL(url) } catch { return [] }
  const host = parsed.hostname
  if (!host) return []
  const origin = parsed.origin
  return [
    `https://favicon.yandex.net/favicon/${encodeURIComponent(host)}`,
    `${origin}/favicon.ico`,
    `${origin}/apple-touch-icon.png`,
    `${origin}/favicon.png`,
    `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`,
    `https://logo.clearbit.com/${encodeURIComponent(host)}`
  ]
}

/**
 * Resolves the best favicon URL for `url`, trying each candidate in order.
 * Icons declared in the page's <link rel="icon"> tags (fetched via the main
 * process) are prepended once available.
 * Returns `src` (null when exhausted) and `onError` to advance the chain.
 */
export function useFaviconSrc(url?: string | null): { src: string | null; onError: () => void; exhausted: boolean } {
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
  const [resolved, setResolved] = useState<string[]>([])

  useEffect(() => {
    setFailed(new Set())
    setResolved([])
    if (!url || typeof window === 'undefined' || !window.observa?.faviconResolve) return
    let cancelled = false
    window.observa.faviconResolve(url)
      .then(icons => { if (!cancelled && Array.isArray(icons) && icons.length) setResolved(icons) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [url])

  const candidates = useMemo(() => {
    if (!url) return []
    const base = faviconCandidates(url)
    const extra = resolved.filter(icon => !base.includes(icon))
    return [...extra, ...base]
  }, [url, resolved])

  const src = candidates.find(candidate => !failed.has(candidate)) || null
  const exhausted = !src

  const onError = useCallback(() => {
    setFailed(prev => {
      if (!src || prev.has(src)) return prev
      const next = new Set(prev)
      next.add(src)
      return next
    })
  }, [src])

  return { src, onError, exhausted }
}

/** Reads an image file, downscales it to a 64px PNG data URL for storage as a custom store icon. */
export function imageFileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => reject(new Error('Файл не является изображением'))
      image.onload = () => {
        const size = 64
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('Не удалось обработать изображение')); return }
        const scale = Math.min(size / image.width, size / image.height)
        const width = image.width * scale
        const height = image.height * scale
        ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height)
        resolve(canvas.toDataURL('image/png'))
      }
      image.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}
