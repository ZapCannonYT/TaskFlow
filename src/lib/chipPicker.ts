/**
 * A chip wraps a native select or time input in a label with an icon and padding. A click there only focuses the
 * control, so the menu seemed to ignore clicks near the chip's edges. This opens the control's picker instead.
 */
export function installChipPickerClicks() {
  document.addEventListener('click', event => {
    const target = event.target as HTMLElement | null
    if (!target || target.closest('select, input, button')) return
    const chip = target.closest('label.select-chip')
    const control = chip?.querySelector<HTMLSelectElement | HTMLInputElement>('select, input[type="time"]')
    if (!control || control.disabled) return
    event.preventDefault()
    control.focus()
    try { control.showPicker() } catch { /* older browsers: focusing the control is the fallback */ }
  })
}
