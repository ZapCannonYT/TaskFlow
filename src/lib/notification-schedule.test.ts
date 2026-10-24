import { describe, expect, it } from 'vitest'
import { constantTimeEqual, isSupportedPushEndpoint, localDateTime, quietEndAt, safeTimeZone, selectSupabaseKey } from '../../supabase/functions/_shared/companion'

describe('notification scheduling helpers', () => {
  it('converts local reminder time to the correct instant', () => {
    expect(localDateTime('2026-10-22', '18:30:00', 'Asia/Kolkata').toISOString()).toBe('2026-10-22T13:00:00.000Z')
  })

  it('moves notifications to the end of quiet hours across midnight', () => {
    const now = new Date('2026-10-22T18:00:00.000Z') // 11:30 PM in Kolkata
    expect(quietEndAt(now, 'Asia/Kolkata', '22:30:00', '08:00:00')?.toISOString()).toBe('2026-10-23T02:30:00.000Z')
  })

  it('keeps delivery outside quiet hours and falls back for invalid timezones', () => {
    expect(quietEndAt(new Date('2026-10-22T12:00:00.000Z'), 'Asia/Kolkata', '22:30', '08:00')).toBeNull()
    expect(safeTimeZone('not/a-zone')).toBe('UTC')
  })

  it('accepts only HTTPS push endpoints from supported push services', () => {
    expect(isSupportedPushEndpoint('https://fcm.googleapis.com/send/example')).toBe(true)
    expect(isSupportedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/example')).toBe(true)
    expect(isSupportedPushEndpoint('http://127.0.0.1/admin')).toBe(false)
    expect(isSupportedPushEndpoint('https://example.com')).toBe(false)
  })

  it('compares the cron secret without early exit on a differing character', () => {
    expect(constantTimeEqual('abc123', 'abc123')).toBe(true)
    expect(constantTimeEqual('abc123', 'abc124')).toBe(false)
    expect(constantTimeEqual('abc', 'abcd')).toBe(false)
  })

  it('supports both legacy Supabase keys and current named key collections', () => {
    expect(selectSupabaseKey('legacy-key', '{"default":"new-key"}')).toBe('legacy-key')
    expect(selectSupabaseKey(undefined, '{"default":"publishable-key"}')).toBe('publishable-key')
    expect(selectSupabaseKey(undefined, 'not-json')).toBeUndefined()
  })
})
