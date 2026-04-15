import type {
  ComparisonRecord,
  ComparisonRun,
  ComparisonRunRecord,
  ComparisonRunRowRecord,
  CompetitorRecord,
  CompareHistoryPoint,
  ManualOverride,
  SavedComparison,
  CompareRow,
} from '@/lib/types'

function errorText(error: unknown) {
  if (!error || typeof error !== 'object') return ''
  const record = error as Record<string, unknown>
  return [record.code, record.message, record.details, record.hint].filter(Boolean).join(' ').toLowerCase()
}

export function isMissingRunHistoryError(error: unknown) {
  const text = errorText(error)
  if (!text) return false

  const mentionsRuns =
    text.includes('comparison_runs') ||
    text.includes('comparison_run_rows') ||
    text.includes('comparison_snapshot') ||
    text.includes('result_summary') ||
    text.includes('worker_id') ||
    text.includes('started_at') ||
    text.includes('finished_at') ||
    text.includes('relation') ||
    text.includes('schema cache')

  const missingSignals =
    text.includes('42p01') ||
    text.includes('42703') ||
    text.includes('pgrst205') ||
    text.includes('does not exist') ||
    text.includes('could not find') ||
    text.includes('not found in the schema cache')

  return mentionsRuns && missingSignals
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function emptyManual(): ManualOverride {
  return {
    title: '',
    price: '',
    itemId: '',
    imageUrl: '',
    currency: 'ARS',
  }
}

export function normalizeCompareRow(value: any): CompareRow {
  return {
    role: value?.role === 'mine' ? 'mine' : 'competitor',
    name: value?.name || '',
    url: value?.url || '',
    itemId: value?.itemId ?? value?.item_id ?? null,
    title: value?.title ?? null,
    price: asNumber(value?.price),
    currency: value?.currency ?? null,
    imageUrl: value?.imageUrl ?? value?.image_url ?? null,
    source: (value?.source || 'web') as CompareRow['source'],
    sourceKind: value?.sourceKind ?? value?.source_kind ?? null,
    error: value?.error || undefined,
    diff: asNumber(value?.diff),
    pct: asNumber(value?.pct),
  }
}

function normalizeHistoryPoint(value: any): CompareHistoryPoint | null {
  const capturedAt = typeof value?.capturedAt === 'string' ? value.capturedAt : null
  const rawRows = Array.isArray(value?.rows) ? value.rows : []

  if (!capturedAt || !rawRows.length) return null

  return {
    runId: typeof value?.runId === 'string' ? value.runId : null,
    capturedAt,
    rows: rawRows.map((row: any) => {
      const normalized = normalizeCompareRow(row)
      return {
        role: normalized.role,
        name: normalized.name,
        url: normalized.url,
        itemId: normalized.itemId,
        price: normalized.price,
        currency: normalized.currency,
        source: normalized.source,
        sourceKind: normalized.sourceKind ?? null,
      }
    }),
  }
}

export function mapComparison(record: ComparisonRecord, competitors: CompetitorRecord[]): SavedComparison {
  const lastResult = record.last_result
    ? {
        ...record.last_result,
        rows: (record.last_result.rows || []).map(normalizeCompareRow),
        history: Array.isArray((record.last_result as any).history)
          ? (record.last_result as any).history
              .map(normalizeHistoryPoint)
              .filter((point: CompareHistoryPoint | null): point is CompareHistoryPoint => Boolean(point))
          : [],
      }
    : null

  return {
    id: record.id,
    name: record.name,
    category: record.category,
    myName: record.my_name,
    myUrl: record.my_url,
    myManual: record.my_manual || emptyManual(),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    lastResult,
    syncStatus: record.sync_status || 'pending',
    lastSyncedAt: record.last_synced_at || null,
    syncError: record.sync_error || null,
    competitors: competitors
      .sort((a, b) => a.position - b.position)
      .map((competitor) => ({
        id: competitor.id,
        name: competitor.name,
        url: competitor.url,
        position: competitor.position,
        manualOverride: competitor.manual_override || emptyManual(),
      })),
  }
}

export function mapRun(record: ComparisonRunRecord, rows: ComparisonRunRowRecord[] = []): ComparisonRun {
  return {
    id: record.id,
    comparisonId: record.comparison_id,
    status: record.status,
    triggerSource: record.trigger_source,
    requestedBy: record.requested_by || null,
    requestedAt: record.requested_at || record.created_at,
    startedAt: record.started_at || null,
    finishedAt: record.finished_at || null,
    workerId: record.worker_id || null,
    error: record.error || null,
    resultSummary: record.result_summary || null,
    rows: rows
      .sort((a, b) => a.position - b.position)
      .map((row) =>
        normalizeCompareRow({
          ...row,
          itemId: row.item_id,
          imageUrl: row.image_url,
          sourceKind: row.source_kind,
        }),
      ),
  }
}

export async function readComparisonWithCompetitors(supabase: any, id: string): Promise<SavedComparison> {
  const { data: comparisonRow, error: comparisonError } = await supabase
    .from('comparisons')
    .select('*')
    .eq('id', id)
    .single()

  if (comparisonError) throw comparisonError

  const { data: competitorRows, error: competitorError } = await supabase
    .from('comparison_competitors')
    .select('*')
    .eq('comparison_id', id)
    .order('position', { ascending: true })

  if (competitorError) throw competitorError

  return mapComparison(
    comparisonRow as ComparisonRecord,
    (competitorRows || []) as CompetitorRecord[],
  )
}

export async function fetchComparisons(supabase: any): Promise<SavedComparison[]> {
  const { data: comparisonRows, error: comparisonError } = await supabase
    .from('comparisons')
    .select('*')
    .order('updated_at', { ascending: false })

  if (comparisonError) throw comparisonError

  const comparisonIds = (comparisonRows || []).map((row: any) => row.id)
  let competitorsByComparison = new Map<string, CompetitorRecord[]>()

  if (comparisonIds.length) {
    const { data: competitorRows, error: competitorError } = await supabase
      .from('comparison_competitors')
      .select('*')
      .in('comparison_id', comparisonIds)
      .order('position', { ascending: true })

    if (competitorError) throw competitorError

    ;(competitorRows || []).forEach((row: any) => {
      const list = competitorsByComparison.get(row.comparison_id) || []
      list.push(row as CompetitorRecord)
      competitorsByComparison.set(row.comparison_id, list)
    })
  }

  return (comparisonRows || []).map((row: any) =>
    mapComparison(row as ComparisonRecord, competitorsByComparison.get(row.id) || []),
  )
}

export async function listRunsForComparison(supabase: any, comparisonId: string, limit = 12): Promise<ComparisonRun[]> {
  const { data: runRows, error: runError } = await supabase
    .from('comparison_runs')
    .select('*')
    .eq('comparison_id', comparisonId)
    .order('requested_at', { ascending: false })
    .limit(limit)

  if (runError) {
    if (isMissingRunHistoryError(runError)) return []
    throw runError
  }

  const runIds = (runRows || []).map((row: any) => row.id)
  const rowsByRun = new Map<string, ComparisonRunRowRecord[]>()

  if (runIds.length) {
    const { data: detailRows, error: detailError } = await supabase
      .from('comparison_run_rows')
      .select('*')
      .in('run_id', runIds)
      .order('position', { ascending: true })

    if (detailError) {
      if (!isMissingRunHistoryError(detailError)) throw detailError
    } else {
      ;(detailRows || []).forEach((row: any) => {
        const list = rowsByRun.get(row.run_id) || []
        list.push(row as ComparisonRunRowRecord)
        rowsByRun.set(row.run_id, list)
      })
    }
  }

  return (runRows || []).map((row: any) =>
    mapRun(row as ComparisonRunRecord, rowsByRun.get(row.id) || []),
  )
}
