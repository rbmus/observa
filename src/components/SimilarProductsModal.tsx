import { useEffect, useState } from 'react'
import type { PricePoint, Product, SimilarProductsResult } from '../types'
import { formatPrice, formatPercent, timeAgo } from '../utils/format'
import PriceChart from './PriceChart'
import PriceCompareChart from './PriceCompareChart'
import { Icon } from './icons'
import Loader from './Loader'
import ProductImage from './ProductImage'
import { useEscapeKey } from '../utils/useEscapeKey'

interface Props {
  storeId: string
  productId: string
  onClose: () => void
}

export default function SimilarProductsModal({ storeId, productId, onClose }: Props) {
  const [product, setProduct] = useState<Product | null>(null)
  const [storeUrl, setStoreUrl] = useState('')
  const [result, setResult] = useState<SimilarProductsResult | null>(null)
  const [history, setHistory] = useState<PricePoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    setProduct(null)
    setResult(null)
    setHistory([])
    Promise.all([
      window.observa.storesGet(storeId),
      window.observa.analyticsSimilarProducts(storeId, productId),
      window.observa.monitorHistory(storeId, productId)
    ]).then(([store, similar, points]) => {
      if (!active) return
      setProduct(store?.products.find(item => item.id === productId) || null)
      setStoreUrl(store?.url || '')
      setResult(similar)
      setHistory(points)
    }).catch(() => {
      if (active) setResult({ productName: '', currency: 'RUB', offers: [] })
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [storeId, productId])

  useEscapeKey(true, onClose)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal similar-modal" onClick={e => e.stopPropagation()}>
        <div className="similar-modal-head">
          <div>
            <h3>{product?.name || result?.productName || 'Предложение'}</h3>
            {product && <div className="product-price" style={{ marginTop: 6 }}>{formatPrice(product.price, product.currency)}</div>}
          </div>
          <button className="btn small" onClick={onClose}><Icon name="close" size={12} /> Закрыть</button>
        </div>

        <div className="similar-modal-status">
          {loading
            ? 'Ищем похожие предложения…'
            : result
              ? `Найдено предложений: ${result.offers.length}${result.offers.length ? ' — цены по всем источникам' : ''}`
              : ''}
        </div>

        {loading ? (
          <div className="page-loader"><Loader size={28} /></div>
        ) : result && result.offers.length > 0 ? (
          <>
          <div className="similar-compare">
            <div className="similar-section-title">Сравнение цен по магазинам</div>
            <PriceCompareChart offers={result.offers} />
          </div>
          <div className="similar-section-title">Похожие предложения на рынке</div>
          <div className="similar-grid">
            {result.offers.map(offer => (
              <div className={`product-card similar-card ${offer.storeId === storeId ? 'similar-card-own' : ''}`} key={`${offer.storeId}:${offer.productId}`}>
                <div className="product-img">
                  <ProductImage imageUrl={offer.imageUrl} sourceUrl={offer.url || storeUrl} className="product-image" />
                </div>
                <div className="product-body">
                  <div className="product-name" data-tooltip={offer.productName}>{offer.productName}</div>
                  <div className="similar-store">{offer.role === 'own' ? '★ ' : ''}{offer.storeName}</div>
                  <div className="product-price">{formatPrice(offer.price, offer.currency)}</div>
                  <div className="product-meta">
                    <span>{timeAgo(offer.lastChecked)}</span>
                    {offer.url && (
                      <a
                        href="#"
                        className="similar-link"
                        onClick={e => { e.preventDefault(); e.stopPropagation(); window.observa.openExternal(offer.url!) }}
                      >
                        Открыть <Icon name="external" size={11} />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          </>
        ) : !loading && (
          <div className="empty-state compact">Похожих товаров с ценами не найдено</div>
        )}

        {history.length > 0 && (
          <div className="similar-history">
            <div className="similar-section-title">История цены этого товара</div>
            <PriceChart data={history} />
            <div className="similar-history-note">
              Точек истории: {history.length}
              {history.length >= 2 && (
                <> · изменение:{' '}
                  <span className={history[history.length - 1].price > history[0].price ? 'price-up' : 'price-down'}>
                    {formatPercent(((history[history.length - 1].price - history[0].price) / history[0].price) * 100)}
                  </span>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
