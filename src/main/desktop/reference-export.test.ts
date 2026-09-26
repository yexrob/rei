import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExportReferenceRequest } from '../../shared/desktop'
import { DesktopFailure } from './rpc-client'
import { Fnv64, ReferenceExporter } from './reference-export'
import type { RuntimePool } from './runtime-pool'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'rei-raw-export-')); roots.push(root)
  const destination = join(root, 'recorded.json')
  const payload = '{"kind":"assistant","text":"hello"}'
  const digest = Fnv64.of(Buffer.from(payload, 'utf8'))
  const input: ExportReferenceRequest = { transferId: 'save-1', hostId: 'host-a', connectionId: 'epoch-a', session: 'session-a', kind: 'item', item: 'item-a', generation: 4, token: 'core-pin', totalBytes: Buffer.byteLength(payload), checksum: digest, suggestedName: 'recorded.json' }
  const runtime = { referenceFor: vi.fn((candidate: ExportReferenceRequest) => {
    if (candidate.connectionId !== input.connectionId) throw new DesktopFailure('STALE_CONNECTION', 'Wrong epoch')
    if (candidate.session !== input.session) throw new DesktopFailure('REFERENCE_UNAVAILABLE', 'Wrong session')
    if (candidate.totalBytes !== input.totalBytes || candidate.checksum !== input.checksum) throw new DesktopFailure('REFERENCE_MISMATCH', 'Forged integrity metadata')
    return { hostId: input.hostId, connectionId: input.connectionId, session: input.session, kind: 'item', item: input.item, generation: input.generation, token: input.token, totalBytes: input.totalBytes, checksum: input.checksum }
  }), getConnection: vi.fn(() => ({ hostId: input.hostId, connectionId: input.connectionId, status: 'ready' })), holdDelivery: vi.fn(() => vi.fn()), readCorePart: vi.fn(async (part: { offset: number; maxBytes: number }) => ({ data: payload.slice(part.offset, part.offset + part.maxBytes), nextOffset: part.offset + part.maxBytes < payload.length ? part.offset + part.maxBytes : null, totalBytes: payload.length })) }
  const saveDialog = vi.fn(async () => ({ canceled: false, filePath: destination }))
  const progress = vi.fn()
  const exporter = new ReferenceExporter(runtime as unknown as RuntimePool, saveDialog, progress)
  return { root, destination, payload, input, runtime, saveDialog, progress, exporter }
}
describe('explicit raw JSON export with bounded Core parts', () => {
  it('uses language-independent FNV-1a64 UTF-8 vectors, not authentication', () => {
    expect(Fnv64.of(Buffer.from('hello'))).toBe('a430d84680aabd0b')
    expect(Fnv64.of(Buffer.from('{"kind":"assistant","text":"🧪 test"}'))).toBe('a6a4eddc16724d5c')
  })
  it('writes the exact JSON only after native destination consent, with source progress and small true result', async () => {
    const { exporter, destination, input, payload, runtime, saveDialog, progress } = await setup()
    expect(await exporter.exportReference(input)).toBe(true)
    expect(await readFile(destination, 'utf8')).toBe(payload)
    expect(saveDialog).toHaveBeenCalledOnce()
    expect(runtime.readCorePart.mock.calls[0][0]).toMatchObject({ kind: 'item', token: input.token, generation: input.generation, offset: 0, maxBytes: 256 * 1024 })
    expect(progress).toHaveBeenLastCalledWith({ type: 'export-progress', transferId: input.transferId, hostId: input.hostId, connectionId: input.connectionId, session: input.session, doneBytes: input.totalBytes, totalBytes: input.totalBytes, status: 'completed' })
  })
  it('returns false on user Save cancellation without creating any file or contacting Core', async () => {
    const { exporter, root, input, runtime, saveDialog } = await setup()
    saveDialog.mockResolvedValueOnce({ canceled: true, filePath: undefined } as never)
    expect(await exporter.exportReference(input)).toBe(false)
    expect(await readdir(root)).toEqual([])
    expect(runtime.readCorePart).not.toHaveBeenCalled()
  })
  it('rejects forged digest, old epoch and wrong owner before the Save dialog', async () => {
    const { exporter, input, saveDialog, runtime } = await setup()
    await expect(exporter.exportReference({ ...input, checksum: '0000000000000000' })).rejects.toMatchObject({ code: 'REFERENCE_MISMATCH' })
    await expect(exporter.exportReference({ ...input, connectionId: 'epoch-old' })).rejects.toMatchObject({ code: 'STALE_CONNECTION' })
    await expect(exporter.exportReference({ ...input, session: 'foreign-session' })).rejects.toMatchObject({ code: 'REFERENCE_UNAVAILABLE' })
    expect(saveDialog).not.toHaveBeenCalled(); expect(runtime.readCorePart).not.toHaveBeenCalled()
  })
  it('preserves an existing destination when bytes or FNV are wrong, cleaning only this attempt’s temp', async () => {
    const { exporter, root, destination, input, runtime } = await setup()
    await writeFile(destination, 'KEEP THIS EXISTING FILE')
    runtime.readCorePart.mockResolvedValueOnce({ data: '{"changed":true}', nextOffset: null, totalBytes: input.totalBytes })
    await expect(exporter.exportReference(input)).rejects.toMatchObject({ code: 'INVALID_PROTOCOL' })
    expect(await readFile(destination, 'utf8')).toBe('KEEP THIS EXISTING FILE')
    expect(await readdir(root)).toEqual(['recorded.json'])
  })
  it('fails closed if an otherwise-consistent Core part changes the final FNV', async () => {
    const { exporter, root, destination, input, runtime } = await setup()
    runtime.readCorePart.mockResolvedValueOnce({ data: 'x'.repeat(input.totalBytes), nextOffset: null, totalBytes: input.totalBytes })
    await expect(exporter.exportReference(input)).rejects.toMatchObject({ code: 'CONTENT_MISMATCH' })
    await expect(readdir(root)).resolves.toEqual([])
    await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('cancels an in-flight Core read and leaves the existing user file intact', async () => {
    const { exporter, input, runtime, destination, root } = await setup()
    await writeFile(destination, 'UNCHANGED')
    let release!: (value: { data: string; nextOffset: null; totalBytes: number }) => void
    runtime.readCorePart.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const exportPromise = exporter.exportReference(input)
    await vi.waitFor(() => expect(runtime.readCorePart).toHaveBeenCalledOnce())
    exporter.cancelExport({ transferId: input.transferId, connectionId: input.connectionId, session: input.session })
    release({ data: 'x'.repeat(input.totalBytes), nextOffset: null, totalBytes: input.totalBytes })
    await expect(exportPromise).rejects.toMatchObject({ code: 'TRANSFER_CANCELLED' })
    expect(await readFile(destination, 'utf8')).toBe('UNCHANGED')
    expect(await readdir(root)).toEqual(['recorded.json'])
  })
  it('never renames over the old target on a cross-platform replacement failure', async () => {
    const { runtime, saveDialog, input, destination, root, progress } = await setup()
    await writeFile(destination, 'OLD')
    const exporter = new ReferenceExporter(runtime as unknown as RuntimePool, saveDialog, progress, async () => { throw Object.assign(new Error('Cannot replace'), { code: 'EPERM' }) })
    await expect(exporter.exportReference(input)).rejects.toMatchObject({ code: 'EXPORT_REPLACE_FAILED' })
    expect(await readFile(destination, 'utf8')).toBe('OLD')
    expect(await readdir(root)).toEqual(['recorded.json'])
  })
  it('streams 100 MiB of original JSON in ≤256 KiB Core parts without materializing it in JS', async () => {
    const { root, runtime, saveDialog, progress, input } = await setup()
    const prefix = '{"kind":"assistant","text":"', suffix = '"}'
    const totalBytes = 100 * 1024 * 1024
    const bodyEnd = totalBytes - suffix.length
    const chunkAt = (offset: number, maxBytes: number): string => {
      const end = Math.min(totalBytes, offset + maxBytes)
      return (offset < prefix.length ? prefix.slice(offset, Math.min(end, prefix.length)) : '') +
        'x'.repeat(Math.max(0, Math.min(end, bodyEnd) - Math.max(offset, prefix.length))) +
        (end > bodyEnd ? suffix.slice(Math.max(0, offset - bodyEnd), end - bodyEnd) : '')
    }
    const digest = new Fnv64()
    for (let offset = 0; offset < totalBytes; offset += 256 * 1024) digest.update(Buffer.from(chunkAt(offset, 256 * 1024)))
    const big = { ...input, transferId: 'save-100m', totalBytes, checksum: digest.digest() }
    runtime.referenceFor.mockImplementation(() => ({ ...big }))
    runtime.readCorePart.mockImplementation(async (part: { offset: number; maxBytes: number }) => {
      const data = chunkAt(part.offset, part.maxBytes)
      const next = part.offset + Buffer.byteLength(data)
      return { data, nextOffset: next < totalBytes ? next : null, totalBytes }
    })
    expect(await new ReferenceExporter(runtime as unknown as RuntimePool, saveDialog, progress).exportReference(big)).toBe(true)
    expect((await stat(join(root, 'recorded.json'))).size).toBe(totalBytes)
    expect(runtime.readCorePart).toHaveBeenCalledTimes(400)
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ doneBytes: totalBytes, totalBytes, status: 'completed' }))
  }, 120_000)
})
