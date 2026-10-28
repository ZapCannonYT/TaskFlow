export const MIN_PASSWORD_LENGTH = 8

/** Why a new password is too weak, or null when it is fine. Existing shorter passwords still sign in. */
export function passwordProblem(password: string, email = ''): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  if (!/[a-z]/i.test(password) || !/\d/.test(password)) return 'Use at least one letter and one number.'
  const name = email.split('@')[0]?.toLowerCase()
  if (name && name.length >= 3 && password.toLowerCase().includes(name)) return 'Do not include your email name in the password.'
  if (/^(.)\1+$/.test(password) || /^(password|qwerty|12345678|abc12345)/i.test(password)) return 'Pick something harder to guess.'
  return null
}
