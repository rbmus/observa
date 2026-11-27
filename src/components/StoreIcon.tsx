import { useEffect, useState } from 'react'
import { useFaviconSrc } from '../utils/favicon'

interface Props {
  url?: string | null
  name?: string
  customIcon?: string | null
  className?: string
}

/** Store icon: user-provided custom icon first, then the favicon chain,
 * then an initials fallback. */
export default function StoreIcon({ url, name = '', customIcon = null, className = 'store-favicon' }: Props) {
  const { src, onError } = useFaviconSrc(url)
  const [customFailed, setCustomFailed] = useState(false)
  useEffect(() => setCustomFailed(false), [customIcon])

  const showingCustom = Boolean(customIcon) && !customFailed
  const icon = showingCustom ? customIcon : src

  let host = ''
  try { host = new URL(url || '').hostname } catch { /* initials below */ }
  const letter = (name || host).slice(0, 1).toLocaleUpperCase('ru') || '↗'

  if (!icon) return <span className={`${className} fallback`} aria-hidden="true">{letter}</span>
  return (
    <img
      className={className}
      src={icon}
      alt=""
      onError={showingCustom ? () => setCustomFailed(true) : onError}
    />
  )
}
