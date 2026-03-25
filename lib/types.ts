export type ManualOverride = {
  title: string
  price: string
  itemId: string
  imageUrl: string
  currency: string
}

export type CompetitorInput = {
  id: string
  name: string
  url: string
  position: number
  manualOverride: ManualOverride
}

export type CompareRow = {
  role: 'mine' | 'competitor'
  name: string
  url: string
  itemId: string | null
  title: string | null
  price: number | null
  currency: string | null
  imageUrl: string | null
  source: 'web' | 'manual'
  error?: string
  diff?: number | null
  pct?: number | null
}

export type CompareResponse = {
  comparisonName: string
  rows: CompareRow[]
  summary: {
    total: number
    ok: number
    failed: number
    minePrice: number | null
  }
  error?: string
}

export type SavedComparison = {
  id: string
  name: string
  category: string
  myName: string
  myUrl: string
  myManual: ManualOverride
  competitors: CompetitorInput[]
  createdAt: string
  updatedAt: string
  lastResult: CompareResponse | null
  syncStatus: 'pending' | 'ok' | 'error'
  lastSyncedAt: string | null
  syncError: string | null
}

export type ComparisonRecord = {
  id: string
  name: string
  category: string
  my_name: string
  my_url: string
  my_manual: ManualOverride | null
  last_result: CompareResponse | null
  created_at: string
  updated_at: string
  sync_status: 'pending' | 'ok' | 'error'
  last_synced_at: string | null
  sync_error: string | null
}

export type CompetitorRecord = {
  id: string
  comparison_id: string
  name: string
  url: string
  position: number
  manual_override: ManualOverride | null
  created_at: string
}