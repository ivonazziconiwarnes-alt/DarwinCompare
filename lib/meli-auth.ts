const TOKEN_URL = 'https://api.mercadolibre.com/oauth/token'
const REQUEST_TIMEOUT_MS = 12000
const TOKEN_SAFETY_WINDOW_SECONDS = 60

type TokenCache = {
  accessToken: string
  expiresAt: number
}

let cache: TokenCache | null = null
let refreshing: Promise<string | null> | null = null

function envValue(key: string) {
  const value = process.env[key]
  return value && value.trim() ? value.trim() : ''
}

function nowEpochSeconds() {
  return Math.floor(Date.now() / 1000)
}

function isValid(entry: TokenCache | null) {
  if (!entry) return false
  return entry.expiresAt > nowEpochSeconds() + TOKEN_SAFETY_WINDOW_SECONDS
}

function buildSeedFromEnv(): TokenCache | null {
  const token = envValue('MELI_ACCESS_TOKEN')
  if (!token) return null

  const fromEnv = Number(envValue('MELI_ACCESS_TOKEN_EXPIRES_AT') || 0)
  const expiresAt = Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : nowEpochSeconds() + 60 * 15
  return { accessToken: token, expiresAt }
}

async function refreshAccessToken(): Promise<TokenCache | null> {
  const clientId = envValue('MELI_CLIENT_ID')
  const clientSecret = envValue('MELI_CLIENT_SECRET')
  const refreshToken = envValue('MELI_REFRESH_TOKEN')

  if (!clientId || !clientSecret || !refreshToken) return null

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'ComparadorML/Web',
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  })

  if (!response.ok) return null

  const payload = (await response.json()) as Record<string, unknown>
  const accessToken = typeof payload.access_token === 'string' ? payload.access_token.trim() : ''
  const expiresInRaw = Number(payload.expires_in)
  if (!accessToken || !Number.isFinite(expiresInRaw) || expiresInRaw <= 0) return null

  return {
    accessToken,
    expiresAt: nowEpochSeconds() + expiresInRaw,
  }
}

export function hasMeliOAuthConfig() {
  return Boolean(envValue('MELI_CLIENT_ID') && envValue('MELI_CLIENT_SECRET') && envValue('MELI_REFRESH_TOKEN'))
}

export async function getMeliAccessToken(): Promise<string | null> {
  if (isValid(cache)) return cache!.accessToken

  const seeded = buildSeedFromEnv()
  if (seeded && isValid(seeded)) {
    cache = seeded
    return seeded.accessToken
  }

  if (!hasMeliOAuthConfig()) return null
  if (refreshing) return refreshing

  refreshing = (async () => {
    try {
      const refreshed = await refreshAccessToken()
      if (!refreshed) return null
      cache = refreshed
      return refreshed.accessToken
    } catch {
      return null
    } finally {
      refreshing = null
    }
  })()

  return refreshing
}
