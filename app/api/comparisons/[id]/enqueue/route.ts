import { NextResponse } from 'next/server'
import { authenticatedUsername, isAuthenticatedRequest } from '@/lib/auth'
import { mapRun, readComparisonWithCompetitors } from '@/lib/comparison-store'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { ComparisonRunRecord } from '@/lib/types'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthenticatedRequest(request)) {
    return NextResponse.json({ error: 'No autorizado. Iniciá sesión.' }, { status: 401 })
  }

  try {
    const { id } = await params
    const supabase = getSupabaseAdmin()
    const requestedBy = authenticatedUsername(request)

    const comparison = await readComparisonWithCompetitors(supabase, id)
    const now = new Date().toISOString()

    const { data: activeRun, error: activeError } = await supabase
      .from('comparison_runs')
      .select('*')
      .eq('comparison_id', id)
      .in('status', ['pending', 'running'])
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (activeError) throw activeError

    if (activeRun) {
      await supabase
        .from('comparisons')
        .update({
          sync_status: activeRun.status,
          sync_error: null,
          updated_at: now,
        })
        .eq('id', id)

      return NextResponse.json({ item: mapRun(activeRun as ComparisonRunRecord) })
    }

    const { data: created, error: createError } = await supabase
      .from('comparison_runs')
      .insert({
        comparison_id: id,
        status: 'pending',
        trigger_source: 'web',
        requested_by: requestedBy,
        requested_at: now,
        comparison_snapshot: comparison,
      })
      .select('*')
      .single()

    if (createError) throw createError

    const { error: comparisonError } = await supabase
      .from('comparisons')
      .update({
        sync_status: 'pending',
        sync_error: null,
        updated_at: now,
      })
      .eq('id', id)

    if (comparisonError) throw comparisonError

    return NextResponse.json({ item: mapRun(created as ComparisonRunRecord) }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo encolar la comparación.' },
      { status: 500 },
    )
  }
}
