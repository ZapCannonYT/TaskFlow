export type MotionPref = 'full' | 'reduced' | 'system'

const KEY = 'taskflow:motion'

export function getMotionPref(): MotionPref {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'full' || saved === 'reduced' || saved === 'system') return saved
  } catch { /* storage is optional */ }
  // Windows "Animation effects" off makes Chromium report reduced motion on many laptops; default to full.
  return 'full'
}

export function applyMotion(pref: MotionPref = getMotionPref()) {
  document.documentElement.dataset.motion = pref
}

export function setMotionPref(pref: MotionPref) {
  try { localStorage.setItem(KEY, pref) } catch { /* storage is optional */ }
  applyMotion(pref)
}

export function prefersReducedMotion() {
  const pref = getMotionPref()
  if (pref === 'system') return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  return pref === 'reduced'
}

/** Multiplier for feedback animation durations, from the `--m` CSS variable (2 on laptops). */
export function motionScale() {
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--m'))
  return Number.isFinite(value) && value > 0 ? value : 1
}
