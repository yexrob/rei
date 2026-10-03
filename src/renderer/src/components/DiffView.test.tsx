// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DiffView, parseUnifiedDiff } from './DiffView'

afterEach(cleanup)
const patch = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -3,3 +3,3 @@ fn\n keep\n-old\n+new\n\\ No newline at end of file\n'

describe('DiffView', () => {
  it('classifies rows and numbers them from hunk headers', () => {
    expect(parseUnifiedDiff(patch)).toEqual([
      { kind: 'meta', text: 'diff --git a/a.ts b/a.ts' }, { kind: 'meta', text: '--- a/a.ts' }, { kind: 'meta', text: '+++ b/a.ts' },
      { kind: 'hunk', text: '@@ -3,3 +3,3 @@ fn' },
      { kind: 'context', text: ' keep', oldLine: 3, newLine: 3 },
      { kind: 'remove', text: '-old', oldLine: 4 },
      { kind: 'add', text: '+new', newLine: 4 },
      { kind: 'meta', text: '\\ No newline at end of file' }
    ])
  })
  it('colors bare +/- previews without headers', () => {
    expect(parseUnifiedDiff('-a\n+b').map(row => row.kind)).toEqual(['remove', 'add'])
  })
  it('renders a focusable, labelled diff that keeps signs in the text', () => {
    render(<DiffView text={patch} label="Diff for a.ts" lineNumbers />)
    const view = screen.getByLabelText('Diff for a.ts')
    expect(view.tabIndex).toBe(0)
    expect(view.querySelector('.diff-add')?.textContent).toContain('+new')
    expect(view.querySelector('.diff-remove')?.textContent).toContain('-old')
    expect(view.querySelectorAll('.diff-gutter[aria-hidden="true"]').length).toBeGreaterThan(0)
  })
})
