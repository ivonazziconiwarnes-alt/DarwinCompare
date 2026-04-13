import { chromium } from 'playwright-core'

type ListingData = {
  itemId: string | null
  title: string | null
  permalink: string
  price: number | null
  currency: string | null
  imageUrl: string | null
  sourceKind: string | null
}

const ITEM_ID_RE = /(MLA\d+)/i

function extractItemId(value: string | null | undefined) {
  if (!value) return null

  const wid = value.match(/wid=(MLA\d+)/i)
  if (wid?.[1]) return wid[1].toUpperCase()

  const mla = value.match(ITEM_ID_RE)
  if (mla?.[1]) return mla[1].toUpperCase()

  try {
    const url = new URL(value)
    for (const key of ['wid', 'item_id', 'id']) {
      const raw = url.searchParams.get(key)
      const match = raw?.match(ITEM_ID_RE)
      if (match?.[1]) return match[1].toUpperCase()
    }
  } catch {}

  return null
}

function parseMoney(raw: string | null | undefined) {
  if (!raw) return null

  const cleaned = raw.replace(/\u00a0/g, ' ').trim()
  const direct = cleaned.match(/(\d+\.\d+)/)
  if (direct?.[1]) {
    const value = Number(direct[1])
    if (Number.isFinite(value)) return value
  }

  let compact = cleaned.replace(/[^\d,.]/g, '')

  if (compact.includes(',') && compact.includes('.')) {
    compact = compact.replace(/\./g, '').replace(',', '.')
    const value = Number(compact)
    if (Number.isFinite(value)) return value
  }

  if (compact.includes(',')) {
    compact = compact.replace(/\./g, '').replace(',', '.')
    const value = Number(compact)
    if (Number.isFinite(value)) return value
  }

  compact = compact.replace(/\./g, '')
  const value = Number(compact)
  return Number.isFinite(value) ? value : null
}

function normalizeUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl)
    url.hash = ''
    return url.toString()
  } catch {
    return rawUrl.trim()
  }
}

function cleanupTitle(title: string | null) {
  if (!title) return null
  return title
    .replace(/\s*\|\s*Mercado Libre.*$/i, '')
    .replace(/\s*-\s*\$\s*[\d.,]+.*$/i, '')
    .trim()
}

function getBrowserlessWsUrl() {
  const token = process.env.BROWSERLESS_TOKEN
  const region = process.env.BROWSERLESS_REGION || 'production-sfo'
  if (!token) return null
  return `wss://${region}.browserless.io/?token=${token}`
}

