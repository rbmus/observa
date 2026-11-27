import { useEffect, useState } from 'react'
import { Icon, type IconName } from './icons'
import { useFaviconSrc } from '../utils/favicon'

interface Props {
  imageUrl?: string | null
  sourceUrl?: string | null
  alt?: string
  className?: string
  placeholderClassName?: string
  placeholderIcon?: IconName
}

export default function ProductImage({ imageUrl, sourceUrl, alt = '', className, placeholderClassName, placeholderIcon = 'box' }: Props) {
  const [imageFailed, setImageFailed] = useState(false)
  const { src: favicon, onError: onFaviconError } = useFaviconSrc(!imageUrl || imageFailed ? sourceUrl : null)

  useEffect(() => setImageFailed(false), [imageUrl, sourceUrl])

  const currentSrc = imageUrl && !imageFailed ? imageUrl : favicon
  if (!currentSrc) return <span className={`${placeholderClassName || 'product-image-placeholder'} ${className || ''}`.trim()} aria-hidden="true"><Icon name={placeholderIcon} size={24} /></span>

  return <img
    className={className}
    src={currentSrc}
    alt={alt}
    loading="lazy"
    onError={() => (imageUrl && !imageFailed ? setImageFailed(true) : onFaviconError())}
  />
}
