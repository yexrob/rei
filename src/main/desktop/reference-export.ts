import { randomUUID } from 'node:crypto'
import { open, rename, rm, type FileHandle } from 'node:fs/promises'
import type { ExportProgress, ExportReferenceRequest, PartRequest, TransferCancel } from '../../shared/desktop'
import type { RuntimePool } from './runtime-pool'
import { DesktopFailure } from './rpc-client'
import { suggestedFilename } from './security'

const PART_BYTES = 256 * 1024
const MAX_PIN_BYTES = 128 * 1024 * 1024
const fail = (code: string, message: string) => new DesktopFailure(code, message)

/** FNV-1a/64 over bytes, not token authentication. Two uint32 words avoid
 * allocating 100 million BigInts when explicitly exporting a 100 MiB body.
 */
export class Fnv64 {
  private hi = 0xcbf29ce4
  private lo = 0x84222325
  update(bytes: Uint8Array): void {
    for (const byte of bytes) {
      const low = (this.lo ^ byte) >>> 0
      const product = low * 0x1b3
      this.hi = (Math.imul(this.hi, 0x1b3) + Math.floor(product / 0x100000000) + (low << 8)) >>> 0
      this.lo = product >>> 0
    }
  }
  digest(): string { return this.hi.toString(16).padStart(8, '0') + this.lo.toString(16).padStart(8, '0') }
  static of(bytes: Uint8Array): string { const hash = new Fnv64(); hash.update(bytes); return hash.digest() }
}

type Destination = { canceled: boolean; filePath?: string }
type Active = { hostId: string; connectionId: string; session: string; cancelled: boolean }

/** Explicit user-approved raw JSON, never a renderer-provided filesystem path.
 * A temp in that destination directory is owned only by this one export.
 */
export class ReferenceExporter {
  private readonly active = new Map<string, Active>()
  private readonly running = new Set<Promise<boolean>>()
  constructor(private readonly runtime: RuntimePool, private readonly save: (suggestedName: string) => Promise<Destination>, private readonly progress: (event: ExportProgress) => void, private readonly commit: (temp: string, destination: string) => Promise<void> = rename) {}

  exportReference(input: ExportReferenceRequest): Promise<boolean> {
    const task = this.export(input)
    this.running.add(task)
    void task.finally(() => this.running.delete(task)).catch(() => {})
    return task
  }
  async waitForCleanup(): Promise<void> { await Promise.allSettled([...this.running]) }
  private async export(input: ExportReferenceRequest): Promise<boolean> {
    const existing = this.active.get(input.transferId)
    if (existing) throw fail('TRANSFER_IN_PROGRESS', 'This export id is already active.')
    if ([...this.active.values()].some(value => value.hostId === input.hostId)) throw fail('RUNTIME_BUSY', 'Wait for this project’s active raw export to finish.')
    const ref = this.runtime.referenceFor(input)
    if (ref.totalBytes > MAX_PIN_BYTES) throw fail('PROTOCOL_LIMIT', 'This reference exceeds the pinned content quota. No file was changed.')
    const state: Active = { hostId: input.hostId, connectionId: input.connectionId, session: input.session, cancelled: false }
    this.active.set(input.transferId, state)
    let release: (() => void) | null = null
    let file: FileHandle | null = null, temp = '', ownedTemp = false
    const source = { transferId: input.transferId, hostId: input.hostId, connectionId: input.connectionId, session: input.session, totalBytes: input.totalBytes }
    const notify = (status: ExportProgress['status'], doneBytes: number): void => this.progress({ type: 'export-progress', ...source, doneBytes, status })
    const check = (): void => {
      if (state.cancelled) throw fail('TRANSFER_CANCELLED', 'The raw export was cancelled. The original destination remains unchanged.')
      const current = this.runtime.getConnection(input.connectionId)
      if (current.hostId !== input.hostId) throw fail('STALE_CONNECTION', 'The source connection changed during export. No incomplete file was committed.')
    }
    try {
      release = this.runtime.holdDelivery({ hostId: input.hostId, connectionId: input.connectionId })
      const name = suggestedFilename(input.suggestedName)
      const choice = await this.save(name.toLowerCase().endsWith('.json') ? name : `${name}.json`)
      if (choice.canceled || !choice.filePath) { try { notify('cancelled', 0) } catch { /* User cancellation is still a no-write result. */ } return false }
      check()
      temp = `${choice.filePath}.rei-export-${randomUUID()}.tmp`
      file = await open(temp, 'wx', 0o600)
      ownedTemp = true
      let offset = 0
      const digest = new Fnv64()
      while (offset < input.totalBytes) {
        check()
        const part: PartRequest = input.kind === 'item'
          ? { transferId: input.transferId, hostId: input.hostId, connectionId: input.connectionId, session: input.session, kind: 'item', item: input.item, generation: input.generation, token: input.token, offset, maxBytes: PART_BYTES }
          : { transferId: input.transferId, hostId: input.hostId, connectionId: input.connectionId, session: input.session, kind: input.kind, token: input.token, offset, maxBytes: PART_BYTES }
        const result = await this.runtime.readCorePart(part)
        check()
        const bytes = Buffer.from(result.data, 'utf8')
        const next = offset + bytes.length
        if (result.totalBytes !== input.totalBytes || bytes.length < 1 || bytes.length > PART_BYTES || next > input.totalBytes ||
          (result.nextOffset === null || result.nextOffset === undefined ? next !== input.totalBytes : result.nextOffset !== next)) throw fail('INVALID_PROTOCOL', 'Core returned an incomplete or non-progressing part; the temporary file was removed.')
        let written = 0
        while (written < bytes.length) {
          const result = await file.write(bytes, written, bytes.length - written)
          if (result.bytesWritten < 1) throw fail('WRITE_FAILED', 'The destination stopped accepting export bytes.')
          written += result.bytesWritten
        }
        digest.update(bytes)
        offset = next
        check()
        notify('running', offset)
      }
      if (offset !== input.totalBytes || digest.digest() !== input.checksum) throw fail('CONTENT_MISMATCH', 'The complete recorded JSON did not match its reference. No destination was changed.')
      check()
      await file.sync()
      await file.close(); file = null
      check()
      try { await this.commit(temp, choice.filePath) }
      catch { throw fail('EXPORT_REPLACE_FAILED', 'The selected destination could not be atomically replaced. Its existing content was kept.') }
      ownedTemp = false
      try { notify('completed', offset) } catch { /* The valid file is already committed; do not claim failure. */ }
      return true
    } catch (error) {
      try { notify(state.cancelled ? 'cancelled' : 'failed', 0) } catch { /* Preserve the original failure and clean up our own temp. */ }
      throw error
    } finally {
      await file?.close().catch(() => {})
      if (ownedTemp) await rm(temp, { force: true }).catch(() => {})
      release?.()
      this.active.delete(input.transferId)
    }
  }
  cancelExport(input: TransferCancel): void {
    const active = this.active.get(input.transferId)
    if (!active) return
    if (active.connectionId !== input.connectionId || active.session !== input.session) throw fail('STALE_CONNECTION', 'This cancellation belongs to another project or saved session.')
    active.cancelled = true
  }
  cancelAll(): void { for (const active of this.active.values()) active.cancelled = true }
  cancelHost(hostId: string): void { for (const active of this.active.values()) if (active.hostId === hostId) active.cancelled = true }
}
