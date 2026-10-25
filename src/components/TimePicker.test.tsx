import { useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { TimePicker } from './TimePicker'

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return <><TimePicker value={value} onChange={setValue}/><output data-testid="value">{value}</output></>
}

describe('TimePicker', () => {
  afterEach(cleanup)

  it('shows times in 12-hour form with AM or PM', () => {
    render(<Harness initial="17:30"/>)
    expect(screen.getByRole('button', { name: 'Time, 5:30 PM' })).toHaveTextContent('5:30 PM')
  })

  it('guesses afternoon for 1 to 7 and morning for 8 to 11 on a first pick', async () => {
    const user = userEvent.setup()
    render(<Harness/>)
    await user.click(screen.getByRole('button', { name: 'Time' }))
    await user.click(screen.getByRole('radio', { name: '3' }))
    expect(screen.getByTestId('value')).toHaveTextContent('15:00')
    await user.click(screen.getByRole('radio', { name: 'AM' }))
    expect(screen.getByTestId('value')).toHaveTextContent('03:00')
    await user.click(screen.getByRole('radio', { name: ':45' }))
    expect(screen.getByTestId('value')).toHaveTextContent('03:45')
  })

  it('treats 12 PM as noon and clears the time', async () => {
    const user = userEvent.setup()
    render(<Harness initial="09:00"/>)
    await user.click(screen.getByRole('button', { name: /Time/ }))
    await user.click(screen.getByRole('radio', { name: '12' }))
    await user.click(screen.getByRole('radio', { name: 'PM' }))
    expect(screen.getByTestId('value')).toHaveTextContent('12:00')
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByTestId('value')).toHaveTextContent('')
  })
})
