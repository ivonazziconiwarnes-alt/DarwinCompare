import { NextResponse } from 'next/server'
import { authenticatedUsername, isAuthenticatedRequest } from '@/lib/auth'
import { executeComparisonRefresh } from '@/lib/comparison-runner'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthenticatedRequest(request)) {
    return NextResponse.json({ error: 'No autorizado. Inicia sesion.' }, { status: 401 })
  }

  try {
    const { id } = await params
    const execution = await executeComparisonRefresh(
      getSupabaseAdmin(),
      id,
      authenticatedUsername(request),
    )

    return NextResponse.json({
      item: execution.comparison,
      run: execution.run,
      result: execution.result,
      status: execution.status,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo actualizar la comparacion.' },
      { status: 500 },
    )
  }
}
