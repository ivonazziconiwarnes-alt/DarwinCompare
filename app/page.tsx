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
  Trash2,
  X,
} from 'lucide-react'
import type { CompareResponse, CompetitorInput, ManualOverride, SavedComparison } from '@/lib/types'

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

function syncLabel(status: 'pending' | 'ok' | 'error') {
  if (status === 'ok') return 'Actualizada'
  if (status === 'error') return 'Error'
  return 'Pendiente'
}

function syncClass(status: 'pending' | 'ok' | 'error') {
  if (status === 'ok') return 'sync-ok'
  if (status === 'error') return 'sync-error'
  return 'sync-pending'
}

export default function HomePage() {
  const [items, setItems] = useState<SavedComparison[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [categoryFilter, setCategoryFilter] = useState<string>('Todas')
  const [loadingInitial, setLoadingInitial] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadingCompare, setLoadingCompare] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [loggedIn, setLoggedIn] = useState(false)
  const [loginLoading, setLoginLoading] = useState(false)
  const [showEditor, setShowEditor] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewImage, setPreviewImage] = useState<{ src: string; title: string } | null>(null)
  const [dirtyIds, setDirtyIds] = useState<string[]>([])
  const [loginUser, setLoginUser] = useState('Darwin')
  const [loginPassword, setLoginPassword] = useState('Warnes1102')

  const selected = useMemo(() => items.find((item) => item.id === selectedId) || null, [items, selectedId])

  async function checkSession() {
    setCheckingSession(true)
    try {
      const res = await fetch('/api/auth/session', { cache: 'no-store' })
      const json = await res.json()
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

      const json = await res.json()
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

  useEffect(() => {
    checkSession()
  }, [])

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

      const json = await res.json()
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

      const json = await res.json()
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

      const json = await res.json()
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

      const json = await res.json()
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

      const json = await res.json().catch(() => ({}))
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

  async function handleCompare() {
    if (!selected) return

    setLoadingCompare(true)
    setError(null)

    try {
      const competitors = selected.competitors
        .map((item) => ({
          name: item.name.trim() || 'Competidor',
          url: item.url.trim(),
          manualOverride: item.manualOverride,
        }))
        .filter((item) => item.url)

      if (!selected.myUrl.trim()) throw new Error('Pegá la URL de tu publicación.')
      if (!competitors.length) throw new Error('Agregá al menos un competidor con URL.')

      const res = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comparisonName: selected.name,
          myName: selected.myName,
          myUrl: selected.myUrl,
          myManual: selected.myManual,
          competitors,
        }),
      })

      if (res.status === 401) {
        setLoggedIn(false)
        return
      }

      const json = (await res.json()) as CompareResponse
      if (!res.ok) throw new Error(json.error || 'No se pudo comparar.')

      const nextSelected = hydrateComparison({
        ...selected,
        lastResult: json,
        updatedAt: new Date().toISOString(),
        syncStatus: 'ok',
        lastSyncedAt: new Date().toISOString(),
        syncError: null,
      })

      setItems((prev) => prev.map((item) => (item.id === selected.id ? nextSelected : item)))
      await saveComparison(nextSelected)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo comparar.')
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
        const json = await res.json().catch(() => null)
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

  if (checkingSession) {
    return (
      <main className="auth-screen">
        <section className="card auth-card">
          <div className="eyebrow">
            <Loader2 size={16} className="spin" />
            Verificando acceso
          </div>
          <h1>Comparador ML Pro</h1>
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
          <h1>Comparador ML Pro</h1>
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
              <h1>Comparador ML Pro</h1>
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
                  <div className={`sync-badge ${syncClass(selected.syncStatus)}`} style={{ marginTop: 8 }}>
                    {syncLabel(selected.syncStatus)}
                    {selected.lastSyncedAt ? ` · ${prettyDate(selected.lastSyncedAt)}` : ''}
                  </div>
                ) : null}
              </div>

              <div className="toolbar-actions">
                {selected ? (
                  <>
                    <button className={`button ghost ${showEditor ? 'is-active' : ''}`} onClick={() => setShowEditor((v) => !v)}>
                      <PencilLine size={16} />
                      {showEditor ? 'Cerrar editor' : 'Editar'}
                    </button>

                    <button className="button subtle" onClick={handleCompare} disabled={loadingCompare}>
                      {loadingCompare ? (
                        <>
                          <Loader2 size={16} className="spin" />
                          Comparando...
                        </>
                      ) : (
                        <>
                          <RefreshCw size={16} />
                          Comparar
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
          {selected?.syncError ? <div className="error-box">{selected.syncError}</div> : null}

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
                        <label className="label">URL de mi publicación</label>
                        <input
                          className="input"
                          value={selected.myUrl}
                          onChange={(e) => updateSelected((current) => ({ ...current, myUrl: e.target.value }))}
                        />
                      </div>
                    </div>

                    <div className="panel-block">
                      <div className="panel-header">
                        <div>
                          <div className="eyebrow">Respaldo manual</div>
                          <h3>Mi publicación</h3>
                        </div>
                      </div>

                      <div className="form-grid">
                        <div>
                          <label className="label">Título manual</label>
                          <input
                            className="input"
                            value={selected.myManual.title}
                            onChange={(e) =>
                              updateSelected((current) => ({
                                ...current,
                                myManual: { ...hydrateManual(current.myManual), title: e.target.value },
                              }))
                            }
                          />
                        </div>

                        <div>
                          <label className="label">Precio manual</label>
                          <input
                            className="input"
                            value={selected.myManual.price}
                            onChange={(e) =>
                              updateSelected((current) => ({
                                ...current,
                                myManual: { ...hydrateManual(current.myManual), price: e.target.value },
                              }))
                            }
                          />
                        </div>

                        <div>
                          <label className="label">MLA manual</label>
                          <input
                            className="input"
                            value={selected.myManual.itemId}
                            onChange={(e) =>
                              updateSelected((current) => ({
                                ...current,
                                myManual: { ...hydrateManual(current.myManual), itemId: e.target.value },
                              }))
                            }
                          />
                        </div>

                        <div>
                          <label className="label">URL imagen manual</label>
                          <input
                            className="input"
                            value={selected.myManual.imageUrl}
                            onChange={(e) =>
                              updateSelected((current) => ({
                                ...current,
                                myManual: { ...hydrateManual(current.myManual), imageUrl: e.target.value },
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

                            <div className="panel-block" style={{ marginTop: 14 }}>
                              <div className="panel-header">
                                <div>
                                  <div className="eyebrow">Respaldo manual</div>
                                  <h3 style={{ marginTop: 4 }}>Datos opcionales</h3>
                                </div>
                              </div>

                              <div className="form-grid">
                                <div>
                                  <label className="label">Título manual</label>
                                  <input
                                    className="input"
                                    value={competitor.manualOverride.title}
                                    onChange={(e) => updateCompetitorManual(competitor.id, 'title', e.target.value)}
                                  />
                                </div>

                                <div>
                                  <label className="label">Precio manual</label>
                                  <input
                                    className="input"
                                    value={competitor.manualOverride.price}
                                    onChange={(e) => updateCompetitorManual(competitor.id, 'price', e.target.value)}
                                  />
                                </div>

                                <div>
                                  <label className="label">MLA manual</label>
                                  <input
                                    className="input"
                                    value={competitor.manualOverride.itemId}
                                    onChange={(e) => updateCompetitorManual(competitor.id, 'itemId', e.target.value)}
                                  />
                                </div>

                                <div>
                                  <label className="label">URL imagen manual</label>
                                  <input
                                    className="input"
                                    value={competitor.manualOverride.imageUrl}
                                    onChange={(e) => updateCompetitorManual(competitor.id, 'imageUrl', e.target.value)}
                                  />
                                </div>
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
                            <tr key={`${row.role}-${row.itemId || index}`}>
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
                                <span className="pill">{row.role === 'mine' ? 'Mío' : 'Comp'}</span>
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

                              <td>{row.source.toUpperCase()}</td>

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
                  </>
                ) : (
                  <div className="empty-state large">
                    <RefreshCw size={20} />
                    Cargá URLs y tocá <strong>Comparar</strong> para ver resultados.
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