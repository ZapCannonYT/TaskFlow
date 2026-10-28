import { describe, expect, it } from 'vitest'
import { passwordProblem } from './password'

describe('passwordProblem', () => {
  it('accepts a password with letters and numbers of at least 8 characters', () => {
    expect(passwordProblem('river42stone')).toBeNull()
  })
  it('rejects short passwords', () => {
    expect(passwordProblem('ab12')).toMatch(/8 characters/)
  })
  it('needs both a letter and a number', () => {
    expect(passwordProblem('onlyletters')).toMatch(/letter and one number/)
    expect(passwordProblem('1234567890')).toMatch(/letter and one number/)
  })
  it('rejects passwords containing the email name', () => {
    expect(passwordProblem('alex2026!', 'alex@example.com')).toMatch(/email name/)
  })
  it('rejects common patterns', () => {
    expect(passwordProblem('password1')).toMatch(/harder to guess/)
  })
})
