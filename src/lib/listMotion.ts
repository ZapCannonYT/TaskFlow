import type { AutoAnimationPlugin } from '@formkit/auto-animate'
import { motionScale, prefersReducedMotion } from './motion'

const EASE = 'cubic-bezier(.2,.8,.2,1)'

/**
 * Rows that change place glide there (a FLIP move), for example a task moving to its new spot after Done,
 * and a row leaving the list fades out quickly. New rows appear at once: their own CSS already animates them.
 */
export const moveOnly: AutoAnimationPlugin = (el, action, newCoords, oldCoords) => {
  const reduced = prefersReducedMotion()
  if (action === 'remove') {
    return new KeyframeEffect(el, [{ opacity: 1 }, { opacity: 0 }], { duration: reduced ? 0 : Math.round(120 * motionScale()), easing: 'ease-out' })
  }
  const dx = action === 'remain' && newCoords && oldCoords ? oldCoords.left - newCoords.left : 0
  const dy = action === 'remain' && newCoords && oldCoords ? oldCoords.top - newCoords.top : 0
  if (reduced || (!dx && !dy)) return new KeyframeEffect(el, [], { duration: 0 })
  return new KeyframeEffect(el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], {
    duration: Math.round(200 * motionScale()),
    easing: EASE,
  })
}
