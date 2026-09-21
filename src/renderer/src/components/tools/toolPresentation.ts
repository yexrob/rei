import type { SessionSummary } from '../../../../shared/rpc'
import type { ToolCallItem } from '../../state/session'
import type { OpenLink, RunAction } from '../Content'
import { object } from '../primitives'

export type ToolCallProps = {
  item: ToolCallItem
  openLink: OpenLink
  runAction: RunAction
  onSelectSession?: (id: string) => void
  sessions?: SessionSummary[]
  sessionId?: string
}
export type ToolFamily = 'file' | 'terminal' | 'search' | 'web' | 'collaboration' | 'task' | 'knowledge' | 'schedule' | 'question' | 'generic'
const families: Record<string, ToolFamily> = {
  Read: 'file', Write: 'file', Edit: 'file', Bash: 'terminal', BashOutput: 'terminal', KillShell: 'terminal',
  Glob: 'search', Grep: 'search', WebSearch: 'web', WebFetch: 'web', ShowPage: 'web',
  SpawnAgent: 'collaboration', SendMessage: 'collaboration', ListAgents: 'collaboration', StopAgent: 'collaboration', DismissAgent: 'collaboration',
  ListModels: 'collaboration', SetThinking: 'collaboration', OpenRoom: 'collaboration', Seat: 'collaboration', Unseat: 'collaboration', CloseRoom: 'collaboration', Listen: 'collaboration',
  TaskCreate: 'task', TaskUpdate: 'task', TaskGet: 'task', TaskList: 'task',
  Skill: 'knowledge', ExperienceCommit: 'knowledge', ExperienceQuery: 'knowledge', ExperienceOutcome: 'knowledge', ExperienceForget: 'knowledge',
  ScheduleCreate: 'schedule', ScheduleList: 'schedule', ScheduleForget: 'schedule', Wake: 'schedule', AskUserQuestion: 'question'
}
export function classifyTool(name: string): ToolFamily { return Object.hasOwn(families, name) ? families[name] : 'generic' }
export function inputRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== 'string') return object(input)
  try { return object(JSON.parse(input)) } catch { return {} }
}
export function toolState(item: ToolCallItem): ToolCallItem['status'] {
  if (item.status === 'interrupted' || item.status === 'failed') return item.status
  return item.body.output?.isError ? 'failed' : item.status
}
export function safeWebUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try { return ['https:', 'http:'].includes(new URL(value).protocol) ? value : null } catch { return null }
}
export function resultLines(text: string): string[] { return text.split(/\r?\n/) }
export function parseTerminal(text: string): { command?: string; output: string; receipt?: string; exit?: number } {
  const lines = text.trimEnd().split('\n')
  const command = lines[0]?.startsWith('$ ') ? lines.shift()!.slice(2) : undefined
  const last = lines.at(-1) ?? ''
  const exited = /^\[Exited with code (-?\d+)\]$/.exec(last)
  const receipt = exited || /^\[(?:job .+ · .+ · cursor \d+.*|Killed .+)\]$/.test(last) ? lines.pop() : undefined
  return { ...(command ? { command } : {}), output: lines.join('\n'), ...(receipt ? { receipt } : {}), ...(exited ? { exit: Number(exited[1]) } : {}) }
}
export function compactValue(value: unknown): string {
  if (typeof value === 'string') return value.length > 160 ? `${value.slice(0, 160)}…` : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.slice(0, 8).map((part) => prettyJson(part).slice(0, 160)).join(', ').slice(0, 160) + (value.length > 8 ? '…' : '')
  return value == null ? '' : prettyJson(value).slice(0, 160)
}
export function prettyJson(value: unknown): string {
  if (typeof value === 'string') return value
  try { return JSON.stringify(value, null, 2) ?? '' } catch { return '[Value exceeds JSON formatting limits]' }
}
export function mcpIdentity(name: string): { server: string; method: string } | null {
  const match = /^mcp__(.+?)__(.+)$/.exec(name)
  return match ? { server: match[1], method: match[2] } : null
}
