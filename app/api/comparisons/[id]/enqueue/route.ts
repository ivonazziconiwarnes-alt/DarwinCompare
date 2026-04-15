import { NextResponse } from 'next/server'
import { authenticatedUsername, isAuthenticatedRequest } from '@/lib/auth'
import { queueComparisonRun, queueErrorText } from '@/lib/comparison-queue'
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
    const queued = await queueComparisonRun(supabase, id, requestedBy, 'web')
    return NextResponse.json(queued)
  } catch (error) {
    return NextResponse.json(
      { error: queueErrorText(error) || 'No se pudo actualizar la comparacion.' },
      { status: 500 },
    )
  }
}
