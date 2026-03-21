import { NextResponse } from 'next/server'
import { isAuthenticatedRequest } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { ComparisonRecord, CompetitorRecord, SavedComparison } from '@/lib/types'

function emptyManual() {
  return {
    title: '',
    price: '',
    itemId: '',
    imageUrl: '',
    currency: 'ARS',
  }
}

function mapComparison(record: ComparisonRecord, competitors: CompetitorRecord[]): SavedComparison {
  return {
    id: record.id,
    name: record.name,
    category: record.category,
    myName: record.my_name,
    myUrl: record.my_url,
    myManual: record.my_manual || emptyManual(),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    lastResult: record.last_result,
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

async function fetchComparisons() {
  const supabase = getSupabaseAdmin()

  const { data: comparisonRows, error: comparisonError } = await supabase
    .from('comparisons')
    .select('*')
    .order('updated_at', { ascending: false })

  if (comparisonError) throw comparisonError

  const comparisonIds = (comparisonRows || []).map((row) => row.id)

  let competitorsByComparison = new Map<string, CompetitorRecord[]>()
  if (comparisonIds.length) {
    const { data: competitorRows, error: competitorError } = await supabase
      .from('comparison_competitors')
      .select('*')
      .in('comparison_id', comparisonIds)
      .order('position', { ascending: true })

    if (competitorError) throw competitorError

    competitorsByComparison = new Map<string, CompetitorRecord[]>()
    ;(competitorRows || []).forEach((row) => {
      const list = competitorsByComparison.get(row.comparison_id) || []
      list.push(row)
      competitorsByComparison.set(row.comparison_id, list)
    })
  }

  return (comparisonRows || []).map((row) => mapComparison(row as ComparisonRecord, competitorsByComparison.get(row.id) || []))
}

export async function GET(request: Request) {
  if (!isAuthenticatedRequest(request)) {
    return NextResponse.json({ error: 'No autorizado. Iniciá sesión.' }, { status: 401 })
  }

  try {
    const items = await fetchComparisons()
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

    return NextResponse.json({ item: mapComparison(created as ComparisonRecord, competitorRows) }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo crear la comparación.' },
      { status: 500 },
    )
  }
}