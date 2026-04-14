import { NextResponse } from 'next/server'
import { authenticatedUsername, isAuthenticatedRequest } from '@/lib/auth'
import { readComparisonWithCompetitors } from '@/lib/comparison-store'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthenticatedRequest(request)) {
    return NextResponse.json({ error: 'No autorizado. Inicia sesion.' }, { status: 401 })
  }

  try {
    const { id } = await params
    const supabase = getSupabaseAdmin()
    const requestedBy = authenticatedUsername(request)
    const queuedAt = new Date().toISOString()

    const { data: existingRuns, error: existingRunError } = await supabase
      .from('comparison_runs')
      .select('id, status')
      .eq('comparison_id', id)
      .in('status', ['pending', 'running'])
      .order('requested_at', { ascending: false })
      .limit(1)

    if (existingRunError) throw existingRunError
    const existingRun = Array.isArray(existingRuns) ? existingRuns[0] || null : null

    if (!existingRun) {
      const snapshot = await readComparisonWithCompetitors(supabase, id)
      const { error: insertRunError } = await supabase
        .from('comparison_runs')
        .insert({
          comparison_id: id,
          status: 'pending',
          trigger_source: 'web',
          requested_by: requestedBy,
          requested_at: queuedAt,
          comparison_snapshot: snapshot,
        })

      if (insertRunError) throw insertRunError
    }

    const { error: queueError } = await supabase
      .from('comparisons')
      .update({
        sync_status: 'running',
        sync_error: null,
        updated_at: queuedAt,
      })
      .eq('id', id)

    if (queueError) throw queueError

    const queuedItem = await readComparisonWithCompetitors(supabase, id)

    return NextResponse.json({
      item: queuedItem,
      run: existingRun || null,
      result: queuedItem.lastResult,
      status: 'queued',
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo actualizar la comparacion.' },
      { status: 500 },
    )
  }
}
