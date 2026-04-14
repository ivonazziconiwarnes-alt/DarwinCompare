import { NextResponse } from 'next/server'
import { isWorkerRequest, workerRequestId } from '@/lib/auth'
import { normalizeCompareRow } from '@/lib/comparison-store'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { CompareResponse, ComparisonRunRecord } from '@/lib/types'

type CompletePayload = {
  status?: 'ok' | 'error'
  error?: string | null
  result?: CompareResponse | null
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

      const { error: rowsError } = await supabase.from('comparison_run_rows').insert(payload)
      if (rowsError) throw rowsError
    }

    const { error: updateRunError } = await supabase
      .from('comparison_runs')
      .update({
        status,
        finished_at: now,
        worker_id: workerId,
        error: body.error || null,
        result_summary: result?.summary || null,
      })
      .eq('id', id)

    if (updateRunError) throw updateRunError

    const { data: comparisonRow, error: comparisonReadError } = await supabase
      .from('comparisons')
      .select('id, last_result')
      .eq('id', (run as ComparisonRunRecord).comparison_id)
      .single()

    if (comparisonReadError) throw comparisonReadError

    const previousResult = comparisonRow?.last_result as CompareResponse | null
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
          last_result: result,
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
      { error: error instanceof Error ? error.message : 'No se pudo cerrar la ejecución.' },
      { status: 500 },
    )
  }
}
