import { describe, expect, it, vi } from 'vitest'
import { installChipPickerClicks } from './chipPicker'

installChipPickerClicks()

function chip() {
  document.body.innerHTML = '<label class="select-chip"><svg></svg><select><option>One</option></select></label>'
  const select = document.querySelector('select')!
  const showPicker = vi.fn()
  Object.defineProperty(select, 'showPicker', { value: showPicker, configurable: true })
  return { label: document.querySelector('label')!, icon: document.querySelector('svg')!, select, showPicker }
}

describe('installChipPickerClicks', () => {
  it('opens the menu when the chip edge or icon is clicked', () => {
    const { label, icon, showPicker } = chip()
    label.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    icon.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(showPicker).toHaveBeenCalledTimes(2)
  })

  it('leaves clicks on the select itself to the browser', () => {
    const { select, showPicker } = chip()
    select.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(showPicker).not.toHaveBeenCalled()
  })

  it('does nothing for a disabled chip', () => {
    const { label, select, showPicker } = chip()
    select.disabled = true
    label.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(showPicker).not.toHaveBeenCalled()
  })
})
