import { useEffect, useState } from 'react'
import { Icon, type IconName } from './icons'

interface Props {
  imageUrl?: string | null
  sourceUrl?: string | null
  alt?: string
  className?: string
  placeholderClassName?: string
  placeholderIcon?: IconName
}

function faviconUrl(sourceUrl?: string | null) {
  try { return `${new URL(sourceUrl || '').origin}/favicon.ico` } catch { return null }
}

export default function ProductImage({ imageUrl, sourceUrl, alt = '', className, placeholderClassName, placeholderIcon = 'box' }: Props) {
  const [stage, setStage] = useState(imageUrl ? 0 : 1)
  const favicon = faviconUrl(sourceUrl)

  useEffect(() => setStage(imageUrl ? 0 : 1), [imageUrl, sourceUrl])

  const currentSrc = stage === 0 ? imageUrl : stage === 1 ? favicon : null
  if (!currentSrc) return <span className={`${placeholderClassName || 'product-image-placeholder'} ${className || ''}`.trim()} aria-hidden="true"><Icon name={placeholderIcon} size={24} /></span>

  return <img
    className={className}
    src={currentSrc}
    alt={alt}
    loading="lazy"
    onError={() => setStage(current => Math.min(current + 1, 2))}
  />
}
