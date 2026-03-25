import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

function emptyManual() {
  return {
    title: '',
    price: '',
    itemId: '',
    imageUrl: '',
    currency: 'ARS',
  }
}

function isDesktopAuthorized(request: Request) {
  const token = request.headers.get('x-desktop-token') || ''
  const expected = process.env.DESKTOP_SYNC_TOKEN || ''
  return !!expected && token === expected
}

export async function GET(request: Request) {
  if (!isDesktopAuthorized(request)) {
    return NextResponse.json({ error: 'No autorizado para sincronización desktop.' }, { status: 401 })
  }

  try {
    const supabase = getSupabaseAdmin()

    const onlyPending =
      new URL(request.url).searchParams.get('only_pending') === '1'

    let query = supabase
      .from('comparisons')
      .select(`
        id,
        name,
        category,
        my_name,
        my_url,
        my_manual,
        sync_status,
        last_synced_at,
        sync_error,
        updated_at,
        comparison_competitors (
          id,
          name,
          url,
          position,
          manual_override
        )
      `)
      .order('updated_at', { ascending: false })

    if (onlyPending) {
      query = query.eq('sync_status', 'pending')
    }

    const { data, error } = await query

    if (error) throw error

    const items = (data || []).map((row: any) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      myName: row.my_name,
      myUrl: row.my_url,
      myManual: row.my_manual || emptyManual(),
      syncStatus: row.sync_status || 'pending',
      lastSyncedAt: row.last_synced_at || null,
      syncError: row.sync_error || null,
      competitors: (row.comparison_competitors || [])
        .sort((a: any, b: any) => a.position - b.position)
        .map((competitor: any) => ({
          id: competitor.id,
          name: competitor.name,
          url: competitor.url,
          position: competitor.position,
          manualOverride: competitor.manual_override || emptyManual(),
        })),
    }))

    return NextResponse.json({
      items,
      total: items.length,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'No se pudieron leer las comparaciones para desktop.',
      },
      { status: 500 },
    )
  }
}