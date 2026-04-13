import { NextResponse } from 'next/server'
import { isAuthenticatedRequest } from '@/lib/auth'
import { emptyManual, fetchComparisons, mapComparison } from '@/lib/comparison-store'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { ComparisonRecord, CompetitorRecord, SavedComparison } from '@/lib/types'

export async function GET(request: Request) {
  if (!isAuthenticatedRequest(request)) {
    return NextResponse.json({ error: 'No autorizado. Iniciá sesión.' }, { status: 401 })
  }

  try {
    const items = await fetchComparisons(getSupabaseAdmin())
    return NextResponse.json({ items })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudieron leer las comparaciones.' },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  if (!isAuthenticatedRequest(request)) {
    return NextResponse.json({ error: 'No autorizado. Iniciá sesión.' }, { status: 401 })
  }

  try {
    const body = (await request.json()) as Partial<SavedComparison>
    const supabase = getSupabaseAdmin()

    const payload = {
      name: body.name?.trim() || 'Nueva comparación',
      category: body.category?.trim() || 'General',
      my_name: body.myName?.trim() || 'Mi publicación',
      my_url: body.myUrl?.trim() || '',
      my_manual: body.myManual ?? emptyManual(),
      last_result: body.lastResult ?? null,
      sync_status: body.syncStatus ?? 'pending',
      last_synced_at: body.lastSyncedAt ?? null,
      sync_error: body.syncError ?? null,
    }

    const { data: created, error: createError } = await supabase
      .from('comparisons')
      .insert(payload)
      .select('*')
      .single()

    if (createError) throw createError

    const competitors = (body.competitors || [])
      .map((competitor, index) => ({
        comparison_id: created.id,
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

    return NextResponse.json(
      { item: mapComparison(created as ComparisonRecord, competitorRows) },
      { status: 201 },
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo crear la comparación.' },
      { status: 500 },
    )
  }
}
