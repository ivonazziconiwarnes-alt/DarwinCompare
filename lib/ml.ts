import { chromium } from 'playwright-core'
import type { ManualOverride } from './types'

export type ListingRow = {
  role: 'mine' | 'competitor'
  name: string
  url: string
  itemId: string | null
  title: string | null
  price: number | null
  currency: string | null
  imageUrl: string | null
  source: 'web' | 'manual'
  error?: string
}

export type ComparePayload = {
  comparisonName: string
  myName?: string
  myUrl: string
  myManual?: ManualOverride
  competitors: Array<{ name?: string; url: string; manualOverride?: ManualOverride }>
}

type BrowserExtract = {
  finalUrl: string
  title: string | null
  price: number | null
  currency: string | null
  imageUrl: string | null
  itemId: string | null
  blocked: boolean
  blockedReason: string | null
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

function parseMoney(raw: string | number | null | undefined): number | null {
  if (raw === null || typeof raw === 'undefined') return null

  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null
  }

  const cleaned = raw.replace(/\u00a0/g, ' ').trim()

  const direct = cleaned.match(/(\d+\.\d+)/)
  if (direct) {
    const value = Number(direct[1])
    return Number.isFinite(value) ? value : null
  }

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

function normalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    url.hash = ''
    return url.toString()
  } catch {
    return rawUrl.trim()
  }
}

function decodeGoUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    const go = url.searchParams.get('go')
    if (!go) return null
    return decodeURIComponent(go)
  } catch {
    return null
  }
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

  const normalized = normalizeUrl(rawUrl)
  if (normalized) list.push(normalized)

  const goUrl = decodeGoUrl(normalized)
  if (goUrl) list.push(normalizeUrl(goUrl))

  const itemId = extractItemId(normalized)
  if (itemId) {
    const numeric = itemId.replace('MLA', '')
    list.push(`https://articulo.mercadolibre.com.ar/MLA-${numeric}-_JM`)
  }

  return [...new Set(list.filter(Boolean))]
}

function getBrowserlessWsUrl() {
  const token = process.env.BROWSERLESS_TOKEN
  const region = process.env.BROWSERLESS_REGION || 'production-sfo'

  if (!token) {
    throw new Error('Falta BROWSERLESS_TOKEN en variables de entorno.')
  }

  return `wss://${region}.browserless.io/?token=${token}`
}

async function extractWithBrowser(url: string): Promise<BrowserExtract> {
  const browser = await chromium.connectOverCDP(getBrowserlessWsUrl())
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
    locale: 'es-AR',
  })

  const page = await context.newPage()

  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    })

    await page.waitForTimeout(2500)

    const finalUrl = page.url()
    const bodyText = ((await page.textContent('body')) || '').replace(/\s+/g, ' ').trim().toLowerCase()

    const blockedPatterns = [
      'para continuar, ingresa a tu cuenta',
      'para continuar, ingresá a tu cuenta',
      'ya tengo cuenta',
      'soy nuevo',
      'account verification',
      'ingresa a tu cuenta',
      'ingresá a tu cuenta',
    ]

    if (
      finalUrl.toLowerCase().includes('/gz/account-verification') ||
      finalUrl.toLowerCase().includes('/registration') ||
      finalUrl.toLowerCase().includes('/login') ||
      blockedPatterns.some((pattern) => bodyText.includes(pattern))
    ) {
      return {
        finalUrl,
        title: null,
        price: null,
        currency: null,
        imageUrl: null,
        itemId: extractItemId(finalUrl) || extractItemId(url),
        blocked: true,
        blockedReason: 'Mercado Libre devolvió una pantalla de verificación/login',
      }
    }

    const data = await page.evaluate(() => {
      const getMeta = (key: string) => {
        const selectors = [`meta[property="${key}"]`, `meta[name="${key}"]`, `meta[itemprop="${key}"]`]
        for (const selector of selectors) {
          const el = document.querySelector(selector)
          const value = el?.getAttribute('content')
          if (value) return value.trim()
        }
        return null
      }

      const ldJsonNodes = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))

      let ldTitle: string | null = null
      let ldPrice: string | null = null
      let ldCurrency: string | null = null
      let ldImage: string | null = null

      const walk = (value: any) => {
        if (!value) return

        if (Array.isArray(value)) {
          for (const item of value) walk(item)
          return
        }

        if (typeof value !== 'object') return

        if (!ldTitle && typeof value.name === 'string') ldTitle = value.name
        if (!ldPrice && typeof value.price !== 'undefined') ldPrice = String(value.price)
        if (!ldCurrency && typeof value.priceCurrency === 'string') ldCurrency = value.priceCurrency

        if (!ldImage) {
          if (typeof value.image === 'string') ldImage = value.image
          if (Array.isArray(value.image) && typeof value.image[0] === 'string') ldImage = value.image[0]
        }

        for (const child of Object.values(value)) walk(child)
      }

      for (const node of ldJsonNodes) {
        const raw = node.textContent?.trim()
        if (!raw) continue
        try {
          const parsed = JSON.parse(raw)
          walk(parsed)
        } catch {}
      }

      const visiblePriceCandidates = [
        document.querySelector('[itemprop="price"]')?.getAttribute('content'),
        document.querySelector('meta[itemprop="price"]')?.getAttribute('content'),
        document.querySelector('[data-testid="price-part"]')?.textContent,
        document.querySelector('.andes-money-amount__fraction')?.textContent,
      ].filter(Boolean)

      const title =
        getMeta('og:title') ||
        getMeta('twitter:title') ||
        document.title ||
        ldTitle ||
        null

      const price =
        getMeta('product:price:amount') ||
        getMeta('price') ||
        ldPrice ||
        visiblePriceCandidates[0] ||
        null

      const currency =
        getMeta('product:price:currency') ||
        getMeta('priceCurrency') ||
        ldCurrency ||
        'ARS'

      const imageUrl =
        getMeta('og:image') ||
        getMeta('twitter:image') ||
        ldImage ||
        null

      return {
        title,
        price,
        currency,
        imageUrl,
        html: document.documentElement.innerHTML,
      }
    })

    const itemId = extractItemId(finalUrl) || extractItemId(url) || extractItemId(data.html)

    return {
      finalUrl,
      title: cleanupTitle(data.title),
      price: parseMoney(data.price),
      currency: data.currency || 'ARS',
      imageUrl: data.imageUrl,
      itemId,
      blocked: false,
      blockedReason: null,
    }
  } finally {
    await context.close()
    await browser.close()
  }
}

