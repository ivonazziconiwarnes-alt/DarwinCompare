import { NextResponse } from 'next/server'
import { isAuthenticatedRequest } from '@/lib/auth'
import { ComparePayload, computeRows, scrapeListing } from '@/lib/ml'

export const maxDuration = 60

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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

    const listings = []

    listings.push(await scrapeListing(body.myUrl, 'mine', body.myName?.trim() || 'Mi publicación'))

    for (let i = 0; i < competitors.length; i++) {
      const item = competitors[i]
      await delay(250)
      listings.push(
        await scrapeListing(item.url, 'competitor', item.name?.trim() || `Competidor ${i + 1}`),
      )
    }

    const rows = computeRows(body, listings)
    const okCount = rows.filter((row) => row.price !== null || (row.title && !row.error)).length
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