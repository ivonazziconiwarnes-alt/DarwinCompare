import { load } from 'cheerio'
import { scrapeListingWithBrowserless } from '@/lib/browserless-listing'
import { getMeliAccessToken, hasMeliOAuthConfig } from '@/lib/meli-auth'
import type { CompareResponse, CompareRow, ManualOverride, SavedComparison } from '@/lib/types'

const API_BASE = 'https://api.mercadolibre.com'
const ITEM_ID_RE = /(M[A-Z]{2,3}\d+)/gi
const REQUEST_TIMEOUT_MS = 12000

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'Upgrade-Insecure-Requests': '1',
  DNT: '1',
} as const

type ListingData = {
  itemId: string | null
  title: string | null
  permalink: string
  price: number | null
  currency: string | null
  imageUrl: string | null
  sourceKind: string | null
}

type RunComparisonResult = {
  result: CompareResponse
  status: 'ok' | 'error'
  error: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeImage(url: string | null | undefined) {
  if (!url) return null
  return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url
}

function parseAmount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value === null || typeof value === 'undefined') return null

  const raw = String(value).trim().replace(/\u00a0/g, ' ')
  const sanitized = raw.replace(/[^0-9,.]/g, '')
  if (!sanitized) return null

  if (sanitized.includes(',') && sanitized.includes('.')) {
    const merged = sanitized.replace(/\./g, '').replace(',', '.')
    const parsed = Number(merged)
    if (Number.isFinite(parsed)) return parsed
  }

  if (sanitized.includes('.') && !sanitized.includes(',')) {
    const parts = sanitized.split('.')
    if (parts.length > 1 && parts.slice(1).every((part) => /^\d{3}$/.test(part))) {
      const parsed = Number(parts.join(''))
      if (Number.isFinite(parsed)) return parsed
    }

    const parsed = Number(sanitized)
    if (Number.isFinite(parsed)) return parsed
  }

  if (sanitized.includes(',') && !sanitized.includes('.')) {
    const parts = sanitized.split(',')
    if (parts.length > 1 && parts.slice(1).every((part) => /^\d{3}$/.test(part))) {
      const parsed = Number(parts.join(''))
      if (Number.isFinite(parsed)) return parsed
    }

    const parsed = Number(sanitized.replace(',', '.'))
    if (Number.isFinite(parsed)) return parsed
  }

  if (/^\d+$/.test(sanitized)) {
    const parsed = Number(sanitized)
    if (Number.isFinite(parsed)) return parsed
  }

  return null
}

function buildPublicUrl(itemId: string | null | undefined) {
  const normalized = (itemId || '').trim().toUpperCase()
  if (!/^MLA\d+$/.test(normalized)) return ''

  const digits = normalized.replace(/^MLA/i, '')
  return `https://articulo.mercadolibre.com.ar/MLA-${digits}-_JM`
}

function isHttpUrl(value: string | null | undefined) {
  return /^https?:\/\//i.test(value || '')
}

function pushUniqueUrl(list: string[], seen: Set<string>, candidate: string | null | undefined) {
  const normalized = (candidate || '').trim()
  if (!normalized || seen.has(normalized)) return
  seen.add(normalized)
  list.push(normalized)
}

function extractItemCandidates(value: unknown) {
  if (!value) return [] as string[]

  const raw = String(value).trim()
  const out: string[] = []
  const seen = new Set<string>()

  const add = (candidate: unknown) => {
    if (!candidate) return
    const normalized = String(candidate).trim().toUpperCase()
    const match = normalized.match(/M[A-Z]{2,3}\d+/i)
    if (!match) return
    const itemId = match[0].toUpperCase()
    if (seen.has(itemId)) return
    seen.add(itemId)
    out.push(itemId)
  }

  try {
    const url = new URL(raw)
    const path = (url.pathname || '').toUpperCase().replace(/-/g, '')
    path.match(ITEM_ID_RE)?.forEach((candidate) => add(candidate))

    for (const key of ['item_id', 'id', 'wid', 'pdp_filters', 'filters']) {
      url.searchParams.getAll(key).forEach((entry) => {
        entry.toUpperCase().match(ITEM_ID_RE)?.forEach((candidate) => add(candidate))
        const direct = entry.toUpperCase().match(/ITEM_ID[:=](M[A-Z]{2,3}\d+)/)
        if (direct?.[1]) add(direct[1])
      })
    }
  } catch {}

  raw.toUpperCase().match(ITEM_ID_RE)?.forEach((candidate) => add(candidate))
  return out
}

