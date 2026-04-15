'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FolderKanban,
  Image as ImageIcon,
  Loader2,
  LockKeyhole,
  LogOut,
  PencilLine,
  Plus,
  RefreshCw,
  Save,
  Tag,
  TrendingUp,
  Trash2,
  X,
} from 'lucide-react'
import type {
  CompareHistoryPoint,
  CompareRow,
  ComparisonRun,
  CompetitorInput,
  ManualOverride,
  SavedComparison,
} from '@/lib/types'

function uid() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function emptyManual(): ManualOverride {
  return {
    title: '',
    price: '',
    itemId: '',
    imageUrl: '',
    currency: 'ARS',
  }
}

function emptyCompetitor(position: number): CompetitorInput {
  return { id: uid(), name: '', url: '', position, manualOverride: emptyManual() }
}

function emptyComparison(): SavedComparison {
  const now = new Date().toISOString()
  return {
    id: uid(),
    name: 'Nueva comparación',
    category: 'General',
    myName: 'Mi publicación',
    myUrl: '',
    myManual: emptyManual(),
    competitors: [emptyCompetitor(0), emptyCompetitor(1)],
    createdAt: now,
    updatedAt: now,
    lastResult: null,
    syncStatus: 'pending',
    lastSyncedAt: null,
    syncError: null,
  }
}

function normalizeMlaInput(value: string) {
  const digits = String(value || '')
    .toUpperCase()
    .replace(/^MLA/i, '')
    .replace(/\D/g, '')
  return digits ? `MLA${digits}` : ''
}

function mlaDigits(value: string) {
  return String(value || '')
    .toUpperCase()
    .replace(/^MLA/i, '')
    .replace(/\D/g, '')
}

function hydrateManual(value?: Partial<ManualOverride> | null): ManualOverride {
  return {
    title: value?.title || '',
    price: value?.price || '',
    itemId: value?.itemId || '',
    imageUrl: value?.imageUrl || '',
    currency: value?.currency || 'ARS',
  }
}

function hydrateComparison(value: SavedComparison): SavedComparison {
  return {
    ...value,
    myManual: hydrateManual(value.myManual),
    syncStatus: value.syncStatus || 'pending',
    lastSyncedAt: value.lastSyncedAt || null,
    syncError: value.syncError || null,
    competitors: (value.competitors || []).map((competitor, index) => ({
      ...competitor,
      position: typeof competitor.position === 'number' ? competitor.position : index,
      manualOverride: hydrateManual(competitor.manualOverride),
    })),
  }
}

function money(value: number | null | undefined, currency: string | null | undefined) {
  if (value === null || typeof value === 'undefined') return '—'
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: currency || 'ARS',
    maximumFractionDigits: 2,
  }).format(value)
}

function percent(value: number | null | undefined) {
  if (value === null || typeof value === 'undefined') return '—'
  return `${value.toFixed(1)}%`
}

function prettyDate(value: string) {
  try {
    return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  } catch {
    return value
  }
}

function shortDateTime(value: string) {
  try {
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return value
  }
}

function syncLabel(status: 'pending' | 'running' | 'ok' | 'error') {
  if (status === 'ok') return 'Actualizada'
  if (status === 'running') return 'Ejecutando'
  if (status === 'error') return 'Error'
  return 'Sin actualizar'
}

function syncClass(status: 'pending' | 'running' | 'ok' | 'error') {
  if (status === 'ok') return 'sync-ok'
  if (status === 'running') return 'sync-running'
  if (status === 'error') return 'sync-error'
  return 'sync-pending'
}

type PriceHistorySnapshot = {
  key: string
  capturedAt: string
  label: string
  rows: CompareHistoryPoint['rows']
}

type PriceHistorySeries = {
  key: string
  label: string
  role: CompareRow['role']
  currency: string | null
  color: string
  values: Array<number | null>
  latestPrice: number | null
}

type PriceHistoryChartData = {
  snapshots: PriceHistorySnapshot[]
  series: PriceHistorySeries[]
  minPrice: number
  maxPrice: number
  ticks: number[]
}

const HISTORY_COLORS = ['#2f6df6', '#14c8b8', '#ff9d00', '#ff5d7a', '#7a5cff', '#10b981', '#f97316']
const MINE_HISTORY_COLOR = '#c28a11'

function rowToHistoryRow(row: CompareRow) {
  return {
    role: row.role,
    name: row.name,
    url: row.url,
    itemId: row.itemId,
    price: row.price,
    currency: row.currency,
    source: row.source,
    sourceKind: row.sourceKind ?? null,
  }
}

