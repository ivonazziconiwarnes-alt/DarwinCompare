import { NextResponse } from 'next/server'
import { isWorkerRequest, workerRequestId } from '@/lib/auth'
import { normalizeCompareRow } from '@/lib/comparison-store'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { CompareHistoryPoint, CompareResponse, ComparisonRunRecord } from '@/lib/types'

type CompletePayload = {
  status?: 'ok' | 'error'
  error?: string | null
  result?: CompareResponse | null
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    return [record.code, record.message, record.details, record.hint].filter(Boolean).join(' ')
  }

  return String(error || 'Error desconocido')
}

function isMissingColumnError(error: unknown) {
  const text = errorText(error).toLowerCase()
  return (
    text.includes('42703') ||
    text.includes('pgrst204') ||
    (text.includes('column') && text.includes('does not exist')) ||
    (text.includes('could not find the') && text.includes('column'))
  )
}

function normalizeHistoryPoint(value: unknown): CompareHistoryPoint | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const capturedAt = typeof record.capturedAt === 'string' ? record.capturedAt : null
  const rawRows = Array.isArray(record.rows) ? record.rows : []

  if (!capturedAt || !rawRows.length) return null

  return {
    runId: typeof record.runId === 'string' ? record.runId : null,
    capturedAt,
    rows: rawRows
      .map((row: any) => normalizeCompareRow(row))
      .map((row) => ({
        role: row.role,
        name: row.name,
        url: row.url,
        itemId: row.itemId,
        price: row.price,
        currency: row.currency,
        source: row.source,
        sourceKind: row.sourceKind ?? null,
      })),
  }
}

function historyPointFromRows(runId: string | null, capturedAt: string, rows: ReturnType<typeof normalizeCompareRow>[]) {
  const historyRows = rows
    .filter((row) => row.price !== null && typeof row.price !== 'undefined')
    .map((row) => ({
      role: row.role,
      name: row.name,
      url: row.url,
      itemId: row.itemId,
      price: row.price,
      currency: row.currency,
      source: row.source,
      sourceKind: row.sourceKind ?? null,
    }))

  if (!historyRows.length) return null

  return {
    runId,
    capturedAt,
    rows: historyRows,
  } satisfies CompareHistoryPoint
}

function mergeHistoryPoints(points: Array<CompareHistoryPoint | null | undefined>) {
  const byKey = new Map<string, CompareHistoryPoint>()

  points.forEach((point) => {
    if (!point) return
    const normalized = normalizeHistoryPoint(point)
    if (!normalized) return
    const key = normalized.runId || normalized.capturedAt
    byKey.set(key, normalized)
  })

  return Array.from(byKey.values())
    .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime())
    .slice(-24)
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isWorkerRequest(request)) {
    return NextResponse.json({ error: 'No autorizado para worker.' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = (await request.json()) as CompletePayload
    const supabase = getSupabaseAdmin()
    const now = new Date().toISOString()
    const workerId = workerRequestId(request) || 'worker'
    const result = body.result || null
    const status = body.status || (body.error ? 'error' : 'ok')

    const { data: run, error: runError } = await supabase
      .from('comparison_runs')
      .select('*')
      .eq('id', id)
      .single()

    if (runError) throw runError

    await supabase.from('comparison_run_rows').delete().eq('run_id', id)

    const normalizedRows = (result?.rows || []).map(normalizeCompareRow)

    if (normalizedRows.length) {
      const payload = normalizedRows.map((row, index) => ({
        run_id: id,
        position: index,
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

      let rowsError: unknown = null
      const { error: fullRowsError } = await supabase.from('comparison_run_rows').insert(payload)
      rowsError = fullRowsError

      if (rowsError && isMissingColumnError(rowsError)) {
        const fallbackPayload = normalizedRows.map((row, index) => ({
          run_id: id,
          position: index,
          role: row.role,
          name: row.name,
          url: row.url,
          item_id: row.itemId,
          title: row.title,
          price: row.price,
          error: row.error || null,
        }))

        const { error: fallbackRowsError } = await supabase
          .from('comparison_run_rows')
          .insert(fallbackPayload)
        rowsError = fallbackRowsError
      }

      if (rowsError && !isMissingColumnError(rowsError)) throw rowsError
    }

    let updateRunError: unknown = null
    const { error: fullUpdateRunError } = await supabase
      .from('comparison_runs')
      .update({
        status,
        finished_at: now,
        worker_id: workerId,
        error: body.error || null,
        result_summary: result?.summary || null,
      })
      .eq('id', id)

    updateRunError = fullUpdateRunError

    if (updateRunError && isMissingColumnError(updateRunError)) {
      const { error: fallbackUpdateRunError } = await supabase
        .from('comparison_runs')
        .update({
          status,
          finished_at: now,
          worker_id: workerId,
          error: body.error || null,
        })
        .eq('id', id)

      updateRunError = fallbackUpdateRunError
    }

    if (updateRunError && isMissingColumnError(updateRunError)) {
      const { error: minimalUpdateRunError } = await supabase
        .from('comparison_runs')
        .update({
          status,
          worker_id: workerId,
          error: body.error || null,
        })
        .eq('id', id)

      updateRunError = minimalUpdateRunError
    }

    if (updateRunError) throw updateRunError

    const { data: comparisonRow, error: comparisonReadError } = await supabase
      .from('comparisons')
      .select('id, last_result, last_synced_at')
      .eq('id', (run as ComparisonRunRecord).comparison_id)
      .single()

    if (comparisonReadError) throw comparisonReadError

    const previousResult = comparisonRow?.last_result as CompareResponse | null
    const previousHistory = Array.isArray(previousResult?.history)
      ? previousResult.history
          .map(normalizeHistoryPoint)
          .filter((point: CompareHistoryPoint | null): point is CompareHistoryPoint => Boolean(point))
      : []
    const previousSnapshot =
      previousHistory.length === 0 && Array.isArray(previousResult?.rows) && previousResult.rows.length > 0
        ? historyPointFromRows(
            null,
            comparisonRow?.last_synced_at || now,
            previousResult.rows.map(normalizeCompareRow),
          )
        : null
    const currentSnapshot = historyPointFromRows(
      (run as ComparisonRunRecord).id,
      (run as ComparisonRunRecord).started_at || (run as ComparisonRunRecord).requested_at || now,
      normalizedRows,
    )
    const nextHistory = mergeHistoryPoints([...previousHistory, previousSnapshot, currentSnapshot])
    const nextResult =
      result && normalizedRows.length
        ? {
            ...result,
            rows: normalizedRows,
            history: nextHistory,
          }
        : result
    const preservePreviousResult =
      status === 'error' &&
      Array.isArray(previousResult?.rows) &&
      previousResult.rows.length > 0 &&
      (!result || !Array.isArray(result.rows) || result.rows.length === 0)

    const comparisonUpdate = preservePreviousResult
      ? {
          sync_status: status,
          sync_error: body.error || null,
          updated_at: now,
        }
      : {
          last_result: nextResult,
          sync_status: status,
          last_synced_at: now,
          sync_error: body.error || null,
          updated_at: now,
        }

    const { error: comparisonError } = await supabase
      .from('comparisons')
      .update(comparisonUpdate)
      .eq('id', (run as ComparisonRunRecord).comparison_id)

    if (comparisonError) throw comparisonError

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: errorText(error) || 'No se pudo cerrar la ejecucion.' },
      { status: 500 },
    )
  }
}