function extractItemId(value: unknown) {
  const candidates = extractItemCandidates(value)
  return candidates.find((candidate) => /^MLA\d+$/i.test(candidate)) || candidates[0] || null
}

function buildWebCandidates(sourceUrl: string, itemCandidates: string[]) {
  const urls: string[] = []
  const seen = new Set<string>()

  if (isHttpUrl(sourceUrl)) {
    pushUniqueUrl(urls, seen, sourceUrl)
  }

  itemCandidates.forEach((candidate) => {
    pushUniqueUrl(urls, seen, buildPublicUrl(candidate))
  })

  return urls
}

function metaContent($: ReturnType<typeof load>, key: string) {
  const selectors = [
    `meta[property="${key}"]`,
    `meta[name="${key}"]`,
    `meta[itemprop="${key}"]`,
  ]

  for (const selector of selectors) {
    const content = $(selector).attr('content')
    if (content?.trim()) return content.trim()
  }

  return null
}

function walkJson(value: unknown, found: Record<string, unknown>) {
  if (Array.isArray(value)) {
    value.forEach((entry) => walkJson(entry, found))
    return
  }

  if (!isRecord(value)) return

  for (const [key, entry] of Object.entries(value)) {
    if (!(key in found) && ['string', 'number', 'boolean'].includes(typeof entry)) {
      found[key] = entry
    }
    walkJson(entry, found)
  }
}

function parseLdJson(htmlText: string) {
  const $ = load(htmlText)
  const found: Record<string, unknown> = {}

  $('script[type="application/ld+json"]').each((_, element) => {
    const text = $(element).text().trim()
    if (!text) return
    try {
      walkJson(JSON.parse(text), found)
    } catch {}
  })

  return found
}

async function parseJsonResponse(response: Response) {
  try {
    return (await response.json()) as unknown
  } catch {
    return null
  }
}

async function apiFetch(path: string, init?: RequestInit, accessToken?: string | null) {
  const headers = new Headers(init?.headers || {})
  headers.set('Accept', 'application/json')
  headers.set('User-Agent', 'ComparadorML/Web')
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }

  return fetch(`${API_BASE}${path}`, {
    ...init,
    cache: 'no-store',
    signal: init?.signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers,
  })
}

async function fetchItemPayload(itemId: string, accessToken?: string | null) {
  const itemResponse = await apiFetch(`/items/${itemId}`, undefined, accessToken)
  if (itemResponse.ok) {
    const payload = await parseJsonResponse(itemResponse)
    if (isRecord(payload)) return payload
  }

  const multigetResponse = await apiFetch(
    `/items?ids=${encodeURIComponent(itemId)}&attributes=${encodeURIComponent(
      'id,title,price,currency_id,thumbnail,permalink,status,original_price',
    )}`,
    undefined,
    accessToken,
  )

  if (!multigetResponse.ok) return null
  const payload = await parseJsonResponse(multigetResponse)
  if (!Array.isArray(payload)) return null
  const entry = payload[0]
  if (!isRecord(entry) || entry.code !== 200 || !isRecord(entry.body)) return null
  return entry.body
}

async function fetchBestApiPrice(
  itemId: string,
  fallbackCurrency: string | null,
  accessToken: string | null,
  sourcePrefix: string,
) {
  const salePriceResponse = await apiFetch(
    `/items/${itemId}/sale_price?context=channel_marketplace`,
    undefined,
    accessToken,
  )
  if (salePriceResponse.ok) {
    const payload = await parseJsonResponse(salePriceResponse)
    if (isRecord(payload) && payload.amount !== null && typeof payload.amount !== 'undefined') {
      return {
        amount: parseAmount(payload.amount),
        currency: asString(payload.currency_id) || fallbackCurrency,
        sourceKind: `${sourcePrefix} sale_price`,
      }
    }
  }

  const pricesResponse = await apiFetch(`/items/${itemId}/prices`, undefined, accessToken)
  if (pricesResponse.ok) {
    const payload = await parseJsonResponse(pricesResponse)
    if (isRecord(payload) && Array.isArray(payload.prices)) {
      const first = payload.prices.find((entry) => isRecord(entry) && entry.amount !== null && typeof entry.amount !== 'undefined')
      if (isRecord(first)) {
        return {
          amount: parseAmount(first.amount),
          currency: asString(first.currency_id) || fallbackCurrency,
          sourceKind: `${sourcePrefix} prices`,
        }
      }
    }
  }

  return {
    amount: null,
    currency: fallbackCurrency,
    sourceKind: null,
  }
}

