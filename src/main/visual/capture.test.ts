import { describe, expect, it } from 'vitest'
import { visualCaptureEnabled } from './capture'

describe('visual capture gate', () => {
  it('allows development and explicit packaged QA only', () => {
    expect(visualCaptureEnabled(false, {})).toBe(true)
    expect(visualCaptureEnabled(true, {})).toBe(false)
    expect(visualCaptureEnabled(true, { BINGO_GUI_VISUAL_QA: '1' })).toBe(true)
  })
})
