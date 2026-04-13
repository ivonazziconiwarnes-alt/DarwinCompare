import { NextResponse } from 'next/server'
import { isAuthenticatedRequest } from '@/lib/auth'

export async function POST(request: Request) {
  if (!isAuthenticatedRequest(request)) {
    return NextResponse.json({ error: 'No autorizado. Iniciá sesión.' }, { status: 401 })
  }

  return NextResponse.json(
    {
      error:
        'La comparación directa quedó deshabilitada. Guardá la comparación y usá la cola de ejecución con worker.',
    },
    { status: 410 },
  )
}