async function fetchApiListing(itemId: string, sourceUrl = ''): Promise<{ data: ListingData | null; error: string | null }> {
  const attempts: Array<{ token: string | null; sourcePrefix: string }> = [{ token: null, sourcePrefix: 'API' }]

  if (hasMeliOAuthConfig()) {
    const accessToken = await getMeliAccessToken()
    if (accessToken) {
      attempts.push({ token: accessToken, sourcePrefix: 'API auth' })
    }
  }

  const errors: string[] = []

  try {
    for (const attempt of attempts) {
      const payload = await fetchItemPayload(itemId, attempt.token)
      if (!payload) {
        errors.push(`${attempt.sourcePrefix} sin datos (${itemId})`)
        continue
      }

      const fallbackCurrency = asString(payload.currency_id)
      const bestPrice = await fetchBestApiPrice(itemId, fallbackCurrency, attempt.token, attempt.sourcePrefix)
      const directPrice = parseAmount(payload.price)
      const price = bestPrice.amount ?? directPrice
      const currency = bestPrice.currency ?? fallbackCurrency

      if (!asString(payload.title) || price === null) {
        errors.push(`${attempt.sourcePrefix} incompleta (${itemId})`)
        continue
      }

      return {
        data: {
          itemId,
          title: asString(payload.title),
          permalink: asString(payload.permalink) || sourceUrl || buildPublicUrl(itemId),
          price,
          currency,
          imageUrl: normalizeImage(asString(payload.thumbnail)),
          sourceKind:
            bestPrice.sourceKind ||
            (directPrice !== null ? `${attempt.sourcePrefix} item` : attempt.sourcePrefix),
        },
        error: null,
      }
    }

    return { data: null, error: errors.join(' | ') || `API sin datos (${itemId})` }
  } catch (error) {
    return {
      data: null,
      error: [...errors, error instanceof Error ? error.message : `API error (${itemId})`]
        .filter(Boolean)
        .join(' | '),
    }
  }
}

async function scrapeListing(url: string): Promise<{ data: ListingData | null; error: string | null }> {
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: BROWSER_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) return { data: null, error: `WEB ${response.status}` }

    const htmlText = await response.text()
    const finalUrl = response.url || url
    const finalLower = finalUrl.toLowerCase()
    const invalidMarkers = ['account-verification', '/gz/', '/login', 'captcha', 'security', 'authentication']
    if (invalidMarkers.some((marker) => finalLower.includes(marker))) {
      return { data: null, error: 'WEB redirigio a login/verificacion' }
    }

    const $ = load(htmlText)
    let title = metaContent($, 'og:title') || metaContent($, 'twitter:title') || $('title').first().text().trim() || null
    if (title) {
      title = title.replace(/\s*\|\s*Mercado Libre.*$/i, '').replace(/\s*-\s*\$\s*[\d.,]+.*$/i, '').trim()
    }

    let price = parseAmount(metaContent($, 'product:price:amount'))
    let currency = metaContent($, 'product:price:currency')
    let imageUrl = metaContent($, 'og:image') || metaContent($, 'twitter:image')

    const ldJson = parseLdJson(htmlText)
    if (!title) title = asString(ldJson.name)
    if (price === null) price = parseAmount(ldJson.price)
    if (!currency) currency = asString(ldJson.priceCurrency)

    const imageCandidate = ldJson.image
    if (!imageUrl) {
      imageUrl = typeof imageCandidate === 'string' ? imageCandidate : null
      if (Array.isArray(imageCandidate)) {
        const first = imageCandidate.find((entry) => typeof entry === 'string')
        if (typeof first === 'string') imageUrl = first
      }
    }

    if (price === null) {
      const amountMatch =
        htmlText.match(/"price"\s*:\s*"?(?:\s*)?(\d+(?:\.\d+)?)"?/i) ||
        htmlText.match(/"amount"\s*:\s*"?(?:\s*)?(\d+(?:\.\d+)?)"?/i)
      price = parseAmount(amountMatch?.[1])
    }

    if (!currency) {
      const currencyMatch =
        htmlText.match(/"priceCurrency"\s*:\s*"([A-Z]{3})"/i) ||
        htmlText.match(/"currency_id"\s*:\s*"([A-Z]{3})"/i)
      currency = currencyMatch?.[1] || null
    }

    const normalizedTitle = (title || '').trim().toLowerCase()
    if (!title || ['mercado libre', 'mercadolibre'].includes(normalizedTitle)) {
      return { data: null, error: 'WEB devolvio una pagina generica' }
    }

    if (price === null) return { data: null, error: 'WEB sin precio' }

    return {
      data: {
        itemId: extractItemId(url) || extractItemId(finalUrl) || extractItemId(htmlText),
        title,
        permalink: finalUrl,
        price,
        currency: currency || 'ARS',
        imageUrl: normalizeImage(imageUrl),
        sourceKind: 'WEB',
      },
      error: null,
    }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'WEB sin datos',
    }
  }
}