function normalizeHistorySnapshots(selected: SavedComparison | null, runs: ComparisonRun[]): PriceHistorySnapshot[] {
  if (!selected) return []

  const byKey = new Map<string, PriceHistorySnapshot>()
  const history = Array.isArray(selected.lastResult?.history) ? selected.lastResult.history : []

  history.forEach((point, index) => {
    if (!point?.capturedAt || !Array.isArray(point.rows) || !point.rows.length) return
    const key = point.runId || `history-${point.capturedAt}-${index}`
    byKey.set(key, {
      key,
      capturedAt: point.capturedAt,
      label: shortDateTime(point.capturedAt),
      rows: point.rows,
    })
  })

  runs.forEach((run) => {
    if (!Array.isArray(run.rows) || !run.rows.length) return
    const capturedAt = run.finishedAt || run.startedAt || run.requestedAt
    byKey.set(run.id, {
      key: run.id,
      capturedAt,
      label: shortDateTime(capturedAt),
      rows: run.rows.map(rowToHistoryRow),
    })
  })

  const currentRows = selected.lastResult?.rows || []
  if (currentRows.length) {
    const capturedAt = selected.lastSyncedAt || selected.updatedAt || selected.createdAt
    const alreadyIncluded = Array.from(byKey.values()).some((snapshot) => snapshot.capturedAt === capturedAt)

    if (!alreadyIncluded) {
      byKey.set(`current-${capturedAt}`, {
        key: `current-${capturedAt}`,
        capturedAt,
        label: shortDateTime(capturedAt),
        rows: currentRows.map(rowToHistoryRow),
      })
    }
  }

  return Array.from(byKey.values()).sort(
    (a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime(),
  )
}

function buildPriceHistoryChartData(
  selected: SavedComparison | null,
  runs: ComparisonRun[],
): PriceHistoryChartData | null {
  const snapshots = normalizeHistorySnapshots(selected, runs)
  if (!snapshots.length) return null

  const seriesMap = new Map<
    string,
    Omit<PriceHistorySeries, 'color'> & { colorIndex?: number }
  >()
  let competitorColorIndex = 0

  snapshots.forEach((snapshot, snapshotIndex) => {
    snapshot.rows.forEach((row) => {
      const key = `${row.role}::${row.itemId || row.url || row.name}`
      const price = typeof row.price === 'number' ? row.price : null

      if (!seriesMap.has(key)) {
        seriesMap.set(key, {
          key,
          label: row.name || (row.role === 'mine' ? 'Mi publicación' : 'Competidor'),
          role: row.role,
          currency: row.currency ?? 'ARS',
          values: Array(snapshots.length).fill(null),
          latestPrice: null,
          colorIndex: row.role === 'mine' ? -1 : competitorColorIndex++,
        })
      }

      const series = seriesMap.get(key)!
      series.values[snapshotIndex] = price
      series.latestPrice = price ?? series.latestPrice
      if (!series.currency && row.currency) series.currency = row.currency
      if (row.name) series.label = row.name
    })
  })

  const series = Array.from(seriesMap.values())
    .filter((entry) => entry.values.some((value) => value !== null))
    .map((entry) => ({
      ...entry,
      color:
        entry.role === 'mine'
          ? MINE_HISTORY_COLOR
          : HISTORY_COLORS[(entry.colorIndex || 0) % HISTORY_COLORS.length],
    }))
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === 'mine' ? -1 : 1
      return a.label.localeCompare(b.label, 'es')
    })

  const allValues = series.flatMap((entry) => entry.values).filter((value): value is number => value !== null)
  if (!allValues.length) return null

  const rawMin = Math.min(...allValues)
  const rawMax = Math.max(...allValues)
  const padding = Math.max((rawMax - rawMin) * 0.12, rawMax * 0.04, 1)
  const minPrice = Math.max(0, rawMin - padding)
  const maxPrice = rawMax + padding
  const tickCount: number = 4
  const ticks = Array.from({ length: tickCount }, (_, index) => {
    if (tickCount === 1) return maxPrice
    const ratio = index / (tickCount - 1)
    return maxPrice - (maxPrice - minPrice) * ratio
  })

  return { snapshots, series, minPrice, maxPrice, ticks }
}

function axisMoney(value: number, currency: string | null | undefined) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: currency || 'ARS',
    maximumFractionDigits: 0,
  }).format(value)
}

function svgLinePath(values: Array<number | null>, xFor: (index: number) => number, yFor: (value: number) => number) {
  let path = ''
  let open = false

  values.forEach((value, index) => {
    if (value === null) {
      open = false
      return
    }

    path += `${open ? 'L' : 'M'}${xFor(index)} ${yFor(value)} `
    open = true
  })

  return path.trim()
}

async function readApiPayload(res: Response) {
  const text = await res.text()
  if (!text) return {}

  try {
    return JSON.parse(text) as Record<string, any>
  } catch {
    return {
      error:
        text.length > 220
          ? `${text.slice(0, 220).trim()}...`
          : text.trim(),
    }
  }
}

