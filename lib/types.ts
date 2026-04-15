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
  source: 'api' | 'web' | 'manual' | 'playwright' | 'desktop' | 'worker'
  sourceKind?: string | null
  error?: string
  diff?: number | null
  pct?: number | null
}

export type CompareHistoryRow = {
  role: CompareRow['role']
  name: string
  url: string
  itemId: string | null
  price: number | null
  currency: string | null
  source: CompareRow['source']
  sourceKind?: string | null
}

export type CompareHistoryPoint = {
  runId: string | null
  capturedAt: string
  rows: CompareHistoryRow[]
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
  history?: CompareHistoryPoint[]
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
  syncStatus: 'pending' | 'running' | 'ok' | 'error'
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
  sync_status: 'pending' | 'running' | 'ok' | 'error'
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

export type ComparisonRunStatus = 'pending' | 'running' | 'ok' | 'error'

export type ComparisonRun = {
  id: string
  comparisonId: string
  status: ComparisonRunStatus
  triggerSource: string
  requestedBy: string | null
  requestedAt: string
  startedAt: string | null
  finishedAt: string | null
  workerId: string | null
  error: string | null
  resultSummary: CompareResponse['summary'] | null
  rows: CompareRow[]
}

export type ComparisonRunRecord = {
  id: string
  comparison_id: string
  status: ComparisonRunStatus
  trigger_source: string
  requested_by: string | null
  requested_at: string
  started_at: string | null
  finished_at: string | null
  worker_id: string | null
  error: string | null
  result_summary: CompareResponse['summary'] | null
  comparison_snapshot: SavedComparison | null
  created_at: string
}

export type ComparisonRunRowRecord = {
  id: string
  run_id: string
  position: number
  role: 'mine' | 'competitor'
  name: string
  url: string
  item_id: string | null
  title: string | null
  price: number | null
  currency: string | null
  image_url: string | null
  source: CompareRow['source']
  source_kind: string | null
  error: string | null
  diff: number | null
  pct: number | null
  created_at: string
}