function normalizeManual(override: ManualOverride | null | undefined) {
  return {
    title: (override?.title || '').trim() || null,
    price: parseAmount(override?.price),
    itemId: (override?.itemId || '').trim() || null,
    imageUrl: (override?.imageUrl || '').trim() || null,
    currency: (override?.currency || 'ARS').trim() || 'ARS',
  }
}

function hasManualData(override: ManualOverride | null | undefined) {
  const manual = normalizeManual(override)
  return Boolean(manual.title || manual.price !== null || manual.itemId || manual.imageUrl)
}

function applyManualOverride(row: CompareRow, override: ManualOverride | null | undefined): CompareRow {
  if (!hasManualData(override)) return row

  const manual = normalizeManual(override)
  const merged: CompareRow = {
    ...row,
    title: row.title || manual.title,
    price: row.price ?? manual.price,
    currency: row.currency || manual.currency,
    itemId: row.itemId || manual.itemId,
    imageUrl: row.imageUrl || manual.imageUrl,
  }

  const useManualAsSource = Boolean(row.error) || row.price === null || !row.title
  if (useManualAsSource && (manual.title || manual.price !== null || manual.itemId || manual.imageUrl)) {
    merged.source = 'manual'
    merged.sourceKind = 'MANUAL'
    merged.error = undefined
  }

  return merged
}

function sourceBucket(sourceKind: string | null | undefined): CompareRow['source'] {
  const normalized = (sourceKind || '').toUpperCase()
  if (normalized.startsWith('API')) return 'api'
  if (normalized === 'WEB') return 'web'
  if (normalized === 'BROWSERLESS') return 'playwright'
  if (normalized === 'MANUAL') return 'manual'
  return 'web'
}

function buildRow(args: {
  role: CompareRow['role']
  name: string
  sourceUrl: string
  itemId: string | null
  itemData: ListingData | null
  error: string | null
}): CompareRow {
  const fallbackUrl = args.sourceUrl || buildPublicUrl(args.itemId)

  if (!args.itemData) {
    return {
      role: args.role,
      name: args.name,
      url: fallbackUrl,
      itemId: args.itemId || extractItemId(fallbackUrl),
      title: null,
      price: null,
      currency: 'ARS',
      imageUrl: null,
      source: 'web',
      sourceKind: null,
      error: args.error || 'Sin datos',
      diff: null,
      pct: null,
    }
  }

  return {
    role: args.role,
    name: args.name,
    url: args.itemData.permalink || fallbackUrl,
    itemId: args.itemData.itemId || args.itemId || extractItemId(fallbackUrl),
    title: args.itemData.title,
    price: args.itemData.price,
    currency: args.itemData.currency || 'ARS',
    imageUrl: args.itemData.imageUrl,
    source: sourceBucket(args.itemData.sourceKind),
    sourceKind: args.itemData.sourceKind,
    error: args.error || undefined,
    diff: null,
    pct: null,
  }
}

async function resolveListingWithOptions(
  itemId: string | null,
  sourceUrl: string,
  options?: { allowBrowserless?: boolean },
) {
  const candidates = new Set<string>()
  if (itemId) candidates.add(itemId.toUpperCase())
  extractItemCandidates(sourceUrl).forEach((candidate) => candidates.add(candidate.toUpperCase()))
  const orderedCandidates = [...candidates]

  const debug: string[] = []

  for (const webUrl of buildWebCandidates(sourceUrl, orderedCandidates)) {
    const scraped = await scrapeListing(webUrl)
    if (scraped.data) {
      scraped.data.itemId = scraped.data.itemId || itemId
      return scraped
    }
    if (scraped.error) debug.push(scraped.error)
  }

  for (const candidate of orderedCandidates) {
    const apiResult = await fetchApiListing(candidate, sourceUrl)
    if (apiResult.data) return apiResult
    if (apiResult.error) debug.push(apiResult.error)
  }

  if (options?.allowBrowserless !== false) {
    const browserless = await scrapeListingWithBrowserless(sourceUrl, itemId)
    if (browserless.data) return browserless
    if (browserless.error) debug.push(browserless.error)
  }

  return {
    data: null,
    error: debug.join(' | ') || 'Sin datos',
  }
}

