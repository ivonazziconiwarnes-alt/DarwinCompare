import { createHmac, timingSafeEqual } from 'crypto'

const COOKIE_NAME = 'comparador_ml_auth'
const WORKER_HEADER = 'x-worker-token'
const WORKER_ID_HEADER = 'x-worker-id'

const DEFAULT_USERNAME = 'Darwin'
const DEFAULT_PASSWORD = 'Warnes1102'
const DEFAULT_SESSION_SECRET = 'darwin-warnes-1102-session-secret'

function getUsername() {
  return process.env.APP_USERNAME || DEFAULT_USERNAME
}

function getPassword() {
  return process.env.APP_PASSWORD || DEFAULT_PASSWORD
}

function getSessionSecret() {
  return process.env.APP_SESSION_SECRET || DEFAULT_SESSION_SECRET
}

function safeEqual(a: string, b: string) {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)

  if (aBuf.length !== bBuf.length) return false

  try {
    return timingSafeEqual(aBuf, bBuf)
  } catch {
    return false
  }
}

function sign(value: string) {
  return createHmac('sha256', getSessionSecret()).update(value).digest('hex')
}

export function validateCredentials(username: string, password: string) {
  return safeEqual(username, getUsername()) && safeEqual(password, getPassword())
}

export function buildSessionToken(username: string) {
  return `${username}.${sign(username)}`
}

export function verifySessionToken(token?: string | null) {
  if (!token) return false

  const [username, signature] = token.split('.')
  if (!username || !signature) return false
  if (!safeEqual(username, getUsername())) return false

  const expected = sign(username)
  return safeEqual(signature, expected)
}

export function sessionUsernameFromToken(token?: string | null) {
  if (!verifySessionToken(token)) return null
  return token?.split('.')?.[0] || null
}

function parseCookieHeader(cookieHeader: string | null) {
  const out: Record<string, string> = {}
  if (!cookieHeader) return out

  cookieHeader.split(';').forEach((part) => {
    const [rawKey, ...rawValue] = part.trim().split('=')
    if (!rawKey) return
    out[rawKey] = decodeURIComponent(rawValue.join('=') || '')
  })

  return out
}

export function isAuthenticatedRequest(request: Request) {
  const cookieHeader = request.headers.get('cookie')
  const cookies = parseCookieHeader(cookieHeader)
  const token = cookies[COOKIE_NAME]
  return verifySessionToken(token)
}

export function authenticatedUsername(request: Request) {
  const cookieHeader = request.headers.get('cookie')
  const cookies = parseCookieHeader(cookieHeader)
  return sessionUsernameFromToken(cookies[COOKIE_NAME])
}

function getWorkerToken() {
  return process.env.WORKER_SYNC_TOKEN || process.env.DESKTOP_SYNC_TOKEN || ''
}

export function isWorkerRequest(request: Request) {
  const token = request.headers.get(WORKER_HEADER) || ''
  const expected = getWorkerToken()
  return !!expected && safeEqual(token, expected)
}

export function workerRequestId(request: Request) {
  return request.headers.get(WORKER_ID_HEADER) || null
}

export function authCookieName() {
  return COOKIE_NAME
}
