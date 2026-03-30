import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

function isDesktopAuthorized(request: Request) {
  const token = request.headers.get('x-desktop-token') || ''
  const expected = process.env.DESKTOP_SYNC_TOKEN || ''
  return !!expected && token === expected
}

type CompetitorInput = {
  name?: string
  url?: string
  position?: number
}

type Payload = {
  name?: string
  category?: string
  my_name?: string
  my_url?: string
  competitors?: CompetitorInput[]
}

export async function POST(request: Request) {
  if (!isDesktopAuthorized(request)) {
    return NextResponse.json({ error: 'No autorizado para sincronización desktop.' }, { status: 401 })
  }

  try {
    const body = (await request.json()) as Payload
    const name = (body.name || '').trim()
    const category = (body.category || '').trim()
    const myName = (body.my_name || 'Mi publicación').trim()
    const myUrl = (body.my_url || '').trim()
    const competitors = (body.competitors || [])
      .map((item, index) => ({
        name: (item.name || `Competidor ${index + 1}`).trim(),
        url: (item.url || '').trim(),
        position: typeof item.position === 'number' ? item.position : index,
      }))
      .filter((item) => item.url)

    if (!name) {
      return NextResponse.json({ error: 'Falta name.' }, { status: 400 })
    }
    if (!myUrl) {
      return NextResponse.json({ error: 'Falta my_url.' }, { status: 400 })
    }
    if (!competitors.length) {
      return NextResponse.json({ error: 'Falta al menos un competidor.' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    const { data: existing, error: findError } = await supabase
      .from('comparisons')
      .select('id')
      .eq('name', name)
      .eq('category', category)
      .maybeSingle()

    if (findError) throw findError

    let comparisonId = existing?.id as string | undefined

    if (comparisonId) {
      const { error: updateError } = await supabase
        .from('comparisons')
        .update({
          name,
          category,
          my_name: myName,
          my_url: myUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', comparisonId)

      if (updateError) throw updateError

      const { error: deleteError } = await supabase
        .from('comparison_competitors')
        .delete()
        .eq('comparison_id', comparisonId)

      if (deleteError) throw deleteError
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from('comparisons')
        .insert({
          name,
          category,
          my_name: myName,
          my_url: myUrl,
          sync_status: 'pending',
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (insertError) throw insertError
      comparisonId = inserted.id as string
    }

    const competitorRows = competitors.map((item) => ({
      comparison_id: comparisonId,
      name: item.name,
      url: item.url,
      position: item.position,
    }))

    const { error: compError } = await supabase
      .from('comparison_competitors')
      .insert(competitorRows)

    if (compError) throw compError

    const { data: row, error: rowError } = await supabase
      .from('comparisons')
      .select('*')
      .eq('id', comparisonId)
      .single()

    if (rowError) throw rowError

    return NextResponse.json({ ok: true, item: row })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'No se pudo crear o actualizar la comparación.',
      },
      { status: 500 },
    )
  }
}