function buildCachedRowFallback(current: CompareRow, previous: CompareRow | undefined) {
  if (!previous || previous.price === null || !previous.title) return current
  if (current.price !== null && current.title) return current

  return {
    ...current,
    url: current.url || previous.url,
    itemId: current.itemId || previous.itemId,
    title: current.title || previous.title,
    price: current.price ?? previous.price,
    currency: current.currency || previous.currency,
    imageUrl: current.imageUrl || previous.imageUrl,
    source: previous.source,
    sourceKind: 'CACHE',
    error: undefined,
  } satisfies CompareRow
}

export async function runWebComparison(comparison: SavedComparison): Promise<RunComparisonResult> {
  const comparisonName = comparison.name?.trim() || 'Comparacion ML'
  const myName = comparison.myName?.trim() || 'Mi publicacion'
  const myUrl = comparison.myUrl?.trim() || ''
  const myManual = comparison.myManual
  const competitors = comparison.competitors || []
  const previousRows = comparison.lastResult?.rows || []
  const previousMineRow = previousRows.find((row) => row.role === 'mine')
  const previousMineUrl = previousRows.find((row) => row.role === 'mine')?.url || ''
  const previousCompetitorRows = previousRows.filter((row) => row.role === 'competitor')

  const myItemId = extractItemId(myUrl) || extractItemId(myManual?.itemId)
  if (!myItemId) {
    throw new Error('No pude resolver el MLA de tu publicacion.')
  }

  const rows: CompareRow[] = []
  const mySourceUrl = isHttpUrl(myUrl) ? myUrl : previousMineUrl || myUrl

  const myResult = await resolveListingWithOptions(myItemId, mySourceUrl, {
    allowBrowserless: true,
  })
  rows.push(
    buildCachedRowFallback(
      applyManualOverride(
        buildRow({
          role: 'mine',
          name: myName,
          sourceUrl: mySourceUrl,
          itemId: myItemId,
          itemData: myResult.data,
          error: myResult.error,
        }),
        myManual,
      ),
      previousMineRow,
    ),
  )

  const competitorRows: CompareRow[] = []
  for (const [index, competitor] of competitors.entries()) {
      const label = competitor.name?.trim() || `Competidor ${index + 1}`
      const rawSourceUrl = competitor.url?.trim() || ''
      const previousUrl = previousCompetitorRows[index]?.url || ''
      const sourceUrl = isHttpUrl(rawSourceUrl) ? rawSourceUrl : previousUrl || rawSourceUrl
      const manualOverride = competitor.manualOverride
      const competitorItemId =
        extractItemId(rawSourceUrl) || extractItemId(previousUrl) || extractItemId(manualOverride?.itemId)
      const previousRow = previousCompetitorRows[index]
      const resolved = await resolveListingWithOptions(competitorItemId, sourceUrl, {
        allowBrowserless: true,
      })

      competitorRows.push(
        buildCachedRowFallback(
        applyManualOverride(
          buildRow({
            role: 'competitor',
            name: label,
            sourceUrl,
            itemId: competitorItemId,
            itemData: resolved.data,
            error: resolved.error,
          }),
          manualOverride,
        ),
        previousRow,
      ),
      )
  }

  rows.push(...competitorRows)

  const minePrice = rows.find((row) => row.role === 'mine')?.price ?? null
  rows.forEach((row) => {
    if (row.price !== null && minePrice !== null) {
      row.diff = row.price - minePrice
      row.pct = minePrice ? ((row.price - minePrice) / minePrice) * 100 : null
      return
    }

    row.diff = null
    row.pct = null
  })

  const okCount = rows.filter((row) => !row.error).length
  const failedCount = rows.length - okCount
  const cacheFallbackCount = rows.filter((row) => row.sourceKind === 'CACHE').length
  const status: 'ok' | 'error' = minePrice !== null ? 'ok' : 'error'
  const error =
    status === 'error'
      ? rows[0]?.error || 'No se pudieron obtener datos de la publicacion principal.'
      : cacheFallbackCount > 0
        ? `Se mostraron ${cacheFallbackCount} fila(s) con el ultimo resultado guardado porque Mercado Libre bloqueo la lectura en vivo.`
      : null

  return {
    status,
    error,
    result: {
      comparisonName,
      rows,
      summary: {
        total: rows.length,
        ok: okCount,
        failed: failedCount,
        minePrice,
      },
      ...(error ? { error } : {}),
    },
  }
}
