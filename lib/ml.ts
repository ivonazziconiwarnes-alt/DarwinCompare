import * as cheerio from 'cheerio'

export type ListingRow = {
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
}

export type ComparePayload = {
  comparisonName: string
  myName?: string
  myUrl: string
  competitors: Array<{ name?: string; url: string }>
}

export function extractItemId(text: string): string | null {
  if (!text) return null
  const wid = text.match(/wid=(MLA\d+)/i)
  if (wid) return wid[1].toUpperCase()
  const mla = text.match(/(MLA\d+)/i)
  if (mla) return mla[1].toUpperCase()
  try {
    const url = new URL(text)
    for (const key of ['wid', 'item_id', 'id']) {
      const value = url.searchParams.get(key)
      if (!value) continue
      const match = value.match(/(MLA\d+)/i)
      if (match) return match[1].toUpperCase()
    }
  } catch {}
  return null
}

function parseMoney(raw: string | null | undefined): number | null {
  if (!raw) return null
  const cleaned = raw.replace(/\u00a0/g, ' ').trim()
  const direct = cleaned.match(/(\d+\.\d+)/)
  if (direct) return Number(direct[1])

  let compact = cleaned.replace(/[^\d,\.]/g, '')
  if (compact.includes(',') && compact.includes('.')) {
    compact = compact.replace(/\./g, '').replace(',', '.')
    const value = Number(compact)
    return Number.isFinite(value) ? value : null
  }
  if (compact.includes(',')) {
    compact = compact.replace(/\./g, '').replace(',', '.')
    const value = Number(compact)
    return Number.isFinite(value) ? value : null
  }
  compact = compact.replace(/\./g, '')
  const value = Number(compact)
  return Number.isFinite(value) ? value : null
}

function cleanupTitle(title: string | null): string | null {
  if (!title) return null
  return title
    .replace(/\s*\|\s*Mercado Libre.*$/i, '')
    .replace(/\s*-\s*\$\s*[\d\.,]+.*$/i, '')
    .trim()
}

function candidateUrls(rawUrl: string): string[] {
  const list: string[] = []
  if (rawUrl.trim()) list.push(rawUrl.trim())
  const itemId = extractItemId(rawUrl)
  if (itemId) list.push(`https://articulo.mercadolibre.com.ar/${itemId.replace('MLA', 'MLA-')}-_JM`)
  return [...new Set(list)]
}

async function fetchHtml(url: string): Promise<{ finalUrl: string; html: string }> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      'Upgrade-Insecure-Requests': '1',
      DNT: '1',
    },
    redirect: 'follow',
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }

  const html = await res.text()
  return { finalUrl: res.url, html }
}

function metaContent($: cheerio.CheerioAPI, key: string): string | null {
  const selectors = [`meta[property="${key}"]`, `meta[name="${key}"]`]
  for (const sel of selectors) {
    const value = $(sel).attr('content')
    if (value) return value.trim()
  }
  return null
}

function findFromJsonLd($: cheerio.CheerioAPI) {
  let title: string | null = null
  let price: number | null = null
  let currency: string | null = null
  let imageUrl: string | null = null

  $('script[type="application/ld+json"]').each((_, el) => {
    if (title && price !== null && currency) return
    const raw = $(el).contents().text().trim()
    if (!raw) return
    try {
      const data = JSON.parse(raw)
      const stack = [data]
      while (stack.length) {
        const current = stack.pop()
        if (!current) continue
        if (Array.isArray(current)) {
          stack.push(...current)
          continue
        }
        if (typeof current !== 'object') continue
        const obj = current as Record<string, unknown>
        if (!title && typeof obj.name === 'string') title = obj.name
        if (price === null && typeof obj.price !== 'undefined') price = parseMoney(String(obj.price))
        if (!currency && typeof obj.priceCurrency === 'string') currency = obj.priceCurrency
        if (!imageUrl) {
          if (typeof obj.image === 'string') imageUrl = obj.image
          if (Array.isArray(obj.image) && typeof obj.image[0] === 'string') imageUrl = obj.image[0]
        }
        for (const value of Object.values(obj)) stack.push(value)
      }
    } catch {}
  })

  return { title, price, currency, imageUrl }
}

export async function scrapeListing(url: string, role: 'mine' | 'competitor', fallbackName: string): Promise<ListingRow> {
  const tries = candidateUrls(url)
  let lastError = 'No se pudo leer la URL'

  for (const candidate of tries) {
    try {
      const { html, finalUrl } = await fetchHtml(candidate)
      const $ = cheerio.load(html)

      const itemId = extractItemId(url) || extractItemId(finalUrl) || extractItemId(html)
      const title = cleanupTitle(metaContent($, 'og:title') || metaContent($, 'twitter:title') || $('title').text() || null)
      const price = parseMoney(metaContent($, 'product:price:amount'))
      const currency = metaContent($, 'product:price:currency')
      const imageUrl = metaContent($, 'og:image') || metaContent($, 'twitter:image') || null

      const ld = findFromJsonLd($)
      const finalTitle = cleanupTitle(title || ld.title)
      const finalPrice = price ?? ld.price
      const finalCurrency = currency || ld.currency || 'ARS'
      const finalImage = imageUrl || ld.imageUrl || null

      if (!finalTitle && finalPrice === null) {
        lastError = 'HTML sin título ni precio'
        continue
      }

      return {
        role,
        name: fallbackName,
        url: finalUrl,
        itemId,
        title: finalTitle,
        price: finalPrice,
        currency: finalCurrency,
        imageUrl: finalImage,
        source: 'web',
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Error desconocido'
    }
  }

  return {
    role,
    name: fallbackName,
    url,
    itemId: extractItemId(url),
    title: null,
    price: null,
    currency: null,
    imageUrl: null,
    source: 'web',
    error: lastError,
  }
}

export function computeRows(payload: ComparePayload, listings: ListingRow[]) {
  const mine = listings.find((row) => row.role === 'mine')
  const myPrice = mine?.price ?? null

  return listings.map((row) => {
    const diff = row.price !== null && myPrice !== null ? row.price - myPrice : null
    const pct = row.price !== null && myPrice !== null && myPrice !== 0 ? ((row.price - myPrice) / myPrice) * 100 : null
    return {
      ...row,
      diff,
      pct,
    }
  })
}
