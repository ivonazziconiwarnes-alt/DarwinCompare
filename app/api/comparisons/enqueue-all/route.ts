import { NextResponse } from 'next/server'
import { authenticatedUsername, isAuthenticatedRequest } from '@/lib/auth'
import { queueComparisonRun, queueErrorText } from '@/lib/comparison-queue'
import { fetchComparisons } from '@/lib/comparison-store'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const maxDuration = 60

function isQueueableComparison(item: any) {
  const myUrl = String(item?.myUrl || '').trim()
  const competitors = Array.isArray(item?.competitors) ? item.competitors : []
  const hasCompetitor = competitors.some((competitor: any) => String(competitor?.url || '').trim())
  return !!myUrl && hasCompetitor
}

export async function POST(request: Request) {
  if (!isAuthenticatedRequest(request)) {
    return NextResponse.json({ error: 'No autorizado. Inicia sesion.' }, { status: 401 })
  }

  try {
    const supabase = getSupabaseAdmin()
    const requestedBy = authenticatedUsername(request)
    const items = await fetchComparisons(supabase)

    const queuedIds: string[] = []
    const skipped: Array<{ id: string; name: string; reason: string }> = []
    const failed: Array<{ id: string; name: string; reason: string }> = []

    for (const item of items) {
      if (!isQueueableComparison(item)) {
        skipped.push({
          id: item.id,
          name: item.name,
          reason: 'Falta la publicacion propia o al menos un competidor con URL.',
        })
        continue
      }

      try {
        await queueComparisonRun(supabase, item.id, requestedBy, 'bulk-web')
        queuedIds.push(item.id)
      } catch (error) {
        failed.push({
          id: item.id,
          name: item.name,
          reason: queueErrorText(error) || 'No se pudo encolar.',
        })
      }
    }

    const refreshedItems = await fetchComparisons(supabase)

    return NextResponse.json({
      items: refreshedItems,
      summary: {
        total: items.length,
        queued: queuedIds.length,
        skipped: skipped.length,
        failed: failed.length,
      },
      skipped,
      failed,
      status: 'queued',
    })
  } catch (error) {
    return NextResponse.json(
      { error: queueErrorText(error) || 'No se pudieron actualizar las comparaciones.' },
      { status: 500 },
    )
  }
}
