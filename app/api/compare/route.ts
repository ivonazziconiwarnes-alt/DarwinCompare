import { NextResponse } from 'next/server'
import { isAuthenticatedRequest } from '@/lib/auth'
import { ComparePayload, computeRows, scrapeListing } from '@/lib/ml'

export const maxDuration = 60

export async function POST(request: Request) {
  if (!isAuthenticatedRequest(request)) {
    return NextResponse.json({ error: 'No autorizado. Iniciá sesión.' }, { status: 401 })
  }

  try {
    const body = (await request.json()) as ComparePayload

    const competitors = (body.competitors || []).filter((item) => item.url?.trim())
    if (!body.myUrl?.trim()) {
      return NextResponse.json({ error: 'Falta la URL de tu publicación.' }, { status: 400 })
    }
    if (!competitors.length) {
      return NextResponse.json({ error: 'Pegá al menos una URL de competidor.' }, { status: 400 })
    }

    const listings = await Promise.all([
      scrapeListing(body.myUrl, 'mine', body.myName?.trim() || 'Mi publicación'),
      ...competitors.map((item, index) =>
        scrapeListing(item.url, 'competitor', item.name?.trim() || `Competidor ${index + 1}`),
      ),
    ])

    const rows = computeRows(body, listings)
    const okCount = rows.filter((row) => row.price !== null || row.title).length
    const failCount = rows.length - okCount

    return NextResponse.json({
      comparisonName: body.comparisonName || 'Comparación ML',
      rows,
      summary: {
        total: rows.length,
        ok: okCount,
        failed: failCount,
        minePrice: rows.find((row) => row.role === 'mine')?.price ?? null,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo comparar.' },
      { status: 500 },
    )
  }
}
