import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const publicKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined

export const isSupabaseConfigured = Boolean(url && publicKey)
export const supabase = isSupabaseConfigured ? createClient(url!, publicKey!) : null

export type Label = { id: string; user_id: string; name: string; created_at: string }
export type RecurrenceRule = 'daily' | 'weekdays' | 'weekly' | 'monthly'
export type Task = {
  id: string; user_id: string; title: string; status: 'open' | 'completed'
  due_at: string | null; due_is_approx: boolean; is_all_day: boolean; timezone: string
  size: 'quick' | 'hour' | 'big' | null; is_important: boolean; label_id: string | null
  recurrence_rule?: RecurrenceRule | null; recurrence_parent_id?: string | null; recurrence_day?: number | null
  reminder_offset: 'none' | 'at_time' | '1_day_before' | '2_days_before'
  details_prompted_at?: string | null
  created_at: string; updated_at: string; completed_at: string | null; deleted_at: string | null
  labels?: Pick<Label, 'name'> | null
}

export type UserPreferences = {
  user_id: string
  timezone: string
  daily_nudge_enabled: boolean
  daily_nudge_time: string
  quiet_hours_start: string
  quiet_hours_end: string
  weekly_summary_enabled: boolean
  weekly_summary_day: number
  prompt_dismissals: number
  prompt_reoffer_at: string | null
  skipped_until: string | null
}

export type PushSubscriptionRow = {
  id: string
  endpoint: string
  disabled_at: string | null
  created_at: string
}
