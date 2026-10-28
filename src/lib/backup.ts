import { Label, supabase, Task, UserPreferences } from './supabase'

/** Downloads every task, label and preference as a JSON file; returns an error message, or '' on success. */
export async function exportBackup(): Promise<string> {
  if (!supabase) return 'Reconnect to export your latest data.'
  const [{ data: userData }, taskResult, labelResult, prefResult] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from('tasks').select('*').order('created_at'),
    supabase.from('labels').select('*').order('name'),
    supabase.from('user_preferences').select('*').maybeSingle(),
  ])
  const failure = taskResult.error || labelResult.error || prefResult.error
  if (failure || !userData.user) return `Export could not be prepared · ${failure?.message ?? 'Sign in again.'}`
  const backup = { format: 'taski-backup', version: 1, exported_at: new Date().toISOString(), user_id: userData.user.id, tasks: taskResult.data ?? [], labels: labelResult.data ?? [], preferences: prefResult.data ?? null }
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `taski-backup-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  return ''
}

/** Upserts a backup file's labels, tasks and preferences for the signed-in user; throws with a readable message. */
export async function restoreBackup(file: File) {
  if (!supabase) return
  const backup = JSON.parse(await file.text()) as { format?: string; version?: number; tasks?: Task[]; labels?: Label[]; preferences?: UserPreferences | null }
  if (backup.format !== 'taski-backup' || backup.version !== 1 || !Array.isArray(backup.tasks) || !Array.isArray(backup.labels)) throw new Error('Choose a Taski JSON backup file.')
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) throw new Error('Sign in again to restore your data.')
  const labelsToRestore = backup.labels.map(({ id, name }) => ({ id, name, user_id: userData.user!.id }))
  const tasksToRestore = backup.tasks.map(task => {
    const { labels: _joined, ...row } = task
    return { ...row, user_id: userData.user!.id }
  })
  if (labelsToRestore.length) { const result = await supabase.from('labels').upsert(labelsToRestore, { onConflict: 'id' }); if (result.error) throw result.error }
  if (tasksToRestore.length) { const result = await supabase.from('tasks').upsert(tasksToRestore, { onConflict: 'id' }); if (result.error) throw result.error }
  if (backup.preferences) { const { user_id: _userId, ...values } = backup.preferences; const result = await supabase.from('user_preferences').update(values).eq('user_id', userData.user.id); if (result.error) throw result.error }
}
