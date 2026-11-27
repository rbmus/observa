export interface Product {
  id: string
  name: string
  url: string | null
  sourceUrl?: string | null
  price: number | null
  currency: string
  imageUrl: string | null
  sourceKey?: string | null
  category: string
  lastChecked: string | null
  createdAt: string
  manualFields?: { name?: boolean; price?: boolean; url?: boolean }
}

export interface Store {
  id: string
  name: string
  url: string
  category: string
  role: 'own' | 'competitor'
  sourceType: 'website' | 'telegram'
  checkIntervalMin: number
  enabled: boolean
  products: Product[]
  lastCheck: string | null
  lastSuccessCheck?: string | null
  status: 'idle' | 'checking' | 'ok' | 'error'
  lastError: string | null
  pageTitle?: string
  customIcon?: string | null
  createdAt: string
  updatedAt: string
}

export interface SourceSetupItem {
  name: string
  url: string
  role: 'own' | 'competitor'
  sourceType: 'website' | 'telegram'
  category: string
  checkIntervalMin: number
  enabled: boolean
}

export interface SourceSetupPreview {
  fileName: string
  sources: (SourceSetupItem & { action: 'add' | 'update' })[]
  addedCount: number
  updatedCount: number
}

export interface PricePoint {
  timestamp: string
  price: number
  currency: string
}

export interface MonitorStatus {
  running: boolean
  startedAt: string | null
  lastTickAt: string | null
  totalChecks: number
  totalErrors: number
  checkingStores: string[]
}

export interface AppSettings {
  autoStartMonitoring: boolean
  closeToTray: boolean
  launchAtLogin: boolean
  startMinimized: boolean
  defaultCheckIntervalMin: number
  maxConcurrentChecks: number
  notifyPriceChanges: boolean
  ownStoreFavicon: string | null
}

export interface AnalyticsFocus {
  key?: string
  search?: string
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'latest' | 'error'
  version: string | null
  percent?: number
  error?: string | null
  packaged?: boolean
  releaseNotes?: string | null
}

export interface MonitorEvent {
  event: 'store:checking' | 'store:checked' | 'store:error' | 'price:changed' | 'monitor:progress'
  storeId?: string
  phase?: 'fetch' | 'crawl' | 'details' | 'saving' | 'done'
  pages?: number | null
  products?: number
  queue?: number
  cancelled?: boolean
  productId?: string
  productName?: string
  oldPrice?: number | null
  newPrice?: number
  currency?: string
  changePercent?: number | null
  title?: string
  productsFound?: number
  added?: number
  updated?: number
  removed?: number
  checkedAt?: string
  error?: string
}

export interface PriceChange {
  storeId: string
  storeName: string
  productId: string
  productName: string
  firstPrice: number
  lastPrice: number
  previousPrice?: number
  changedAt?: string
  lastChangedAt?: string
  currency: string
  changePercent: number
  points: number
}

export interface RecentPriceChange extends PriceChange {
  previousPrice: number
  changedAt: string
  lastChangedAt: string
  suspectedMismatch: boolean
}

export interface Comparison {
  name: string
  offers: { storeName: string; storeId: string; price: number; currency: string }[]
  minPrice: number
  maxPrice: number
  spreadPercent: number
}

export interface PriceOffer {
  productId: string
  productName: string
  storeKey: string
  storeName: string
  storeId: string
  role: 'own' | 'competitor'
  sourceType: 'website' | 'telegram'
  price: number
  currency: string
  lastChecked: string | null
  lastSuccessCheck?: string | null
  stale?: boolean
  staleAfterMs?: number
  manualFields?: { name?: boolean; price?: boolean; url?: boolean }
  sameNameOffers?: string[]
  url: string
}

export interface MarketOffer extends Omit<PriceOffer, 'price'> {
  price: number | null
  imageUrl: string | null
  category: string
  history?: PricePoint[]
}

export interface PriceMatrixRow {
  productName: string
  currency: string
  matchedNames: string[]
  matchConfidence: number
  manual?: boolean
  offers: PriceOffer[]
  ownOffers: PriceOffer[]
  bestCompetitor: PriceOffer | null
  difference: number | null
  differencePercent: number | null
}

export interface SimilarProductsResult {
  productName: string
  currency: string
  offers: MarketOffer[]
}

export interface MatchSuggestionOffer {
  storeId: string
  productId: string
  storeName: string
  productName: string
  price: number
  currency: string
  sourceType: 'website' | 'telegram'
  url: string | null
}

export interface MatchSuggestion {
  score: number
  currency: string
  productName: string
  offers: MatchSuggestionOffer[]
}

