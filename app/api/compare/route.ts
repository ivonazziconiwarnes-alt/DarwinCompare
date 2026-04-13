import { NextResponse } from 'next/server'
import { isAuthenticatedRequest } from '@/lib/auth'
import { runWebComparison } from '@/lib/ml-web'
import type { SavedComparison } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  if (!isAuthenticatedRequest(request)) {
    return NextResponse.json({ error: 'No autorizado. Inicia sesion.' }, { status: 401 })
  }

  try {
    const comparison = (await request.json()) as SavedComparison
    const execution = await runWebComparison(comparison)
    return NextResponse.json(execution.result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo comparar.' },
      { status: 500 },
    )
  }
}
