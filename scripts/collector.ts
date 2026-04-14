import { randomUUID } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { runWebComparison } from '../lib/ml-web'
import type { CompareResponse, SavedComparison } from '../lib/types'

type ClaimPayload = {
  run: { id: string } | null
  comparison: SavedComparison | null
  error?: string
}

const DEFAULT_BASE_URL = 'https://darwin-compare.vercel.app'
const DEFAULT_POLL_INTERVAL_MS = 5000

function loadLocalEnvFile() {
  const envPath = resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key && !(key in process.env)) {
      process.env[key] = value
    }
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (!text) return {} as T
  return JSON.parse(text) as T
}

function workerHeaders(workerId: string) {
  const token = process.env.WORKER_SYNC_TOKEN || process.env.DESKTOP_SYNC_TOKEN || ''
  if (!token) {
    throw new Error('Falta WORKER_SYNC_TOKEN o DESKTOP_SYNC_TOKEN para ejecutar el collector.')
  }

  return {
    'Content-Type': 'application/json',
    'x-worker-token': token,
    'x-worker-id': workerId,
  }
}

function getBaseUrl() {
  return (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
}

function getWorkerId() {
  return process.env.WORKER_ID || `collector-${randomUUID().slice(0, 8)}`
}

function getPollIntervalMs() {
  const raw = Number(process.env.WORKER_POLL_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_POLL_INTERVAL_MS
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function buildErrorResult(comparison: SavedComparison, error: string): CompareResponse {
  return {
    comparisonName: comparison.name?.trim() || 'Comparacion ML',
    rows: [],
    summary: {
      total: 0,
      ok: 0,
      failed: 0,
      minePrice: null,
    },
    error,
  }
}

async function claimRun(baseUrl: string, headers: Record<string, string>) {
  const response = await fetch(`${baseUrl}/api/worker/runs/claim`, {
    method: 'POST',
    headers,
  })

  const json = await readJson<ClaimPayload>(response)
  if (!response.ok) {
    throw new Error(json.error || 'No se pudo reclamar una corrida.')
  }

  return json
}

async function completeRun(
  baseUrl: string,
  headers: Record<string, string>,
  runId: string,
  payload: {
    status: 'ok' | 'error'
    error: string | null
    result: CompareResponse | null
  },
) {
  const response = await fetch(`${baseUrl}/api/worker/runs/${runId}/complete`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  const json = await readJson<{ error?: string }>(response)
  if (!response.ok) {
    throw new Error(json.error || 'No se pudo cerrar la corrida.')
  }
}

async function processOne(baseUrl: string, workerId: string) {
  const headers = workerHeaders(workerId)
  const claimed = await claimRun(baseUrl, headers)
  if (!claimed.run || !claimed.comparison) return false

  const runId = claimed.run.id
  const comparison = claimed.comparison

  try {
    const executed = await runWebComparison(comparison)
    await completeRun(baseUrl, headers, runId, {
      status: executed.status,
      error: executed.error,
      result: executed.result,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo ejecutar la comparacion.'
    await completeRun(baseUrl, headers, runId, {
      status: 'error',
      error: message,
      result: buildErrorResult(comparison, message),
    })
  }

  return true
}

async function main() {
  loadLocalEnvFile()

  const baseUrl = getBaseUrl()
  const workerId = getWorkerId()
  const once = process.argv.includes('--once')

  if (once) {
    const processed = await processOne(baseUrl, workerId)
    console.log(processed ? 'collector: corrida procesada' : 'collector: sin corridas pendientes')
    return
  }

  const pollIntervalMs = getPollIntervalMs()
  console.log(`collector: conectado a ${baseUrl} como ${workerId}`)

  while (true) {
    try {
      const processed = await processOne(baseUrl, workerId)
      if (!processed) {
        await sleep(pollIntervalMs)
      }
    } catch (error) {
      console.error('collector:', error instanceof Error ? error.message : error)
      await sleep(pollIntervalMs)
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
