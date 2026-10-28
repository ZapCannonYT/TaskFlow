import { useState } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TimePicker } from './TimePicker'

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return <><TimePicker value={value} onChange={setValue}/><output data-testid="value">{value}</output></>
}

const option = (wheel: string, name: string) => within(screen.getByRole('listbox', { name: wheel })).getByRole('option', { name })

describe('TimePicker', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('shows times in 12-hour form with AM or PM on laptops', () => {
    render(<Harness initial="17:30"/>)
    expect(screen.getByRole('button', { name: 'Time, 5:30 PM' })).toHaveTextContent('5:30 PM')
  })

  it('sets hour, minute and AM or PM from the wheels', async () => {
    const user = userEvent.setup()
    render(<Harness initial="17:30"/>)
    await user.click(screen.getByRole('button', { name: /Time/ }))
    await user.click(option('Hour', '9'))
    expect(screen.getByTestId('value')).toHaveTextContent('21:30')
    await user.click(option('AM or PM', 'AM'))
    expect(screen.getByTestId('value')).toHaveTextContent('09:30')
    await user.click(option('Minute', '45'))
    expect(screen.getByTestId('value')).toHaveTextContent('09:45')
  })

  it('treats 12 PM as noon and clears the time', async () => {
    const user = userEvent.setup()
    render(<Harness initial="09:00"/>)
    await user.click(screen.getByRole('button', { name: /Time/ }))
    await user.click(option('Hour', '12'))
    await user.click(option('AM or PM', 'PM'))
    expect(screen.getByTestId('value')).toHaveTextContent('12:00')
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByTestId('value')).toHaveTextContent('')
  })

  it('uses the browser time box on touch screens', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('(pointer: coarse)'), media: query, addEventListener() {}, removeEventListener() {} }))
    render(<Harness initial="17:30"/>)
    expect(screen.getByLabelText('Time')).toHaveAttribute('type', 'time')
    expect(screen.queryByRole('button', { name: /Time/ })).not.toBeInTheDocument()
  })
})
