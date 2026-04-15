import { readComparisonWithCompetitors } from '@/lib/comparison-store'

const STALE_RUN_MINUTES = 20

export function queueErrorText(error: unknown) {
  if (error instanceof Error) return error.message

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    return [record.code, record.message, record.details, record.hint].filter(Boolean).join(' ')
  }

  return String(error || 'Error desconocido')
}

export function isMissingColumnError(error: unknown) {
  const text = queueErrorText(error).toLowerCase()
  return (
    text.includes('42703') ||
    text.includes('pgrst204') ||
    (text.includes('column') && text.includes('does not exist')) ||
    (text.includes('could not find the') && text.includes('column'))
  )
}

export async function queueComparisonRun(
  supabase: any,
  comparisonId: string,
  requestedBy: string | null,
  triggerSource = 'web',
) {
  const queuedAt = new Date().toISOString()
  const staleBefore = new Date(Date.now() - STALE_RUN_MINUTES * 60 * 1000).toISOString()

  const { data: existingRuns, error: existingRunError } = await supabase
    .from('comparison_runs')
    .select('id, status, requested_at, started_at')
    .eq('comparison_id', comparisonId)
    .in('status', ['pending', 'running'])
    .order('requested_at', { ascending: false })
    .limit(1)

  if (existingRunError) throw existingRunError
  let existingRun = Array.isArray(existingRuns) ? existingRuns[0] || null : null

  if (existingRun) {
    const startedAt = String(existingRun.started_at || existingRun.requested_at || '')
    const isStale = !!startedAt && startedAt < staleBefore

    if (isStale) {
      const { error: staleRunError } = await supabase
        .from('comparison_runs')
        .update({
          status: 'error',
          error: 'Corrida anterior cerrada automaticamente por estar trabada.',
          worker_id: null,
        })
        .eq('id', existingRun.id)

      if (staleRunError && !isMissingColumnError(staleRunError)) throw staleRunError
      existingRun = null
    }
  }

  if (!existingRun) {
    const snapshot = await readComparisonWithCompetitors(supabase, comparisonId)
    let insertRunError: unknown = null

    const { error: fullInsertError } = await supabase
      .from('comparison_runs')
      .insert({
        comparison_id: comparisonId,
        status: 'pending',
        trigger_source: triggerSource,
        requested_by: requestedBy,
        requested_at: queuedAt,
        comparison_snapshot: snapshot,
      })

    insertRunError = fullInsertError

    if (insertRunError && isMissingColumnError(insertRunError)) {
      const { error: fallbackInsertError } = await supabase
        .from('comparison_runs')
        .insert({
          comparison_id: comparisonId,
          status: 'pending',
          requested_at: queuedAt,
        })

      insertRunError = fallbackInsertError
    }

    if (insertRunError) throw insertRunError
  }

  const { error: queueError } = await supabase
    .from('comparisons')
    .update({
      sync_status: existingRun?.status === 'running' ? 'running' : 'pending',
      sync_error: null,
      updated_at: queuedAt,
    })
    .eq('id', comparisonId)

  if (queueError) throw queueError

  const queuedItem = await readComparisonWithCompetitors(supabase, comparisonId)

  return {
    item: queuedItem,
    run: existingRun || null,
    result: queuedItem.lastResult,
    status: 'queued' as const,
  }
}
