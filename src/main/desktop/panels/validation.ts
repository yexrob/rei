import { z } from 'zod'
import type { PanelBounds } from '../../../shared/panels'
import { DesktopFailure } from '../rpc-client'
import { externalUrl } from '../security'

export const webUrlSchema = z.string().min(1).max(4096).transform((value) => externalUrl(value))
export const browserActionSchema = z.enum(['back', 'forward', 'reload', 'stop', 'open-external', 'focus'])
export const boundsSchema = z.strictObject({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000), width: z.number().finite().min(0).max(100000), height: z.number().finite().min(0).max(100000) })
export const browserLayoutSchema = z.strictObject({ visible: z.boolean(), bounds: boundsSchema })
export const terminalIdSchema = z.string().uuid()
export const terminalWriteSchema = z.strictObject({ id: terminalIdSchema, data: z.string().min(1).max(16384) })
export const terminalResizeSchema = z.strictObject({ id: terminalIdSchema, cols: z.number().int().min(2).max(500), rows: z.number().int().min(1).max(300) })
export const terminalAckSchema = z.strictObject({ id: terminalIdSchema, sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) })

export function allowedNavigation(url: string): boolean {
  try { externalUrl(url); return true } catch { return false }
}
// DOM rectangles are CSS pixels; Electron child-view bounds are window-content DIPs.
export function nativeBounds(bounds: PanelBounds, zoom: number, content: { width: number; height: number }): PanelBounds {
  if (!Number.isFinite(zoom) || zoom <= 0) throw new DesktopFailure('INVALID_ZOOM', 'The window scale is not available.')
  const left = Math.max(0, Math.min(content.width, Math.round(bounds.x * zoom)))
  const top = Math.max(0, Math.min(content.height, Math.round(bounds.y * zoom)))
  const right = Math.max(left, Math.min(content.width, Math.round((bounds.x + bounds.width) * zoom)))
  const bottom = Math.max(top, Math.min(content.height, Math.round((bounds.y + bounds.height) * zoom)))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

// A terminal is a local user shell, not a child of bingo's agent environment.
// Explicitly omit provider credentials, tokens, NODE_OPTIONS, and Electron flags.
export function terminalEnvironment(source: NodeJS.ProcessEnv, platform: NodeJS.Platform): Record<string, string> {
  const names = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'WINDIR', 'COMSPEC', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PATHEXT', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME']
  const allow = new Set(names.map((name) => platform === 'win32' ? name.toUpperCase() : name))
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(source)) if (typeof value === 'string' && allow.has(platform === 'win32' ? name.toUpperCase() : name)) result[name] = value
  result.TERM = 'xterm-256color'
  result.COLORTERM = 'truecolor'
  return result
}
