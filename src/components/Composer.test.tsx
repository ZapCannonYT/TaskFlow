import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Composer, type ComposerProps } from './Composer'
import { TaskRow } from './TaskRow'
import type { Task } from '../lib/supabase'

const mockVoice = vi.hoisted(() => vi.fn())
vi.mock('../features/voice/useVoiceCapture', () => ({ useVoiceCapture: (...args: unknown[]) => mockVoice(...args) }))

const baseVoice = () => ({
  state: 'idle', message: '', processing: false, hasTranscript: false, canRetry: false, retry: vi.fn(),
  start: vi.fn(), stop: vi.fn(), cancelTranscription: vi.fn(), reset: vi.fn(),
  meterRef: { current: null }, modelStatus: { state: 'idle', fallbacks: 0 },
})
const props: ComposerProps = { labels: [], isOnline: true, busy: false, onSubmit: vi.fn(async () => true), onCreateLabel: vi.fn(async () => undefined), onRenameLabel: vi.fn(async () => undefined), onDeleteLabel: vi.fn(async () => undefined) }
const task: Task = { id: 'row-1', user_id: 'user-1', title: 'Existing task', status: 'open', due_at: null, due_is_approx: false, is_all_day: false, timezone: 'UTC', size: null, is_important: false, label_id: null, reminder_offset: 'none', created_at: '', updated_at: '', completed_at: null, deleted_at: null }
const rowProps = { task, labels: [], listName: 'Inbox', isOnline: true, expanded: false, isNew: false, isCompleting: false, isSettling: false, settleIndex: 0, onToggleExpand: vi.fn(), onComplete: vi.fn(), onUpdate: vi.fn(), onRemove: vi.fn() }

describe('Composer', () => {
  beforeEach(() => { vi.clearAllMocks(); mockVoice.mockReturnValue(baseVoice()) })
  afterEach(cleanup)

  it('keeps title typing inside the composer without changing row render counts', async () => {
    const user = userEvent.setup()
    render(<><Composer {...props}/><TaskRow {...rowProps}/></>)
    const initialRenderCount = (window as Window & { __rowRenders?: number }).__rowRenders
    await user.type(screen.getByRole('textbox', { name: 'Add a task' }), '1234567890')
    expect((window as Window & { __rowRenders?: number }).__rowRenders).toBe(initialRenderCount)
  })

  it('submits once when Enter is pressed', async () => {
    const user = userEvent.setup()
    render(<Composer {...props}/> )
    const input = screen.getByRole('textbox', { name: 'Add a task' })
    await user.type(input, 'Call the dentist{Enter}')
    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledTimes(1))
    expect(props.onSubmit).toHaveBeenCalledWith('Call the dentist', expect.objectContaining({ due_at: null }))
  })

  it('keeps chips hidden for a whitespace-only title', async () => {
    const user = userEvent.setup()
    render(<Composer {...props}/> )
    await user.type(screen.getByRole('textbox', { name: 'Add a task' }), '   ')
    expect(screen.queryByRole('group', { name: 'When' })).not.toBeInTheDocument()
  })

  it('shows every option in three rows as soon as there is a title', async () => {
    const user = userEvent.setup()
    render(<Composer {...props}/> )
    await user.type(screen.getByRole('textbox', { name: 'Add a task' }), 'Plan the trip')
    expect(screen.getByRole('group', { name: 'When' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Details' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Extras' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'When' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Time' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Repeat' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Size' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Label' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reminder, 1 hour before' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Description' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Note' }))
    expect(screen.getByRole('textbox', { name: 'Description' })).toBeInTheDocument()
  })

  it('opens a styled menu, marks the chosen option and closes after a pick', async () => {
    const user = userEvent.setup()
    render(<Composer {...props}/> )
    await user.type(screen.getByRole('textbox', { name: 'Add a task' }), 'Plan the trip')
    await user.click(screen.getByRole('button', { name: 'Size' }))
    expect(screen.getByRole('option', { name: 'Not set' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('option', { name: /^Big/ }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Size, Big' })).toBeInTheDocument()
  })

  it('keeps only one menu open at a time', async () => {
    const user = userEvent.setup()
    render(<Composer {...props}/> )
    await user.type(screen.getByRole('textbox', { name: 'Add a task' }), 'Plan the trip')
    await user.click(screen.getByRole('button', { name: 'Size' }))
    await user.click(screen.getByRole('button', { name: 'Repeat' }))
    expect(screen.getAllByRole('listbox')).toHaveLength(1)
    expect(screen.getByRole('listbox', { name: 'Repeat' })).toBeInTheDocument()
  })

  it('saves a custom reminder in minutes', async () => {
    const user = userEvent.setup()
    render(<Composer {...props}/> )
    const input = screen.getByRole('textbox', { name: 'Add a task' })
    await user.type(input, 'Pay rent')
    await user.click(screen.getByRole('button', { name: 'When' }))
    await user.click(screen.getByRole('option', { name: /^Tomorrow/ }))
    await user.click(screen.getByRole('button', { name: /^Reminder/ }))
    await user.click(screen.getByRole('option', { name: 'Custom…' }))
    const amount = screen.getByRole('spinbutton', { name: 'Reminder amount' })
    await user.clear(amount)
    await user.type(amount, '3')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Reminder unit' }), 'hours')
    await user.type(input, '{Enter}')
    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith('Pay rent', expect.objectContaining({ reminder_offset: 'custom', reminder_minutes: 180 })))
  })

  it('does not autofocus the title field on initial render', () => {
    render(<Composer {...props}/> )
    expect(screen.getByRole('textbox', { name: 'Add a task' })).not.toHaveFocus()
  })

  it('makes the title read-only while voice capture is listening', () => {
    mockVoice.mockReturnValue({ ...baseVoice(), state: 'listening' })
    render(<Composer {...props}/> )
    expect(screen.getByRole('textbox', { name: 'Add a task' })).toHaveAttribute('readonly')
    expect(screen.getByRole('textbox', { name: 'Add a task' })).toHaveAttribute('aria-readonly', 'true')
  })
})
