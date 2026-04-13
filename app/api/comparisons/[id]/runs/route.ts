import { NextResponse } from 'next/server'
import { isAuthenticatedRequest } from '@/lib/auth'
import { listRunsForComparison } from '@/lib/comparison-store'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthenticatedRequest(request)) {
    return NextResponse.json({ error: 'No autorizado. Iniciá sesión.' }, { status: 401 })
  }

  try {
    const { id } = await params
    const limitRaw = new URL(request.url).searchParams.get('limit') || '12'
    const limit = Math.max(1, Math.min(30, Number(limitRaw) || 12))
    const items = await listRunsForComparison(getSupabaseAdmin(), id, limit)
    return NextResponse.json({ items })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudieron leer las ejecuciones.' },
      { status: 500 },
    )
  }
}
