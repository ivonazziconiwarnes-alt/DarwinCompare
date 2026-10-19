import { readComparisonWithCompetitors } from '@/lib/comparison-store'

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
  const snapshot = await readComparisonWithCompetitors(supabase, comparisonId)
  const { data, error } = await supabase.rpc('enqueue_comparison_run', {
    p_id: comparisonId, p_by: requestedBy, p_source: triggerSource, p_snapshot: snapshot,
  })
  if (error) throw error
  const run = Array.isArray(data) ? data[0] : data

  const queuedItem = await readComparisonWithCompetitors(supabase, comparisonId)

  return {
    item: queuedItem,
    run: run || null,
    result: queuedItem.lastResult,
    status: 'queued' as const,
  }
}
