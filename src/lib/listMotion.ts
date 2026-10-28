import type { AutoAnimationPlugin } from '@formkit/auto-animate'
import { motionScale, prefersReducedMotion } from './motion'

const NONE = () => new KeyframeEffect(null, [], { duration: 0 })

/**
 * Rows that change place glide there (a FLIP move), for example a task moving to its new spot after Done.
 * Adding and removing are left to the existing CSS, which already animates new and completed tasks.
 */
export const moveOnly: AutoAnimationPlugin = (el, action, newCoords, oldCoords) => {
  if (action !== 'remain' || !newCoords || !oldCoords || prefersReducedMotion()) return NONE()
  const dx = oldCoords.left - newCoords.left
  const dy = oldCoords.top - newCoords.top
  if (!dx && !dy) return NONE()
  return new KeyframeEffect(el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], {
    duration: Math.round(200 * motionScale()),
    easing: 'cubic-bezier(.2,.8,.2,1)',
  })
}
