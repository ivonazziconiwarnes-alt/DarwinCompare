import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

function isDesktopAuthorized(request: Request) {
  const token = request.headers.get('x-desktop-token') || ''
  const expected = process.env.DESKTOP_SYNC_TOKEN || ''
  return !!expected && token === expected
}

type DesktopRow = {
  role: 'mine' | 'competitor'
  name: string
  url: string
  itemId: string | null
  title: string | null
  price: number | null
  currency: string | null
  imageUrl: string | null
  source: 'web' | 'manual' | 'desktop'
  error?: string
  diff?: number | null
  pct?: number | null
}

type DesktopResultPayload = {
  comparisonId: string
  status?: 'ok' | 'error'
  error?: string | null
  result?: {
    comparisonName: string
    rows: DesktopRow[]
    summary: {
      total: number
      ok: number
      failed: number
      minePrice: number | null
    }
  } | null
}

export async function POST(request: Request) {
  if (!isDesktopAuthorized(request)) {
    return NextResponse.json({ error: 'No autorizado para sincronización desktop.' }, { status: 401 })
  }

  try {
    const body = (await request.json()) as DesktopResultPayload

    if (!body.comparisonId) {
      return NextResponse.json({ error: 'Falta comparisonId.' }, { status: 400 })
    }

    const status = body.status || (body.error ? 'error' : 'ok')
    const now = new Date().toISOString()

    const updatePayload = {
      last_result: body.result ?? null,
      sync_status: status,
      last_synced_at: now,
      sync_error: body.error || null,
      updated_at: now,
    }

    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from('comparisons')
      .update(updatePayload)
      .eq('id', body.comparisonId)
      .select('id, name, sync_status, last_synced_at, sync_error')
      .single()

    if (error) throw error

    return NextResponse.json({
      ok: true,
      item: data,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo guardar el resultado de desktop.',
      },
      { status: 500 },
    )
  }
}