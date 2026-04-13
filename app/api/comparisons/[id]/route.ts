import { NextResponse } from 'next/server'
import { isAuthenticatedRequest } from '@/lib/auth'
import { emptyManual, mapComparison, readComparisonWithCompetitors } from '@/lib/comparison-store'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { ComparisonRecord, CompetitorRecord, SavedComparison } from '@/lib/types'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthenticatedRequest(request)) {
    return NextResponse.json({ error: 'No autorizado. Iniciá sesión.' }, { status: 401 })
  }

  try {
    const { id } = await params
    const item = await readComparisonWithCompetitors(getSupabaseAdmin(), id)
    return NextResponse.json({ item })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo leer la comparación.' },
      { status: 500 },
    )
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthenticatedRequest(request)) {
    return NextResponse.json({ error: 'No autorizado. Iniciá sesión.' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = (await request.json()) as Partial<SavedComparison>
    const supabase = getSupabaseAdmin()

    const updatePayload = {
      name: body.name?.trim() || 'Nueva comparación',
      category: body.category?.trim() || 'General',
      my_name: body.myName?.trim() || 'Mi publicación',
      my_url: body.myUrl?.trim() || '',
      my_manual: body.myManual ?? emptyManual(),
      last_result: body.lastResult ?? null,
      sync_status: body.syncStatus ?? 'pending',
      last_synced_at: body.lastSyncedAt ?? null,
      sync_error: body.syncError ?? null,
      updated_at: new Date().toISOString(),
    }

    const { data: updated, error: updateError } = await supabase
      .from('comparisons')
      .update(updatePayload)
      .eq('id', id)
      .select('*')
      .single()

    if (updateError) throw updateError

    const { error: deleteCompetitorsError } = await supabase
      .from('comparison_competitors')
      .delete()
      .eq('comparison_id', id)

    if (deleteCompetitorsError) throw deleteCompetitorsError

    const competitors = (body.competitors || [])
      .map((competitor, index) => ({
        comparison_id: id,
        name: competitor.name?.trim() || `Competidor ${index + 1}`,
        url: competitor.url?.trim() || '',
        position: typeof competitor.position === 'number' ? competitor.position : index,
        manual_override: competitor.manualOverride ?? emptyManual(),
      }))
      .filter((competitor) => competitor.url)

    let competitorRows: CompetitorRecord[] = []
    if (competitors.length) {
      const { data, error } = await supabase
        .from('comparison_competitors')
        .insert(competitors)
        .select('*')
        .order('position', { ascending: true })

      if (error) throw error
      competitorRows = (data || []) as CompetitorRecord[]
    }

    return NextResponse.json({ item: mapComparison(updated as ComparisonRecord, competitorRows) })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo actualizar la comparación.' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthenticatedRequest(request)) {
    return NextResponse.json({ error: 'No autorizado. Iniciá sesión.' }, { status: 401 })
  }

  try {
    const { id } = await params
    const supabase = getSupabaseAdmin()

    const { error } = await supabase.from('comparisons').delete().eq('id', id)
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo borrar la comparación.' },
      { status: 500 },
    )
  }
}
