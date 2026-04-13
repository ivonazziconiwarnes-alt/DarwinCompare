import { NextResponse } from 'next/server'
import { isWorkerRequest, workerRequestId } from '@/lib/auth'
import { mapRun, readComparisonWithCompetitors } from '@/lib/comparison-store'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { ComparisonRunRecord, SavedComparison } from '@/lib/types'

type ClaimResponse = {
  run: ReturnType<typeof mapRun> | null
  comparison: SavedComparison | null
}

export async function POST(request: Request) {
  if (!isWorkerRequest(request)) {
    return NextResponse.json({ error: 'No autorizado para worker.' }, { status: 401 })
  }

  try {
    const supabase = getSupabaseAdmin()
    const workerId = workerRequestId(request) || 'worker'
    const now = new Date().toISOString()

    const { data: pendingRuns, error: pendingError } = await supabase
      .from('comparison_runs')
      .select('*')
      .eq('status', 'pending')
      .order('requested_at', { ascending: true })
      .limit(8)

    if (pendingError) throw pendingError

    for (const candidate of pendingRuns || []) {
      const { data: claimed, error: claimError } = await supabase
        .from('comparison_runs')
        .update({
          status: 'running',
          started_at: now,
          worker_id: workerId,
          error: null,
        })
        .eq('id', candidate.id)
        .eq('status', 'pending')
        .select('*')
        .maybeSingle()

      if (claimError) throw claimError
      if (!claimed) continue

      const comparison =
        (candidate.comparison_snapshot as SavedComparison | null) ||
        (await readComparisonWithCompetitors(supabase, candidate.comparison_id))

      const { error: comparisonError } = await supabase
        .from('comparisons')
        .update({
          sync_status: 'running',
          sync_error: null,
          updated_at: now,
        })
        .eq('id', candidate.comparison_id)

      if (comparisonError) throw comparisonError

      const payload: ClaimResponse = {
        run: mapRun(claimed as ComparisonRunRecord),
        comparison,
      }

      return NextResponse.json(payload)
    }

    return NextResponse.json<ClaimResponse>({
      run: null,
      comparison: null,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo reclamar un job.' },
      { status: 500 },
    )
  }
}
