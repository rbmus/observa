import { useEffect, useState } from 'react'
import type { Store, Product, PricePoint, ParsedPage, SimilarProductsResult } from '../types'
import { formatPrice, formatPercent, formatDate, timeAgo } from '../utils/format'
import PriceChart from '../components/PriceChart'
import { Icon } from '../components/icons'
import Loader from '../components/Loader'
import Checkbox from '../components/Checkbox'
import FeedbackModal from '../components/FeedbackModal'
import ProductImage from '../components/ProductImage'

interface Props {
  storeId: string
  onBack: () => void
}

export default function StoreDetail({ storeId, onBack }: Props) {
  const [store, setStore] = useState<Store | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [history, setHistory] = useState<PricePoint[]>([])
  const [checking, setChecking] = useState(false)
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [editProductBusy, setEditProductBusy] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', url: '', price: '', currency: 'RUB', lockName: false, lockUrl: false, lockPrice: false })
  const [productForm, setProductForm] = useState({ name: '', url: '', price: '' })
  const [scanResult, setScanResult] = useState<ParsedPage | null>(null)
  const [scanning, setScanning] = useState(false)
  const [view, setView] = useState<'grid' | 'table'>('table')
  const [search, setSearch] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null)
  const [pendingProductRemoval, setPendingProductRemoval] = useState<Product | null>(null)
  const [removingProduct, setRemovingProduct] = useState(false)
  const [similar, setSimilar] = useState<{ product: Product; result: SimilarProductsResult | null } | null>(null)
  const [similarLoading, setSimilarLoading] = useState(false)

  const refresh = () => {
    window.observa.storesGet(storeId).then(s => {
      setStore(s)
      if (s) setProducts(s.products)
    })
  }

  useEffect(() => {
    refresh()
    let timer: number | undefined
    const unsubscribe = window.observa.onDataChanged(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        refresh()
        if (selectedProduct) window.observa.monitorHistory(storeId, selectedProduct.id).then(setHistory)
      }, 250)
    })
    return () => { window.clearTimeout(timer); unsubscribe() }
  }, [storeId, selectedProduct?.id])

  useEffect(() => {
    if (selectedProduct) {
      window.observa.monitorHistory(storeId, selectedProduct.id).then(setHistory)
    }
  }, [selectedProduct])

  const openProduct = async (product: Product) => {
    setSelectedProduct(product)
    setSimilar({ product, result: null })
    setSimilarLoading(true)
    try {
      const result = await window.observa.analyticsSimilarProducts(storeId, product.id)
      setSimilar(current => current && current.product.id === product.id ? { product, result } : current)
    } catch {
      setSimilar(current => current && current.product.id === product.id
        ? { product, result: { productName: product.name, currency: product.currency || 'RUB', offers: [] } }
        : current)
    } finally {
      setSimilarLoading(false)
    }
  }

  const checkNow = async () => {
    setChecking(true)
    await window.observa.monitorCheckNow(storeId)
    setChecking(false)
    refresh()
  }

  const scanStore = async () => {
    if (!store) return
    setScanning(true)
    setScanResult(null)
    try {
      const result = await window.observa.monitorFetchPage(store.url, store.sourceType)
      setScanResult(result)
    } catch (e: any) {
      setNotice({ title: 'Не удалось просканировать источник', message: e.message || String(e) })
    } finally {
      setScanning(false)
    }
  }

  const importScanned = async () => {
    if (!scanResult) return
    const removable = products.filter(p => !p.manualFields?.name && !p.manualFields?.price && !p.manualFields?.url)
    if (removable.length) await window.observa.storesRemoveProducts(storeId, removable.map(p => p.id))
    const fresh = scanResult.products.slice(0, 500)
    for (const p of fresh) {
      await window.observa.storesAddProduct(storeId, {
        name: p.name, url: p.url, price: p.price, currency: p.currency, imageUrl: p.imageUrl, sourceKey: p.sourceKey
      })
    }
    setScanResult(null)
    refresh()
    setNotice({ title: 'Импорт завершён', message: `Список обновлён: ${fresh.length} товаров.` })
  }

  const addManualProduct = async () => {
    if (!productForm.name) return
    await window.observa.storesAddProduct(storeId, {
      name: productForm.name,
      url: productForm.url || null,
      price: productForm.price ? Number(productForm.price) : null
    })
    setProductForm({ name: '', url: '', price: '' })
    setShowAddProduct(false)
    refresh()
  }

  const openProductEditor = (product: Product) => {
    setEditingProduct(product)
    setEditForm({
      name: product.name,
      url: product.url || '',
      price: product.price == null ? '' : String(product.price),
      currency: product.currency || 'RUB',
      lockName: Boolean(product.manualFields?.name),
      lockUrl: Boolean(product.manualFields?.url),
      lockPrice: Boolean(product.manualFields?.price)
    })
  }

  const saveProductEdit = async () => {
    if (!editingProduct) return
    setEditProductBusy(true)
    try {
      const updated = await window.observa.storesUpdateProduct(storeId, editingProduct.id, {
        name: editForm.name,
        url: editForm.url || null,
        price: editForm.price === '' ? null : Number(editForm.price),
        currency: editForm.currency,
        manualFields: { name: editForm.lockName, url: editForm.lockUrl, price: editForm.lockPrice }
      })
      if (updated) {
        if (selectedProduct?.id === updated.id) setSelectedProduct(updated)
        setEditingProduct(null)
        refresh()
      }
    } catch (e: any) {
      setNotice({ title: 'Не удалось сохранить товар', message: e.message || String(e) })
    } finally {
      setEditProductBusy(false)
    }
  }

  const removeProduct = async () => {
    if (!pendingProductRemoval) return
    setRemovingProduct(true)
    try {
      await window.observa.storesRemoveProduct(storeId, pendingProductRemoval.id)
      if (selectedProduct?.id === pendingProductRemoval.id) setSelectedProduct(null)
      setPendingProductRemoval(null)
      refresh()
    } catch (e: any) {
      setPendingProductRemoval(null)
      setNotice({ title: 'Не удалось удалить товар', message: e.message || String(e) })
    } finally {
      setRemovingProduct(false)
    }
  }

  const updateSettings = async (patch: Partial<Store>) => {
    setSavingSettings(true)
    try {
      const updated = await window.observa.storesUpdate(storeId, patch)
      if (updated) setStore(updated)
    } finally { setSavingSettings(false) }
  }

  const filtered = products
    .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()))
    .slice()
    .sort((a, b) => {
      if (a.price == null && b.price == null) return a.name.localeCompare(b.name, 'ru')
      if (a.price == null) return 1
      if (b.price == null) return -1
      return a.price - b.price || a.name.localeCompare(b.name, 'ru')
    })

  const prices = products.map(p => p.price).filter((p): p is number => p != null)
  const minPrice = prices.length ? Math.min(...prices) : null
  const maxPrice = prices.length ? Math.max(...prices) : null

  if (!store) {
    return <div className="page-loader"><Loader size={36} />Загрузка магазина…</div>
  }

  return (
    <div className="store-detail-page">
      <div className="page-header">
        <div>
          <button className="btn small" onClick={onBack} style={{ marginBottom: 10 }}><Icon name="back" size={14} /> К источникам</button>
          <div className="page-title">{store.name}</div>
          <div className="page-subtitle">
            <a
              href="#"
              onClick={e => { e.preventDefault(); window.observa.openExternal(store.url) }}
              style={{ color: 'var(--accent)', textDecoration: 'none' }}
            >
              {store.url}
            </a>
            {' · '}{store.products.length} товаров
          </div>
          <div className="store-settings">
            <Checkbox checked={store.enabled} disabled={savingSettings} label="Отслеживать" onChange={enabled => updateSettings({ enabled })} />
            <span className="settings-divider" />
            <label className="interval-setting">Проверять
              <select className="input small" value={store.checkIntervalMin} disabled={savingSettings} onChange={e => updateSettings({ checkIntervalMin: Number(e.target.value) })}>
                <option value={15}>каждые 15 мин</option>
                <option value={30}>каждые 30 мин</option>
                <option value={60}>каждый час</option>
                <option value={180}>каждые 3 часа</option>
                <option value={720}>каждые 12 часов</option>
                <option value={1440}>раз в день</option>
              </select>
            </label>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" onClick={scanStore} disabled={scanning}>
            {scanning ? 'Сканирование…' : <><Icon name="search" size={14} /> Сканировать сайт</>}
          </button>
          <button className="btn" onClick={checkNow} disabled={checking || store.status === 'checking'}>
            {checking ? 'Проверка…' : <><Icon name="zap" size={14} /> Проверить цены</>}
          </button>
          <button className="btn primary" onClick={() => setShowAddProduct(true)}><Icon name="plus" size={14} /> Товар</button>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Товаров</div>
          <div className="stat-value">{products.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Мин. цена</div>
          <div className="stat-value">{formatPrice(minPrice)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Макс. цена</div>
          <div className="stat-value">{formatPrice(maxPrice)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Последнее успешное обновление</div>
          <div className="stat-value small">{timeAgo(store.lastSuccessCheck || (store.status === 'ok' ? store.lastCheck : null))}</div>
        </div>
      </div>

      {/* Результаты сканирования */}
      {scanResult && (
        <div className="chart-container" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <b>{scanResult.title}</b>
              <span style={{ color: 'var(--text-secondary)', marginLeft: 10 }}>
                найдено {scanResult.products.length} {store.sourceType === 'telegram' ? 'предложений в постах' : 'товаров с ценами'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn primary small" onClick={importScanned}>
                Импортировать найденное ({Math.min(scanResult.products.length, 500)})
              </button>
              <button className="btn small" onClick={() => setScanResult(null)}>Закрыть</button>
            </div>
          </div>
          <div className="products-grid" style={{ maxHeight: 380, overflowY: 'auto' }}>
            {scanResult.products.slice(0, 100).map((p, i) => (
              <div className="product-card" key={i}>
                <div className="product-img">
                  <ProductImage imageUrl={p.imageUrl} sourceUrl={p.url || store?.url} className="product-image" />
                </div>
                <div className="product-body">
                  <div className="product-name">{p.name}</div>
                  <div className="product-price">{formatPrice(p.price, p.currency)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Панель товара с графиком — открывается модалкой с похожими товарами */}

      {/* Поиск и переключатель вида */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
        <input
          className="input small"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск товаров…"
          style={{ flex: 1, maxWidth: 320 }}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          <button className={`btn small ${view === 'grid' ? 'primary' : ''}`} onClick={() => setView('grid')}><Icon name="grid" size={14} /></button>
          <button className={`btn small ${view === 'table' ? 'primary' : ''}`} onClick={() => setView('table')}><Icon name="list" size={14} /></button>
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Показано {filtered.length} из {products.length}
        </span>
      </div>

      {/* Товары */}
      {view === 'grid' ? (
        <div className="products-grid">
          {filtered.map(p => (
            <div
              className="product-card"
              key={p.id}
              style={{ cursor: 'pointer' }}
              onClick={() => openProduct(p)}
            >
              <div className="product-img">
                <ProductImage imageUrl={p.imageUrl} sourceUrl={p.sourceUrl || p.url || store?.url} className="product-image" />
              </div>
              <div className="product-body">
                <div className="product-name">{p.name}</div>
                <div className="product-price">{formatPrice(p.price, p.currency)}</div>
                <div className="product-meta">
                  <span>{timeAgo(p.lastChecked)}</span>
                  <button className="btn small" aria-label={`Редактировать ${p.name}`} title="Редактировать товар" style={{ padding: '3px 8px' }} onClick={e => { e.stopPropagation(); openProductEditor(p) }}><Icon name="pencil" size={12} /></button>
                  <button
                    className="btn small danger"
                    style={{ padding: '3px 8px' }}
                    onClick={e => { e.stopPropagation(); setPendingProductRemoval(p) }}
                  ><Icon name="close" size={12} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Товар</th>
                <th>Цена</th>
                <th>Проверен</th>
                <th>Создан</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => openProduct(p)}>
                  <td>
                    <div style={{ fontWeight: 500, maxWidth: 400 }}>{p.name}</div>
                    {p.url && (
                      <a
                        href="#"
                        onClick={e => { e.stopPropagation(); p.url && window.observa.openExternal(p.url) }}
                        style={{ fontSize: 11, color: 'var(--accent)' }}
                      >
                        Открыть на сайте <Icon name="external" size={11} />
                      </a>
                    )}
                  </td>
                  <td style={{ fontWeight: 700, color: 'var(--accent)' }}>{formatPrice(p.price, p.currency)}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{timeAgo(p.lastChecked)}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{formatDate(p.createdAt)}</td>
                  <td>
                    <button className="btn small" aria-label={`Редактировать ${p.name}`} title="Редактировать товар" style={{ marginRight: 6 }} onClick={e => { e.stopPropagation(); openProductEditor(p) }}><Icon name="pencil" size={12} /></button>
                    <button className="btn small danger" aria-label={`Удалить ${p.name}`} onClick={e => { e.stopPropagation(); setPendingProductRemoval(p) }}><Icon name="close" size={12} /></button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--text-secondary)' }}>
                  {products.length === 0
                    ? 'Товаров пока нет. Нажмите «Сканировать сайт» или «Проверить цены».'
                    : 'Ничего не найдено по запросу'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Модалка похожих товаров */}
      {similar && (
        <div className="modal-overlay" onClick={() => setSimilar(null)}>
          <div className="modal similar-modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: 0 }}>{similar.product.name}</h3>
                <div className="product-price" style={{ marginTop: 6 }}>{formatPrice(similar.product.price, similar.product.currency)}</div>
              </div>
              <button className="btn small" onClick={() => setSimilar(null)}><Icon name="close" size={12} /> Закрыть</button>
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
              {similarLoading
                ? 'Ищем похожие предложения…'
                : similar.result
                  ? `Найдено предложений: ${similar.result.offers.length}${similar.result.offers.length ? ' — цены по всем источникам' : ''}`
                  : ''}
            </div>

            {similarLoading ? (
              <div className="page-loader"><Loader size={28} /></div>
            ) : similar.result && similar.result.offers.length > 0 ? (
              <div className="similar-grid">
                {similar.result.offers.map(offer => (
                  <div className={`product-card similar-card ${offer.storeId === storeId ? 'similar-card-own' : ''}`} key={`${offer.storeId}:${offer.productId}`}>
                    <div className="product-img">
                      <ProductImage imageUrl={offer.imageUrl} sourceUrl={offer.url || store?.url} className="product-image" />
                    </div>
                    <div className="product-body">
                      <div className="product-name" title={offer.productName}>{offer.productName}</div>
                      <div className="similar-store">{offer.role === 'own' ? '★ ' : ''}{offer.storeName}</div>
                      <div className="product-price">{formatPrice(offer.price, offer.currency)}</div>
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
                ))}
              </div>
            ) : !similarLoading && (
              <div className="empty-state" style={{ padding: '24px 0' }}>Похожих товаров с ценами не найдено</div>
            )}

            {history.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <PriceChart data={history} />
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
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
      )}

      {/* Модалка добавления товара */}
      {showAddProduct && (
        <div className="modal-overlay" onClick={() => setShowAddProduct(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Добавить товар вручную</h3>
            <div className="form-group">
              <label>Название *</label>
              <input value={productForm.name} onChange={e => setProductForm({ ...productForm, name: e.target.value })} />
            </div>
            <div className="form-group">
              <label>URL товара</label>
              <input value={productForm.url} onChange={e => setProductForm({ ...productForm, url: e.target.value })} placeholder="https://…" />
            </div>
            <div className="form-group">
              <label>Цена</label>
              <input value={productForm.price} onChange={e => setProductForm({ ...productForm, price: e.target.value })} placeholder="0.00" />
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowAddProduct(false)}>Отмена</button>
              <button className="btn primary" onClick={addManualProduct}>Добавить</button>
            </div>
          </div>
        </div>
      )}

      {editingProduct && (
        <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !editProductBusy) setEditingProduct(null) }}>
          <div className="modal product-edit-modal" role="dialog" aria-modal="true" aria-labelledby="product-edit-title" onMouseDown={e => e.stopPropagation()}>
            <h3 id="product-edit-title">Исправить предложение</h3>
            <div className="form-group"><label>Название</label><input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} /></div>
            <label className="manual-lock-option"><input type="checkbox" checked={editForm.lockName} onChange={e => setEditForm({ ...editForm, lockName: e.target.checked })} /> Закрепить название, не заменять при парсинге</label>
            <div className="form-group"><label>Ссылка на предложение</label><input value={editForm.url} onChange={e => setEditForm({ ...editForm, url: e.target.value })} placeholder="https://…" /></div>
            <label className="manual-lock-option"><input type="checkbox" checked={editForm.lockUrl} onChange={e => setEditForm({ ...editForm, lockUrl: e.target.checked })} /> Закрепить ссылку</label>
            <div className="form-row">
              <div className="form-group"><label>Цена</label><input type="number" min="0" step="any" value={editForm.price} onChange={e => setEditForm({ ...editForm, price: e.target.value })} /></div>
              <div className="form-group"><label>Валюта</label><input value={editForm.currency} maxLength={8} onChange={e => setEditForm({ ...editForm, currency: e.target.value })} /></div>
            </div>
            <label className="manual-lock-option"><input type="checkbox" checked={editForm.lockPrice} onChange={e => setEditForm({ ...editForm, lockPrice: e.target.checked })} /> Закрепить цену и не записывать автоматические изменения</label>
            <div className="modal-actions">
              <button className="btn" onClick={() => setEditingProduct(null)} disabled={editProductBusy}>Отмена</button>
              <button className="btn primary" onClick={saveProductEdit} disabled={editProductBusy}>{editProductBusy ? 'Сохраняю…' : 'Сохранить'}</button>
            </div>
          </div>
        </div>
      )}

      {notice && <FeedbackModal title={notice.title} message={notice.message} onClose={() => setNotice(null)} />}
      {pendingProductRemoval && <FeedbackModal
        title="Удалить товар?"
        message={`«${pendingProductRemoval.name}» и история его цены будут удалены.`}
        kind="confirm"
        confirmLabel="Удалить товар"
        busy={removingProduct}
        onClose={() => setPendingProductRemoval(null)}
        onConfirm={removeProduct}
      />}
    </div>
  )
}
