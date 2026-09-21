// @vitest-environment jsdom
import { createRef, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Draft } from './Composer'
import { RoomComposer } from './RoomComposer'

afterEach(cleanup)
const send = vi.fn()
function Example({ closed = false, ready = true, sending = false, initial = 'A room message' }: { closed?: boolean; ready?: boolean; sending?: boolean; initial?: string }) {
  const [draft, setDraft] = useState<Draft>({ text: initial, images: [] })
  return <RoomComposer draft={draft} setDraft={setDraft} send={send} attach={vi.fn()} ready={ready} sending={sending} roomName="#review" closed={closed} inputRef={createRef()} members={['parent', 'Planner', 'Missing']} />
}

describe('room composer', () => {
  it('names the room destination and has no model, effort or permission controls', () => {
    render(<Example />)
    expect(screen.getByText('To #review')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Message #review' }).id).toBe('message-input')
    expect(screen.getByRole('button', { name: 'Mention a member' }).hasAttribute('aria-controls')).toBe(false)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByText(/Thinking effort|Permission mode|Stop generation/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Send to #review' }))
    expect(send).toHaveBeenCalled()
  })

  it.each([{ closed: true }, { ready: false }, { sending: true }])('prevents sends and attachment changes when unavailable: %j', (props) => {
    send.mockClear()
    render(<Example {...props} />)
    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(send).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Send to #review' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Attach images' }).hasAttribute('disabled')).toBe(true)
  })

  it('keeps IME Enter and Shift+Enter local, then submits a plain Enter', () => {
    send.mockClear()
    render(<Example />)
    const input = screen.getByRole('textbox')
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(send).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('inserts an explicit textual mention without sending or privately routing', () => {
    send.mockClear()
    render(<Example initial="Please review " />)
    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    input.setSelectionRange(input.value.length, input.value.length)
    fireEvent.click(screen.getByRole('button', { name: 'Mention a member' }))
    fireEvent.click(screen.getByRole('option', { name: '@Planner' }))
    expect(input.value).toBe('Please review @Planner ')
    expect(send).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(input)
  })

  it('preserves drafts while showing a closed room notice', () => {
    const { rerender } = render(<Example />)
    rerender(<Example closed />)
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('A room message')
    expect(screen.getByText('This room is closed. Your draft is preserved.')).toBeTruthy()
  })
})
