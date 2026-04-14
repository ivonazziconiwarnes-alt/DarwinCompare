import { NextResponse } from 'next/server'
import { isWorkerRequest, workerRequestId } from '@/lib/auth'

export async function GET(request: Request) {
  if (!isWorkerRequest(request)) {
    return NextResponse.json({ error: 'No autorizado para worker.' }, { status: 401 })
  }

  return NextResponse.json({
    ok: true,
    message: 'Conexión OK',
    workerId: workerRequestId(request) || null,
    serverTime: new Date().toISOString(),
  })
}
