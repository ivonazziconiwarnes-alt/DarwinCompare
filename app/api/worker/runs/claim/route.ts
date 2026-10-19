import { NextResponse } from 'next/server'
import { isWorkerRequest, workerRequestId } from '@/lib/auth'
import { mapRun, readComparisonWithCompetitors } from '@/lib/comparison-store'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { ComparisonRunRecord, SavedComparison } from '@/lib/types'

type ClaimResponse = {
  run: ReturnType<typeof mapRun> | null
  comparison: SavedComparison | null
}

function errorToText(error: unknown) {
  if (error instanceof Error) return error.message

  if (error && typeof error === 'object') {
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }

  return String(error || 'Error desconocido')
}

export async function POST(request: Request) {
  if (!isWorkerRequest(request)) {
    return NextResponse.json({ error: 'No autorizado para worker.' }, { status: 401 })
  }

  try {
    const supabase = getSupabaseAdmin()
    const workerId = workerRequestId(request) || 'worker'
    const { data, error } = await supabase.rpc('claim_comparison_run', { p_worker: workerId })
    if (error) throw error
    const claimed = Array.isArray(data) ? data[0] : data
    if (!claimed?.id) return NextResponse.json<ClaimResponse>({ run: null, comparison: null })
    const comparison = (claimed.comparison_snapshot as SavedComparison | null) ||
      await readComparisonWithCompetitors(supabase, claimed.comparison_id)
    return NextResponse.json({
      run: { ...mapRun(claimed as ComparisonRunRecord), leaseToken: claimed.lease_token }, comparison,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: errorToText(error),
      },
      { status: 500 },
    )
  }
}