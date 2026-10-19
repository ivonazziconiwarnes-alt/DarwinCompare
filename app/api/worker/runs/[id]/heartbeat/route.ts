import { NextResponse } from 'next/server'
import { isWorkerRequest, workerRequestId } from '@/lib/auth'
import { queueErrorText } from '@/lib/comparison-queue'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isWorkerRequest(request)) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 })
  try {
    const { id } = await params
    const { leaseToken } = await request.json()
    if (!leaseToken) return NextResponse.json({ error: 'Falta leaseToken.' }, { status: 400 })
    const { data, error } = await getSupabaseAdmin().rpc('heartbeat_comparison_run', {
      p_id: id, p_token: leaseToken, p_worker: workerRequestId(request) || 'worker',
    })
    if (error) throw error
    return NextResponse.json({ ok: data }, { status: data ? 200 : 409 })
  } catch (error) {
    return NextResponse.json({ error: queueErrorText(error) }, { status: 500 })
  }
}
