export type Row = {
  role: 'mine' | 'competitor'
  name: string
  url: string
  itemId: string | null
  title: string | null
  price: number | null
  currency: string | null
  imageUrl: string | null
  source: 'web'
  error?: string
  diff?: number | null
  pct?: number | null
}

export type CompareResponse = {
  comparisonName: string
  rows: Row[]
  summary: {
    total: number
    ok: number
    failed: number
    minePrice: number | null
  }
  error?: string
}

export type CompetitorInput = {
  id: string
  name: string
  url: string
  position: number
}

export type SavedComparison = {
  id: string
  name: string
  category: string
  myName: string
  myUrl: string
  competitors: CompetitorInput[]
  createdAt: string
  updatedAt: string
  lastResult?: CompareResponse | null
}

export type ComparisonRecord = {
  id: string
  name: string
  category: string
  my_name: string
  my_url: string
  last_result: CompareResponse | null
  created_at: string
  updated_at: string
}

export type CompetitorRecord = {
  id: string
  comparison_id: string
  name: string
  url: string
  position: number
}
