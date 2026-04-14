import { after, NextResponse } from 'next/server'
import { authenticatedUsername, isAuthenticatedRequest } from '@/lib/auth'
import { readComparisonWithCompetitors } from '@/lib/comparison-store'
import { executeComparisonRefresh } from '@/lib/comparison-runner'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthenticatedRequest(request)) {
    return NextResponse.json({ error: 'No autorizado. Inicia sesion.' }, { status: 401 })
  }

  try {
    const { id } = await params
    const supabase = getSupabaseAdmin()
    const requestedBy = authenticatedUsername(request)
    const queuedAt = new Date().toISOString()

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

    after(async () => {
      try {
        await executeComparisonRefresh(supabase, id, requestedBy)
      } catch (error) {
        const failedAt = new Date().toISOString()
        await supabase
          .from('comparisons')
          .update({
            sync_status: 'error',
            sync_error: error instanceof Error ? error.message : 'No se pudo actualizar la comparacion.',
            updated_at: failedAt,
          })
          .eq('id', id)
      }
    })

    return NextResponse.json({
      item: queuedItem,
      run: null,
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