function candidateUrls(sourceUrl: string, itemId: string | null) {
  const list: string[] = []
  const normalized = normalizeUrl(sourceUrl)
  if (/^https?:\/\//i.test(normalized)) list.push(normalized)

  if (itemId) {
    const digits = itemId.replace(/^MLA/i, '')
    list.push(`https://articulo.mercadolibre.com.ar/MLA-${digits}-_JM`)
    list.push(`https://listado.mercadolibre.com.ar/?item_id=${itemId}`)
    list.push(`https://listado.mercadolibre.com.ar/?pdp_filters=item_id:${itemId}`)
    list.push(`https://listado.mercadolibre.com.ar/${itemId}`)
  }

  return [...new Set(list.filter(Boolean))]
}

async function maybeOpenFirstSearchResult(page: any) {
  const finalUrl = page.url().toLowerCase()
  if (!finalUrl.includes('listado.mercadolibre')) return

  const href = await page.evaluate(() => {
    const selectors = [
      'a.poly-component__title',
      'a.ui-search-item__group__element',
      'a.ui-search-link',
      'a[href*="wid=MLA"]',
      'a[href*="/MLA-"]',
    ]

    for (const selector of selectors) {
      const element = document.querySelector<HTMLAnchorElement>(selector)
      if (element?.href) return element.href
    }

    const anyAnchor = Array.from(document.querySelectorAll<HTMLAnchorElement>('a')).find((anchor) => {
      return !!anchor.href && (anchor.href.includes('wid=MLA') || anchor.href.includes('/MLA-'))
    })

    return anyAnchor?.href || null
  })

  if (!href) return

  await page.goto(href, {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  })
  await page.waitForTimeout(2000)
}

async function extractPageData(page: any, sourceUrl: string) {
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
      data: null,
      error: 'Mercado Libre devolvio una pantalla de verificacion/login',
    }
  }

  const extracted = await page.evaluate(() => {
    const getMeta = (key: string) => {
      const selectors = [
        `meta[property="${key}"]`,
        `meta[name="${key}"]`,
        `meta[itemprop="${key}"]`,
      ]
      for (const selector of selectors) {
        const element = document.querySelector(selector)
        const value = element?.getAttribute('content')
        if (value) return value.trim()
      }
      return null
    }

    const firstCard = document.querySelector('li.ui-search-layout__item, .poly-card')
    const firstCardTitle =
      firstCard?.querySelector('.poly-component__title')?.textContent?.trim() ||
      firstCard?.querySelector('h3')?.textContent?.trim() ||
      null

    const firstCardPrice =
      firstCard?.querySelector('.andes-money-amount__fraction')?.textContent?.trim() ||
      null

    const firstCardLink =
      (firstCard?.querySelector('a[href]') as HTMLAnchorElement | null)?.href || null

    const firstCardImage =
      firstCard?.querySelector('img')?.getAttribute('src') ||
      firstCard?.querySelector('img')?.getAttribute('data-src') ||
      null

    return {
      title:
        getMeta('og:title') ||
        getMeta('twitter:title') ||
        document.title ||
        firstCardTitle,
      price:
        getMeta('product:price:amount') ||
        getMeta('price') ||
        firstCardPrice,
      currency:
        getMeta('product:price:currency') ||
        getMeta('priceCurrency') ||
        'ARS',
      imageUrl:
        getMeta('og:image') ||
        getMeta('twitter:image') ||
        firstCardImage,
      firstCardLink,
      html: document.documentElement.innerHTML,
    }
  })

  const permalink = finalUrl || extracted.firstCardLink || sourceUrl
  const title = cleanupTitle(extracted.title)
  const price = parseMoney(extracted.price)

  if (!title && price === null) {
    return {
      data: null,
      error: 'Browserless no encontro titulo ni precio',
    }
  }

  return {
    data: {
      itemId: extractItemId(permalink) || extractItemId(sourceUrl) || extractItemId(extracted.html),
      title,
      permalink,
      price,
      currency: extracted.currency || 'ARS',
      imageUrl: extracted.imageUrl,
      sourceKind: 'BROWSERLESS',
    } satisfies ListingData,
    error: null,
  }
}

export async function scrapeListingWithBrowserless(sourceUrl: string, itemId: string | null) {
  const wsUrl = getBrowserlessWsUrl()
  if (!wsUrl) {
    return { data: null as ListingData | null, error: null as string | null }
  }

  const tries = candidateUrls(sourceUrl, itemId)
  if (!tries.length) {
    return { data: null as ListingData | null, error: 'Browserless sin URL candidata' }
  }

  let lastError: string | null = null
  const browser = await chromium.connectOverCDP(wsUrl)
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
    locale: 'es-AR',
  })
  const page = await context.newPage()

  try {
    for (const url of tries) {
      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 45000,
        })
        await page.waitForTimeout(2500)
        await maybeOpenFirstSearchResult(page)

        const extracted = await extractPageData(page, url)
        if (extracted.data) return extracted
        lastError = extracted.error || lastError
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Browserless error'
      }
    }
  } finally {
    await context.close()
    await browser.close()
  }

  return {
    data: null as ListingData | null,
    error: lastError || 'Browserless no encontro datos',
  }
}