export async function scrapeListing(
  url: string,
  role: 'mine' | 'competitor',
  fallbackName: string,
): Promise<ListingRow> {
  const tries = candidateUrls(url)
  let lastError = 'No se pudo leer la URL'

  for (const candidate of tries) {
    try {
      const result = await extractWithBrowser(candidate)

      if (result.blocked) {
        lastError = result.blockedReason || 'Mercado Libre devolvió bloqueo'
        continue
      }

      if (!result.title && result.price === null) {
        lastError = 'Página sin título ni precio'
        continue
      }

      return {
        role,
        name: fallbackName,
        url: result.finalUrl || candidate,
        itemId: result.itemId,
        title: result.title,
        price: result.price,
        currency: result.currency,
        imageUrl: result.imageUrl,
        source: 'web',
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Error desconocido'
    }
  }

  return {
    role,
    name: fallbackName,
    url: normalizeUrl(url),
    itemId: extractItemId(url),
    title: null,
    price: null,
    currency: null,
    imageUrl: null,
    source: 'web',
    error: lastError,
  }
}

function normalizeManual(override?: ManualOverride | null) {
  const title = override?.title?.trim() || null
  const price = parseMoney(override?.price ?? null)
  const itemId = override?.itemId?.trim() || null
  const imageUrl = override?.imageUrl?.trim() || null
  const currency = override?.currency?.trim() || 'ARS'

  return { title, price, itemId, imageUrl, currency }
}

function hasManualData(override?: ManualOverride | null) {
  const manual = normalizeManual(override)
  return !!(manual.title || manual.price !== null || manual.itemId || manual.imageUrl)
}

export function applyManualOverride(scraped: ListingRow, override?: ManualOverride | null): ListingRow {
  if (!hasManualData(override)) return scraped

  const manual = normalizeManual(override)

  const merged: ListingRow = {
    ...scraped,
    title: scraped.title || manual.title,
    price: scraped.price ?? manual.price,
    currency: scraped.currency || manual.currency,
    itemId: scraped.itemId || manual.itemId,
    imageUrl: scraped.imageUrl || manual.imageUrl,
  }

  const useManualAsSource =
    !!scraped.error ||
    scraped.price === null ||
    !scraped.title

  if (useManualAsSource && (manual.title || manual.price !== null || manual.itemId || manual.imageUrl)) {
    return {
      ...merged,
      source: 'manual',
      error: undefined,
    }
  }

  return merged
}

export function computeRows(payload: ComparePayload, listings: ListingRow[]) {
  const mine = listings.find((row) => row.role === 'mine')
  const myPrice = mine?.price ?? null

  return listings.map((row) => {
    const diff =
      row.price !== null && myPrice !== null
        ? row.price - myPrice
        : null

    const pct =
      row.price !== null && myPrice !== null && myPrice !== 0
        ? ((row.price - myPrice) / myPrice) * 100
        : null

    return {
      ...row,
      diff,
      pct,
    }
  })
}