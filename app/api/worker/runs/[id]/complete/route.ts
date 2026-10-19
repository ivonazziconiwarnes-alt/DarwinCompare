import { NextResponse } from 'next/server'
import { isWorkerRequest, workerRequestId } from '@/lib/auth'
import { normalizeCompareRow } from '@/lib/comparison-store'
import { queueErrorText } from '@/lib/comparison-queue'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isWorkerRequest(request)) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 })
  try {
    const { id } = await params
    const body = await request.json()
    if (!body.leaseToken || !['ok', 'error'].includes(body.status) ||
        (body.result != null && !Array.isArray(body.result.rows))) {
      return NextResponse.json({ error: 'Falta leaseToken, estado o resultado valido.' }, { status: 400 })
    }
    const result = body.result ? { ...body.result, rows: body.result.rows.map(normalizeCompareRow) } : null
    const { data, error } = await getSupabaseAdmin().rpc('complete_comparison_run', {
      p_id: id, p_token: body.leaseToken, p_worker: workerRequestId(request) || 'worker',
      p_status: body.status, p_error: body.error || null, p_result: result,
    })
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Intento vencido o reemplazado.' }, { status: 409 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: queueErrorText(error) }, { status: 500 })
  }
}