export interface AnalyticsSummary {
  storesCount: number
  competitorStoresCount: number
  ownStoresCount: number
  enabledStores: number
  totalProducts: number
  priceStats: { min: number; max: number; avg: number; count: number } | null
  topGainers: PriceChange[]
  topLosers: PriceChange[]
  recentPriceChanges: RecentPriceChange[]
  comparisons: Comparison[]
  priceMatrix: PriceMatrixRow[]
  matchSuggestions: MatchSuggestion[]
  allOffers: MarketOffer[]
  storesStatus: {
    id: string
    name: string
    status: string
    productsCount: number
    lastCheck: string | null
    lastError: string | null
  }[]
}

export interface ParsedPage {
  url: string
  title: string
  fetchedAt: string
  products: { name: string; price: number; currency: string; url: string | null; imageUrl: string | null; sourceKey?: string | null }[]
}

declare global {
  interface Window {
    observa: {
      platform: string
      settingsGet: () => Promise<AppSettings>
      settingsUpdate: (patch: Partial<AppSettings>) => Promise<AppSettings>
      storesList: () => Promise<Store[]>
      storesGet: (id: string) => Promise<Store | null>
      storesAdd: (store: Partial<Store>) => Promise<Store>
      storesUpdate: (id: string, patch: Partial<Store>) => Promise<Store | null>
      storesRemove: (id: string) => Promise<boolean>
      storesAddProduct: (storeId: string, product: Partial<Product>) => Promise<Product | null>
      storesRemoveProduct: (storeId: string, productId: string) => Promise<boolean>
      storesRemoveProducts: (storeId: string, productIds: string[]) => Promise<number>
      storesUpdateProduct: (storeId: string, productId: string, patch: Partial<Product>) => Promise<Product | null>
      sourcesExportSetup: () => Promise<{ saved: boolean; count: number }>
      sourcesReadSetup: () => Promise<SourceSetupPreview | null>
      sourcesApplySetup: (sources: SourceSetupItem[]) => Promise<{ addedCount: number; updatedCount: number }>
      monitorStatus: () => Promise<MonitorStatus>
      monitorStartAtLogin: () => Promise<boolean>
      monitorSetStartAtLogin: (enabled: boolean) => Promise<boolean>
      monitorStart: () => Promise<MonitorStatus>
      monitorStop: () => Promise<MonitorStatus>
      monitorCheckNow: (storeId: string) => Promise<{ ok: boolean; error?: string }>
      monitorCheckAll: () => Promise<{ storeId: string; ok: boolean; cancelled?: boolean; error?: string; added?: number; updated?: number; removed?: number; productsFound?: number }[]>
      monitorCancelChecks: () => Promise<number>
      monitorHistory: (storeId: string, productId: string) => Promise<PricePoint[]>
      monitorProducts: (storeId: string) => Promise<Product[]>
      monitorFetchPage: (url: string, sourceType?: Store['sourceType'], storeId?: string) => Promise<ParsedPage>
      openExternal: (url: string) => Promise<void>
      faviconResolve: (url: string) => Promise<string[]>
      onMonitorEvent: (cb: (data: MonitorEvent) => void) => () => void
      onAppNavigate: (cb: (page: 'dashboard' | 'analytics' | 'monitoring' | 'stores' | 'settings') => void) => () => void
      onDataChanged: (cb: () => void) => () => void
      winMinimize: () => Promise<void>
      winToggleMaximize: () => Promise<void>
      winClose: () => Promise<void>
      appVersion: () => Promise<string>
      updateStatus: () => Promise<UpdateState>
      updateCheck: () => Promise<{ ok: boolean; error?: string }>
      updateDownload: () => Promise<void>
      updateInstall: () => Promise<void>
      onUpdateEvent: (cb: (state: UpdateState) => void) => () => void
      analyticsSummary: () => Promise<AnalyticsSummary>
      analyticsSimilarProducts: (storeId: string, productId: string) => Promise<SimilarProductsResult | null>
      analyticsPriceDynamics: (storeId: string, productId: string) => Promise<PricePoint[]>
      analyticsSaveMatch: (refs: { storeId: string; productId: string }[], label: string) => Promise<void>
      analyticsSeparateMatch: (refs: { storeId: string; productId: string }[]) => Promise<void>
      analyticsExportCsv: (rows: PriceMatrixRow[]) => Promise<boolean>
      analyticsExportExcel: (rows: PriceMatrixRow[]) => Promise<boolean>
      analyticsExportPdf: (rows: PriceMatrixRow[]) => Promise<boolean>
    }
  }
}

export {}
