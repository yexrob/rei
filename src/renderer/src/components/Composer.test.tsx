// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { Composer, emptyDraft } from './Composer'

afterEach(cleanup)

const props = () => ({
  draft: emptyDraft, setDraft: vi.fn(), send: vi.fn(), stop: vi.fn(), attach: vi.fn(),
  ready: true, busy: false, sending: false, model: '', thinking: 'high', permission: 'default',
  models: [], commands: [], command: vi.fn(), inputRef: createRef<HTMLTextAreaElement>(),
  workspaceName: 'bingo', chooseProject: vi.fn()
})

describe('desktop composer', () => {
  it('makes the selected agent the explicit accessible recipient', () => {
    const p = props()
    const { rerender } = render(<Composer {...p} recipient={{ name: 'Reviewer', role: 'agent' }} />)
    expect(screen.getByText('To Reviewer')).toBeTruthy()
    expect(screen.getByText('Sub-agent · direct message')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Message Reviewer' }).getAttribute('placeholder')).toBe('Send directions to Reviewer…')
    rerender(<Composer {...p} recipient={{ name: 'Bingo', role: 'main' }} />)
    expect(screen.getByText('To Bingo')).toBeTruthy()
    expect(screen.getByText('Main agent')).toBeTruthy()
    expect(screen.queryByText('To Reviewer')).toBeNull()
  })

  it('keeps workspace and permission context outside the input surface', () => {
    const p = props(); render(<Composer {...p} />)
    const project = screen.getByRole('button', { name: 'bingo' })
    expect(project.closest('.composer')).toBeNull()
    fireEvent.click(project)
    expect(p.chooseProject).toHaveBeenCalledOnce()
    expect(screen.getByText('Local')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Permission mode' })).toBeTruthy()
  })

  it('replaces the idle send button with Stop when generating with no draft', () => {
    const p = props(); render(<Composer {...p} busy />)
    expect(screen.queryByRole('button', { name: 'Send follow-up' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Stop generation' }))
    expect(p.stop).toHaveBeenCalledOnce()
  })

  it('keeps the send target stable and explains idle, sending and working states', () => {
    const p = props(); const { rerender, container } = render(<Composer {...p} draft={{ text: 'A task', images: [] }} />)
    const send = screen.getByRole('button', { name: 'Send message' })
    expect(container.querySelector('.composer')?.getAttribute('data-state')).toBe('composing')
    expect(screen.getByRole('textbox').getAttribute('aria-describedby')).toBe('composer-hint')
    rerender(<Composer {...p} sending draft={{ text: 'A task', images: [] }} />)
    expect(screen.getByRole('button', { name: 'Send message' })).toBe(send)
    expect(send.hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('textbox').hasAttribute('readonly')).toBe(true)
    expect(container.querySelector('.composer')?.getAttribute('data-state')).toBe('sending')
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(p.send).not.toHaveBeenCalled()
    rerender(<Composer {...p} busy ready={false} />)
    expect(screen.getByRole('button', { name: 'Stop generation' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Stop generation' }))
    expect(p.stop).not.toHaveBeenCalled()
  })

  it('never sends for IME Enter or Shift Enter, but submits an ordinary Enter', () => {
    const p = props(); render(<Composer {...p} draft={{ text: '中文任务', images: [] }} />)
    const input = screen.getByRole('textbox')
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(p.send).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(p.send).toHaveBeenCalledOnce()
  })

  it('lets a follow-up send without hiding the stop control', () => {
    const p = props(); render(<Composer {...p} busy draft={{ text: 'Add tests too', images: [] }} />)
    expect(screen.getByRole('button', { name: 'Stop generation' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send follow-up' }))
    expect(p.send).toHaveBeenCalledOnce()
  })
})