export default function HomePage() {
  const [items, setItems] = useState<SavedComparison[]>([])
  const [runs, setRuns] = useState<ComparisonRun[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [categoryFilter, setCategoryFilter] = useState<string>('Todas')
  const [loadingInitial, setLoadingInitial] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadingCompare, setLoadingCompare] = useState(false)
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [loggedIn, setLoggedIn] = useState(false)
  const [loginLoading, setLoginLoading] = useState(false)
  const [showEditor, setShowEditor] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewImage, setPreviewImage] = useState<{ src: string; title: string } | null>(null)
  const [dirtyIds, setDirtyIds] = useState<string[]>([])
  const [loginUser, setLoginUser] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  const selected = useMemo(() => items.find((item) => item.id === selectedId) || null, [items, selectedId])
  const historyChart = useMemo(() => buildPriceHistoryChartData(selected, runs), [selected, runs])

  async function checkSession() {
    setCheckingSession(true)
    try {
      const res = await fetch('/api/auth/session', { cache: 'no-store' })
      const json = await readApiPayload(res)
      const authenticated = Boolean(json.authenticated)
      setLoggedIn(authenticated)
      if (authenticated) {
        await loadComparisons()
      } else {
        setItems([])
        setSelectedId('')
      }
    } catch {
      setLoggedIn(false)
      setItems([])
      setSelectedId('')
    } finally {
      setCheckingSession(false)
      setLoadingInitial(false)
    }
  }

  async function loadComparisons(selectId?: string) {
    setLoadingInitial(true)
    setError(null)
    try {
      const res = await fetch('/api/comparisons', { cache: 'no-store' })

      if (res.status === 401) {
        setLoggedIn(false)
        setItems([])
        setSelectedId('')
        return
      }

      const json = await readApiPayload(res)
      if (!res.ok) throw new Error(json.error || 'No se pudieron leer las comparaciones.')

      const next = (json.items as SavedComparison[]).map(hydrateComparison)
      setItems(next)

      if (next.length) {
        setSelectedId((current) => {
          if (selectId && next.some((item) => item.id === selectId)) return selectId
          if (current && next.some((item) => item.id === current)) return current
          return next[0].id
        })
      } else {
        setSelectedId('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron leer las comparaciones.')
    } finally {
      setLoadingInitial(false)
    }
  }

  async function loadRuns(comparisonId: string, { silent = false }: { silent?: boolean } = {}) {
    if (!comparisonId) {
      setRuns([])
      return
    }

    if (!silent) setLoadingRuns(true)

    try {
      const res = await fetch(`/api/comparisons/${comparisonId}/runs?limit=20`, { cache: 'no-store' })

      if (res.status === 401) {
        setLoggedIn(false)
        setRuns([])
        return
      }

      const json = await readApiPayload(res)
      if (!res.ok) throw new Error(json.error || 'No se pudieron leer las ejecuciones.')
      setRuns((json.items as ComparisonRun[]) || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron leer las ejecuciones.')
    } finally {
      if (!silent) setLoadingRuns(false)
    }
  }

  useEffect(() => {
    checkSession()
  }, [])

  useEffect(() => {
    if (!loggedIn || !selectedId) {
      setRuns([])
      return
    }
    loadRuns(selectedId)
  }, [loggedIn, selectedId])

  useEffect(() => {
    if (!loggedIn || !selectedId || !selected || selected.syncStatus !== 'running') return

    const timer = window.setInterval(() => {
      void loadComparisons(selectedId)
      void loadRuns(selectedId, { silent: true })
    }, 5000)

    return () => window.clearInterval(timer)
  }, [loggedIn, selectedId, selected?.syncStatus])

  const categories = useMemo(() => {
    const set = new Set(['Todas'])
    items.forEach((item) => set.add(item.category || 'Sin categoría'))
    return Array.from(set)
  }, [items])

  const visibleItems = useMemo(() => {
    if (categoryFilter === 'Todas') return items
    return items.filter((item) => (item.category || 'Sin categoría') === categoryFilter)
  }, [items, categoryFilter])

  function markDirty(id: string) {
    setDirtyIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }

  function clearDirty(id: string) {
    setDirtyIds((prev) => prev.filter((x) => x !== id))
  }

  function updateSelected(updater: (current: SavedComparison) => SavedComparison) {
    if (!selected) return

    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== selected.id) return item

        const next = hydrateComparison(
          updater({
            ...item,
            updatedAt: new Date().toISOString(),
          }),
        )

        return {
          ...next,
          syncStatus: 'pending',
          syncError: null,
        }
      }),
    )

    markDirty(selected.id)
  }

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoginLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUser, password: loginPassword }),
      })

      const json = await readApiPayload(res)
      if (!res.ok) throw new Error(json.error || 'No se pudo iniciar sesión.')

      setLoggedIn(true)
      setShowEditor(false)
      await loadComparisons()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión.')
    } finally {
      setLoginLoading(false)
    }
  }

  async function handleLogout() {
    setError(null)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {}

    setLoggedIn(false)
    setItems([])
    setSelectedId('')
    setDirtyIds([])
    setShowEditor(false)
  }

  async function createComparison() {
    setError(null)
    try {
      const fresh = emptyComparison()
      const res = await fetch('/api/comparisons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fresh),
      })

      if (res.status === 401) {
        setLoggedIn(false)
        return
      }

      const json = await readApiPayload(res)
      if (!res.ok) throw new Error(json.error || 'No se pudo crear la comparación.')

      const item = hydrateComparison(json.item as SavedComparison)
      setItems((prev) => [item, ...prev])
      setSelectedId(item.id)
      setShowEditor(true)
      clearDirty(item.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la comparación.')
    }
  }

  async function saveComparison(payload?: SavedComparison) {
    const current = payload || selected
    if (!current) return

    setSaving(true)
    setError(null)

    try {
      const res = await fetch(`/api/comparisons/${current.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(current),
      })

      if (res.status === 401) {
        setLoggedIn(false)
        return
      }

      const json = await readApiPayload(res)
      if (!res.ok) throw new Error(json.error || 'No se pudo guardar la comparación.')

      const item = hydrateComparison(json.item as SavedComparison)
      setItems((prev) => prev.map((row) => (row.id === item.id ? item : row)))
      clearDirty(item.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la comparación.')
    } finally {
      setSaving(false)
    }
  }

  async function duplicateComparison() {
    if (!selected) return
    setError(null)

    try {
      const now = new Date().toISOString()
      const copy: SavedComparison = {
        ...selected,
        id: uid(),
        name: `${selected.name} (copia)`,
        createdAt: now,
        updatedAt: now,
        syncStatus: 'pending',
        lastSyncedAt: null,
        syncError: null,
        myManual: { ...selected.myManual },
        competitors: selected.competitors.map((comp, index) => ({
          ...comp,
          id: uid(),
          position: index,
          manualOverride: { ...comp.manualOverride },
        })),
      }

      const res = await fetch('/api/comparisons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(copy),
      })

      if (res.status === 401) {
        setLoggedIn(false)
        return
      }

      const json = await readApiPayload(res)
      if (!res.ok) throw new Error(json.error || 'No se pudo duplicar la comparación.')

      const item = hydrateComparison(json.item as SavedComparison)
      setItems((prev) => [item, ...prev])
      setSelectedId(item.id)
      setShowEditor(true)
      clearDirty(item.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo duplicar la comparación.')
    }
  }

  async function deleteComparison() {
    if (!selected) return
    const yes = window.confirm(`¿Borrar la comparación "${selected.name}"?`)
    if (!yes) return

    setError(null)

    try {
      const res = await fetch(`/api/comparisons/${selected.id}`, { method: 'DELETE' })

      if (res.status === 401) {
        setLoggedIn(false)
        return
      }

      const json = await readApiPayload(res)
      if (!res.ok) throw new Error(json.error || 'No se pudo borrar la comparación.')

      const next = items.filter((item) => item.id !== selected.id)
      setItems(next)
      setSelectedId(next[0]?.id || '')
      clearDirty(selected.id)
      setShowEditor(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar la comparación.')
    }
  }

  function addCompetitor() {
    updateSelected((current) => ({
      ...current,
      competitors: [...current.competitors, emptyCompetitor(current.competitors.length)],
    }))
  }

  function updateCompetitor(id: string, field: 'name' | 'url', value: string) {
    updateSelected((current) => ({
      ...current,
      competitors: current.competitors.map((comp) =>
        comp.id === id ? { ...comp, [field]: value } : comp,
      ),
    }))
  }

  function updateCompetitorManual(id: string, field: keyof ManualOverride, value: string) {
    updateSelected((current) => ({
      ...current,
      competitors: current.competitors.map((comp) =>
        comp.id === id
          ? { ...comp, manualOverride: { ...hydrateManual(comp.manualOverride), [field]: value } }
          : comp,
      ),
    }))
  }

  function removeCompetitor(id: string) {
    updateSelected((current) => {
      const next = current.competitors
        .filter((comp) => comp.id !== id)
        .map((comp, index) => ({ ...comp, position: index }))

      return { ...current, competitors: next.length ? next : [emptyCompetitor(0)] }
    })
  }

  async function enqueueRun() {
    if (!selected) return

    setLoadingCompare(true)
    setError(null)

    try {
      if (dirty) {
        await saveComparison()
      }

      const competitors = selected.competitors
        .map((item) => ({
          name: item.name.trim() || 'Competidor',
          url: item.url.trim(),
          manualOverride: item.manualOverride,
        }))
        .filter((item) => item.url)

      if (!selected.myUrl.trim()) throw new Error('Ingresa el MLA de tu publicacion.')
      if (!competitors.length) throw new Error('Agrega al menos un competidor con URL.')

      const queueRes = await fetch(`/api/comparisons/${selected.id}/enqueue`, {
        method: 'POST',
      })

      if (queueRes.status === 401) {
        setLoggedIn(false)
        return
      }

      const queueJson = await readApiPayload(queueRes)
      if (!queueRes.ok) throw new Error(queueJson.error || 'No se pudo actualizar la comparacion.')

      await loadComparisons(selected.id)
      await loadRuns(selected.id)
      return

    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la comparacion.')
    } finally {
      setLoadingCompare(false)
    }
  }

  async function handleExport() {
    if (!selected?.lastResult) return

    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comparisonName: selected.name, rows: selected.lastResult.rows }),
      })

      if (res.status === 401) {
        setLoggedIn(false)
        return
      }

      if (!res.ok) {
        const json = await readApiPayload(res)
        throw new Error(json?.error || 'No se pudo exportar.')
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${selected.name || 'comparacion-ml'}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo exportar.')
    }
  }

  const rows = selected?.lastResult?.rows || []
  const dirty = !!selected && dirtyIds.includes(selected.id)
  const historyCurrency =
    historyChart?.series.find((series) => series.role === 'mine')?.currency ||
    historyChart?.series[0]?.currency ||
    selected?.lastResult?.rows.find((row) => row.currency)?.currency ||
    'ARS'

  if (checkingSession) {
    return (
      <main className="auth-screen">
        <section className="card auth-card">
          <div className="eyebrow">
            <Loader2 size={16} className="spin" />
            Verificando acceso
          </div>
          <h1>Comparador ML</h1>
          <p className="auth-copy">Estamos revisando tu sesión para entrar al panel.</p>
        </section>
      </main>
    )
  }

  if (!loggedIn) {
    return (
      <main className="auth-screen">
        <section className="card auth-card">
          <div className="eyebrow">
            <LockKeyhole size={16} />
            Acceso privado
          </div>
          <h1>Comparador ML</h1>
          <p className="auth-copy">
            Ingresá con tu usuario y contraseña para ver, editar y guardar comparaciones.
          </p>

          {error ? <div className="error-box auth-error">{error}</div> : null}

          <form className="auth-form" onSubmit={handleLogin}>
            <div>
              <label className="label">Usuario</label>
              <input className="input" value={loginUser} onChange={(e) => setLoginUser(e.target.value)} />
            </div>

            <div>
              <label className="label">Contraseña</label>
              <input
                className="input"
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
              />
            </div>

            <button className="button primary auth-submit" type="submit" disabled={loginLoading}>
              {loginLoading ? (
                <>
                  <Loader2 size={16} className="spin" />
                  Entrando...
                </>
              ) : (
                <>
                  <LockKeyhole size={16} />
                  Ingresar
                </>
              )}
            </button>
          </form>
        </section>
      </main>
    )
  }

  return (
    <>
      <main className="app-shell">
        <aside className="card sidebar">
          <div className="sidebar-top">
            <div>
              <div className="eyebrow">
                <FolderKanban size={16} />
                Comparaciones
              </div>
              <h1>Comparador ML</h1>
            </div>

            <button className="button primary" onClick={createComparison}>
              <Plus size={16} />
              Nueva
            </button>
          </div>

          <div className="filter-row">
            <Tag size={16} />
            <select className="select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>

          <div className="saved-list">
            {loadingInitial ? (
              <div className="empty-state sidebar-empty">
                <Loader2 size={18} className="spin" />
                Cargando comparaciones...
              </div>
            ) : visibleItems.length ? (
              visibleItems.map((item) => (
                <button
                  key={item.id}
                  className={`saved-item ${item.id === selectedId ? 'active' : ''}`}
                  onClick={() => setSelectedId(item.id)}
                >
                  <div className="saved-head">
                    <span className="saved-category">{item.category || 'Sin categoría'}</span>
                    <ChevronRight size={16} />
                  </div>

                  <div className="saved-title">{item.name}</div>

                  <div className="saved-meta">
                    {item.competitors.length} competidor{item.competitors.length === 1 ? '' : 'es'} · {prettyDate(item.updatedAt)}
                  </div>

                  <div className={`sync-badge ${syncClass(item.syncStatus)}`}>
                    {syncLabel(item.syncStatus)}
                    {item.lastSyncedAt ? ` · ${prettyDate(item.lastSyncedAt)}` : ''}
                  </div>
                </button>
              ))
            ) : (
              <div className="empty-state sidebar-empty">
                No hay comparaciones guardadas en esta categoría.
              </div>
            )}
          </div>
        </aside>

        <div className="content-stack">
          <section className="card toolbar-card">
            <div className="main-toolbar">
              <div className="toolbar-title-block">
                <div className="eyebrow">
                  <PencilLine size={16} />
                  Panel
                </div>
                <h2>{selected ? selected.name : 'Seleccioná una comparación'}</h2>
                <div className="toolbar-subtitle">
                  {selected
                    ? `${selected.category || 'Sin categoría'} · ${selected.competitors.length} competidor${selected.competitors.length === 1 ? '' : 'es'}`
                    : 'Elegí una comparación o creá una nueva'}
                </div>

                {selected ? (
                  <>
                    <div className={`sync-badge ${syncClass(selected.syncStatus)}`} style={{ marginTop: 8 }}>
                      {syncLabel(selected.syncStatus)}
                      {selected.lastSyncedAt ? ` · ${prettyDate(selected.lastSyncedAt)}` : ''}
                    </div>
                    <div className="toolbar-note">
                      La web hace todo: guardas aca, actualizas aca y el resultado queda publicado al terminar.
                    </div>
                  </>
                ) : null}
              </div>

              <div className="toolbar-actions">
                {selected ? (
                  <>
                    <button className={`button ghost ${showEditor ? 'is-active' : ''}`} onClick={() => setShowEditor((v) => !v)}>
                      <PencilLine size={16} />
                      {showEditor ? 'Cerrar editor' : 'Editar'}
                    </button>

                    <button
                      className="button primary"
                      onClick={enqueueRun}
                      disabled={loadingCompare || selected.syncStatus === 'running'}
                    >
                      {loadingCompare ? (
                        <>
                          <Loader2 size={16} className="spin" />
                          Actualizando...
                        </>
                      ) : (
                        <>
                          <RefreshCw size={16} />
                          Actualizar ahora
                        </>
                      )}
                    </button>


                    <button className="button ghost" onClick={() => saveComparison()} disabled={!dirty || saving}>
                      {saving ? (
                        <>
                          <Loader2 size={16} className="spin" />
                          Guardando...
                        </>
                      ) : (
                        <>
                          <Save size={16} />
                          Guardar
                        </>
                      )}
                    </button>

                    <button className="button ghost" onClick={handleExport} disabled={!selected.lastResult}>
                      <Download size={16} />
                      Excel
                    </button>

                    <button className="button ghost" onClick={duplicateComparison}>
                      <Copy size={16} />
                      Duplicar
                    </button>

                    <button className="button ghost danger" onClick={deleteComparison}>
                      <Trash2 size={16} />
                      Borrar
                    </button>
                  </>
                ) : null}

                <button className="button ghost" onClick={handleLogout}>
                  <LogOut size={16} />
                  Salir
                </button>
              </div>
            </div>
          </section>

          {error ? <div className="error-box">{error}</div> : null}
          {selected?.syncError ? (
            <div className={selected.syncStatus === 'ok' ? 'notice-box' : 'error-box'}>
              {selected.syncError}
            </div>
          ) : null}

          {!selected ? (
            <section className="card empty-state large">
              <FolderKanban size={22} />
              Elegí una comparación de la izquierda o creá una nueva.
            </section>
          ) : (
            <div className={`main-grid ${showEditor ? '' : 'single'}`}>
              {showEditor ? (
                <section className="card editor-card">
                  <div className="main-toolbar">
                    <div>
                      <div className="eyebrow">
                        <PencilLine size={16} />
                        Editor
                      </div>
                      <h2>Editar comparación</h2>
                    </div>
                  </div>

                  <div className="editor-content">
                    <div className="form-grid">
                      <div>
                        <label className="label">Nombre de la comparación</label>
                        <input
                          className="input"
                          value={selected.name}
                          onChange={(e) => updateSelected((current) => ({ ...current, name: e.target.value }))}
                        />
                      </div>

                      <div>
                        <label className="label">Categoría</label>
                        <input
                          className="input"
                          value={selected.category}
                          onChange={(e) => updateSelected((current) => ({ ...current, category: e.target.value }))}
                        />
                      </div>

                      <div>
                        <label className="label">Nombre de mi publicación</label>
                        <input
                          className="input"
                          value={selected.myName}
                          onChange={(e) => updateSelected((current) => ({ ...current, myName: e.target.value }))}
                        />
                      </div>

                      <div>
                        <label className="label">MLA de mi publicación</label>
                        <div className="mla-input-wrap">
                          <span className="mla-prefix">MLA</span>
                          <input
                            className="input mla-input"
                            inputMode="numeric"
                            placeholder="901965859"
                            value={mlaDigits(selected.myUrl)}
                            onChange={(e) =>
                              updateSelected((current) => ({
                                ...current,
                                myUrl: normalizeMlaInput(e.target.value),
                              }))
                            }
                          />
                        </div>
                      </div>
                    </div>


                    {dirty ? <div className="status-chip">Tenés cambios sin guardar</div> : null}

                    <div className="panel-block">
                      <div className="panel-header">
                        <div>
                          <div className="eyebrow">Competencia</div>
                          <h3>Competidores</h3>
                        </div>

                        <button className="button subtle" onClick={addCompetitor}>
                          <Plus size={16} />
                          Agregar competidor
                        </button>
                      </div>

                      <div className="competitor-list">
                        {selected.competitors.map((competitor, index) => (
                          <div key={competitor.id} className="competitor-card">
                            <div className="competitor-card-head">
                              <div className="competitor-index">Competidor {index + 1}</div>

                              <button className="icon-button subtle" onClick={() => removeCompetitor(competitor.id)}>
                                <X size={16} />
                              </button>
                            </div>

                            <div className="form-grid">
                              <div>
                                <label className="label">Nombre</label>
                                <input
                                  className="input"
                                  value={competitor.name}
                                  onChange={(e) => updateCompetitor(competitor.id, 'name', e.target.value)}
                                />
                              </div>

                              <div>
                                <label className="label">URL</label>
                                <input
                                  className="input"
                                  value={competitor.url}
                                  onChange={(e) => updateCompetitor(competitor.id, 'url', e.target.value)}
                                />
                              </div>
                            </div>

                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}

              <section className="card results-card">
                <div className="main-toolbar">
                  <div>
                    <div className="eyebrow">
                      <RefreshCw size={16} />
                      Resultado
                    </div>
                    <h2>{selected.lastResult ? 'Comparación lista' : 'Todavía no comparaste'}</h2>
                  </div>
                </div>

                <div className="runs-panel">
                  <div className="runs-panel-head">
                    <div>
                      <div className="eyebrow">
                        <TrendingUp size={16} />
                        Evolución
                      </div>
                      <h3>Historial de precios</h3>
                      <p className="runs-panel-copy">
                        Cada punto representa una lectura guardada para esta comparación.
                      </p>
                    </div>
                    {loadingRuns ? (
                      <div className="runs-loading">
                        <Loader2 size={14} className="spin" />
                        Cargando historial
                      </div>
                    ) : null}
                  </div>

                  {historyChart ? (
                    <div className="history-chart-shell">
                      <div className="history-chart-card">
                        <svg
                          className="history-chart"
                          viewBox="0 0 860 320"
                          role="img"
                          aria-label={`Gráfico del historial de precios de ${selected.name}`}
                        >
                          {(() => {
                            const width = 860
                            const height = 320
                            const left = 72
                            const right = 22
                            const top = 16
                            const bottom = 44
                            const plotWidth = width - left - right
                            const plotHeight = height - top - bottom
                            const lastIndex = Math.max(historyChart.snapshots.length - 1, 1)
                            const xFor = (index: number) => left + (plotWidth * index) / lastIndex
                            const yFor = (value: number) =>
                              top +
                              ((historyChart.maxPrice - value) / (historyChart.maxPrice - historyChart.minPrice || 1)) *
                                plotHeight

                            return (
                              <>
                                {historyChart.ticks.map((tick) => {
                                  const y = yFor(tick)
                                  return (
                                    <g key={tick}>
                                      <line x1={left} y1={y} x2={width - right} y2={y} className="history-grid-line" />
                                      <text x={12} y={y + 4} className="history-axis-label">
                                        {axisMoney(tick, historyCurrency)}
                                      </text>
                                    </g>
                                  )
                                })}

                                {historyChart.snapshots.map((snapshot, index) => (
                                  <text
                                    key={snapshot.key}
                                    x={xFor(index)}
                                    y={height - 14}
                                    textAnchor={
                                      index === 0
                                        ? 'start'
                                        : index === historyChart.snapshots.length - 1
                                          ? 'end'
                                          : 'middle'
                                    }
                                    className="history-axis-label x"
                                  >
                                    {snapshot.label}
                                  </text>
                                ))}

                                {historyChart.series.map((series) => (
                                  <g key={series.key}>
                                    <path
                                      d={svgLinePath(series.values, xFor, yFor)}
                                      fill="none"
                                      stroke={series.color}
                                      strokeWidth="3.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                    {series.values.map((value, index) =>
                                      value === null ? null : (
                                        <circle
                                          key={`${series.key}-${index}`}
                                          cx={xFor(index)}
                                          cy={yFor(value)}
                                          r="4.5"
                                          fill={series.color}
                                          className="history-point"
                                        />
                                      ),
                                    )}
                                  </g>
                                ))}
                              </>
                            )
                          })()}
                        </svg>
                      </div>

                      <div className="history-legend">
                        {historyChart.series.map((series) => (
                          <div key={series.key} className={`history-legend-item ${series.role === 'mine' ? 'is-mine' : ''}`}>
                            <span className="history-legend-swatch" style={{ backgroundColor: series.color }} />
                            <div className="history-legend-copy">
                              <div className="history-legend-name">{series.label}</div>
                              <div className="history-legend-price">
                                {series.latestPrice !== null ? money(series.latestPrice, series.currency) : '—'}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="empty-state runs-empty">
                      Hacé una actualización más para empezar a ver la evolución de precios.
                    </div>
                  )}
                </div>

                {selected.lastResult ? (
                  <>
                    <div className="stats-grid">
                      <div className="stat-card">
                        <div className="stat-label">Mi precio</div>
                        <div className="stat-value">
                          {money(selected.lastResult.summary.minePrice, selected.lastResult.rows[0]?.currency)}
                        </div>
                      </div>

                      <div className="stat-card">
                        <div className="stat-label">Filas</div>
                        <div className="stat-value">{selected.lastResult.summary.total}</div>
                      </div>

                      <div className="stat-card">
                        <div className="stat-label">Con datos</div>
                        <div className="stat-value">{selected.lastResult.summary.ok}</div>
                      </div>

                      <div className="stat-card">
                        <div className="stat-label">Fallidas</div>
                        <div className="stat-value">{selected.lastResult.summary.failed}</div>
                      </div>
                    </div>

                    <div className="table-wrap">
                      <table className="results-table">
                        <thead>
                          <tr>
                            <th>Foto</th>
                            <th>Rol</th>
                            <th>Nombre</th>
                            <th>Título</th>
                            <th>MLA</th>
                            <th>Origen</th>
                            <th>Precio</th>
                            <th>Dif.</th>
                            <th>%</th>
                            <th>Estado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row, index) => (
                            <tr key={`${row.role}-${row.itemId || index}`} className={row.role === 'mine' ? 'row-mine' : undefined}>
                              <td>
                                {row.imageUrl ? (
                                  <button
                                    className="thumb-button"
                                    onClick={() => setPreviewImage({ src: row.imageUrl!, title: row.title || row.name })}
                                  >
                                    <img className="thumb" src={row.imageUrl} alt={row.title || row.name} />
                                  </button>
                                ) : (
                                  <div className="thumb placeholder">
                                    <ImageIcon size={18} />
                                  </div>
                                )}
                              </td>

                              <td>
                                <span className={`pill ${row.role === 'mine' ? 'pill-mine' : 'pill-comp'}`}>{row.role === 'mine' ? 'Mío' : 'Comp'}</span>
                              </td>

                              <td>{row.name}</td>

                              <td className="title-cell">
                                <div>{row.title || '—'}</div>
                                <a className="link-inline" href={row.url} target="_blank" rel="noreferrer">
                                  Abrir publicación
                                  <ExternalLink size={14} />
                                </a>
                              </td>

                              <td>{row.itemId || '—'}</td>

                              <td>{row.sourceKind || row.source.toUpperCase()}</td>

                              <td>{money(row.price, row.currency)}</td>

                              <td className={typeof row.diff === 'number' ? (row.diff > 0 ? 'good-text' : row.diff < 0 ? 'bad-text' : '') : ''}>
                                {typeof row.diff === 'number' ? money(row.diff, row.currency) : '—'}
                              </td>

                              <td className={typeof row.pct === 'number' ? (row.pct > 0 ? 'good-text' : row.pct < 0 ? 'bad-text' : '') : ''}>
                                {typeof row.pct === 'number' ? percent(row.pct) : '—'}
                              </td>

                              <td className="error-cell">{row.error || (row.title || row.price !== null ? 'OK' : 'Sin datos')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="results-mobile-list">
                      {rows.map((row, index) => (
                        <article key={`mobile-${row.role}-${row.itemId || index}`} className={`mobile-result-card ${row.role === 'mine' ? 'is-mine' : ''}`}>
                          <div className="mobile-result-top">
                            <div className="mobile-result-media">
                              {row.imageUrl ? (
                                <button
                                  className="thumb-button"
                                  onClick={() => setPreviewImage({ src: row.imageUrl!, title: row.title || row.name })}
                                >
                                  <img className="thumb" src={row.imageUrl} alt={row.title || row.name} />
                                </button>
                              ) : (
                                <div className="thumb placeholder">
                                  <ImageIcon size={18} />
                                </div>
                              )}
                            </div>

                            <div className="mobile-result-main">
                              <div className="mobile-result-head">
                                <span className={`pill ${row.role === 'mine' ? 'pill-mine' : 'pill-comp'}`}>{row.role === 'mine' ? 'Mío' : 'Comp'}</span>
                                <span className="mobile-result-source">{row.sourceKind || row.source.toUpperCase()}</span>
                              </div>

                              <div className="mobile-result-name">{row.name}</div>
                              <div className="mobile-result-title">{row.title || '—'}</div>
                            </div>
                          </div>

                          <div className="mobile-metrics">
                            <div className="mobile-metric">
                              <span className="mobile-metric-label">Precio</span>
                              <strong>{money(row.price, row.currency)}</strong>
                            </div>

                            <div className={`mobile-metric ${typeof row.diff === 'number' ? (row.diff > 0 ? 'good-text' : row.diff < 0 ? 'bad-text' : '') : ''}`}>
                              <span className="mobile-metric-label">Dif.</span>
                              <strong>{typeof row.diff === 'number' ? money(row.diff, row.currency) : '—'}</strong>
                            </div>

                            <div className={`mobile-metric ${typeof row.pct === 'number' ? (row.pct > 0 ? 'good-text' : row.pct < 0 ? 'bad-text' : '') : ''}`}>
                              <span className="mobile-metric-label">%</span>
                              <strong>{typeof row.pct === 'number' ? percent(row.pct) : '—'}</strong>
                            </div>
                          </div>

                          <div className="mobile-meta-grid">
                            <div>
                              <span className="mobile-metric-label">MLA</span>
                              <div className="mobile-meta-value">{row.itemId || '—'}</div>
                            </div>
                            <div>
                              <span className="mobile-metric-label">Estado</span>
                              <div className="mobile-meta-value">{row.error || (row.title || row.price !== null ? 'OK' : 'Sin datos')}</div>
                            </div>
                          </div>

                          <a className="mobile-open-link" href={row.url} target="_blank" rel="noreferrer">
                            Abrir publicación
                            <ExternalLink size={14} />
                          </a>
                        </article>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="empty-state large">
                    <RefreshCw size={20} />
                    Guarda los cambios o toca Actualizar ahora para correr la comparacion desde la web.
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </main>

      {previewImage ? (
        <div className="image-modal" onClick={() => setPreviewImage(null)}>
          <div className="image-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="image-modal-head">
              <div className="image-modal-title">{previewImage.title}</div>
              <button className="icon-button" onClick={() => setPreviewImage(null)}>
                <X size={18} />
              </button>
            </div>
            <img className="preview-image" src={previewImage.src} alt={previewImage.title} />
          </div>
        </div>
      ) : null}
    </>
  )
}
