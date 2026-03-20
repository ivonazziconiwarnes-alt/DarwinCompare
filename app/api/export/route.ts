import { NextResponse } from 'next/server'
import { isAuthenticatedRequest } from '@/lib/auth'
import * as XLSX from 'xlsx'

export const maxDuration = 60

type ExportRow = {
  role: 'mine' | 'competitor'
  name: string
  url: string
  itemId: string | null
  title: string | null
  price: number | null
  currency: string | null
  imageUrl: string | null
  source: 'web'
  error?: string
  diff?: number | null
  pct?: number | null
}

export async function POST(request: Request) {
  if (!isAuthenticatedRequest(request)) {
    return NextResponse.json({ error: 'No autorizado. Iniciá sesión.' }, { status: 401 })
  }

  try {
    const body = (await request.json()) as { comparisonName?: string; rows?: ExportRow[] }
    const rows = body.rows || []

    if (!rows.length) {
      return NextResponse.json({ error: 'No hay filas para exportar.' }, { status: 400 })
    }

    const sheetRows = rows.map((row) => ({
      Rol: row.role === 'mine' ? 'Mío' : 'Competidor',
      Nombre: row.name,
      Título: row.title || '',
      MLA: row.itemId || '',
      Precio: row.price ?? '',
      Moneda: row.currency || 'ARS',
      Diferencia: row.diff ?? '',
      'Porcentaje %': typeof row.pct === 'number' ? Number(row.pct.toFixed(2)) : '',
      Fuente: row.source.toUpperCase(),
      URL: row.url,
      Error: row.error || '',
    }))

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(sheetRows)
    ws['!cols'] = [
      { wch: 14 },
      { wch: 24 },
      { wch: 54 },
      { wch: 16 },
      { wch: 14 },
      { wch: 10 },
      { wch: 14 },
      { wch: 14 },
      { wch: 12 },
      { wch: 45 },
      { wch: 26 },
    ]

    XLSX.utils.book_append_sheet(wb, ws, 'Detalle')

    const summary = rows.map((row) => ({
      Nombre: row.name,
      Precio: row.price ?? '',
      Diferencia: row.diff ?? '',
      Porcentaje: typeof row.pct === 'number' ? Number(row.pct.toFixed(2)) : '',
    }))
    const wsSummary = XLSX.utils.json_to_sheet(summary)
    wsSummary['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 14 }]
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen')

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${(body.comparisonName || 'comparacion-ml').replace(/[^a-zA-Z0-9-_ ]/g, '')}.xlsx"`,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo exportar.' },
      { status: 500 },
    )
  }
}
