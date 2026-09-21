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

  it('lets a follow-up send without hiding the stop control', () => {
    const p = props(); render(<Composer {...p} busy draft={{ text: 'Add tests too', images: [] }} />)
    expect(screen.getByRole('button', { name: 'Stop generation' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send follow-up' }))
    expect(p.send).toHaveBeenCalledOnce()
  })
})
