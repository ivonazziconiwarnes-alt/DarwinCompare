import { isMissingRunHistoryError, mapRun, readComparisonWithCompetitors } from '@/lib/comparison-store'
import { runWebComparison } from '@/lib/ml-web'
import type {
  CompareResponse,
  CompareRow,
  ComparisonRun,
  ComparisonRunRecord,
  ComparisonRunRowRecord,
  SavedComparison,
} from '@/lib/types'

type ExecutionOutcome = {
  comparison: SavedComparison
  result: CompareResponse
  status: 'ok' | 'error'
  error: string | null
  run: ComparisonRun | null
}

function rowsToRecords(runId: string, rows: CompareRow[]): ComparisonRunRowRecord[] {
  const now = new Date().toISOString()

  return rows.map((row, position) => ({
    id: `local-${runId}-${position}`,
    run_id: runId,
    position,
    role: row.role,
    name: row.name,
    url: row.url,
    item_id: row.itemId,
    title: row.title,
    price: row.price,
    currency: row.currency,
    image_url: row.imageUrl,
    source: row.source,
    source_kind: row.sourceKind || null,
    error: row.error || null,
    diff: row.diff ?? null,
    pct: row.pct ?? null,
    created_at: now,
  }))
}

function buildErrorResult(comparisonName: string, error: string): CompareResponse {
  return {
    comparisonName,
    rows: [],
    summary: {
      total: 0,
      ok: 0,
      failed: 0,
      minePrice: null,
    },
    error,
  }
}

async function createRunRecord(
  supabase: any,
  comparisonId: string,
  requestedBy: string | null,
  comparison: SavedComparison,
  startedAt: string,
) {
  const { data, error } = await supabase
    .from('comparison_runs')
    .insert({
      comparison_id: comparisonId,
      status: 'running',
      trigger_source: 'web',
      requested_by: requestedBy,
      requested_at: startedAt,
      started_at: startedAt,
      comparison_snapshot: comparison,
    })
    .select('*')
    .single()

  if (error) {
    if (isMissingRunHistoryError(error)) return null
    throw error
  }

  return data as ComparisonRunRecord
}

async function persistRunRows(supabase: any, runId: string, rows: CompareRow[]) {
  if (!rows.length) return

  const payload = rows.map((row, position) => ({
    run_id: runId,
    position,
    role: row.role,
    name: row.name,
    url: row.url,
    item_id: row.itemId,
    title: row.title,
    price: row.price,
    currency: row.currency,
    image_url: row.imageUrl,
    source: row.source,
    source_kind: row.sourceKind || null,
    error: row.error || null,
    diff: row.diff ?? null,
    pct: row.pct ?? null,
  }))

  const { error } = await supabase.from('comparison_run_rows').insert(payload)
  if (error && !isMissingRunHistoryError(error)) throw error
}

async function finishRunRecord(
  supabase: any,
  runRecord: ComparisonRunRecord | null,
  result: CompareResponse,
  status: 'ok' | 'error',
  errorMessage: string | null,
  finishedAt: string,
) {
  if (!runRecord) return null

  await persistRunRows(supabase, runRecord.id, result.rows)

  const { data, error } = await supabase
    .from('comparison_runs')
    .update({
      status,
      error: errorMessage,
      finished_at: finishedAt,
      result_summary: result.summary,
      worker_id: null,
    })
    .eq('id', runRecord.id)
    .select('*')
    .single()

  if (error) {
    if (isMissingRunHistoryError(error)) return null
    throw error
  }

  return mapRun(data as ComparisonRunRecord, rowsToRecords(runRecord.id, result.rows))
}

async function updateComparisonState(
  supabase: any,
  comparisonId: string,
  result: CompareResponse,
  status: 'ok' | 'error',
  errorMessage: string | null,
  finishedAt: string,
) {
  const { error } = await supabase
    .from('comparisons')
    .update({
      last_result: result,
      sync_status: status,
      sync_error: errorMessage,
      last_synced_at: finishedAt,
      updated_at: finishedAt,
    })
    .eq('id', comparisonId)

  if (error) throw error
}

export async function executeComparisonRefresh(
  supabase: any,
  comparisonId: string,
  requestedBy: string | null,
): Promise<ExecutionOutcome> {
  const comparison = await readComparisonWithCompetitors(supabase, comparisonId)
  const startedAt = new Date().toISOString()

  const { error: runningError } = await supabase
    .from('comparisons')
    .update({
      sync_status: 'running',
      sync_error: null,
      updated_at: startedAt,
    })
    .eq('id', comparisonId)
  if (runningError) throw runningError

  const runRecord = await createRunRecord(supabase, comparisonId, requestedBy, comparison, startedAt)

  let result: CompareResponse
  let status: 'ok' | 'error'
  let errorMessage: string | null

  try {
    const executed = await runWebComparison(comparison)
    result = executed.result
    status = executed.status
    errorMessage = executed.error
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'No se pudo actualizar la comparacion.'
    status = 'error'
    result = buildErrorResult(comparison.name, errorMessage)
  }

  const finishedAt = new Date().toISOString()
  await updateComparisonState(supabase, comparisonId, result, status, errorMessage, finishedAt)
  const finishedRun = await finishRunRecord(supabase, runRecord, result, status, errorMessage, finishedAt)
  const refreshed = await readComparisonWithCompetitors(supabase, comparisonId)

  return {
    comparison: refreshed,
    result,
    status,
    error: errorMessage,
    run: finishedRun,
  }
}
