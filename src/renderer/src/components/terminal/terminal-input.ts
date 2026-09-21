const MAX_INPUT = 1024 * 1024

export function splitTerminalInput(data: string): string[] {
  const chunks: string[] = []
  for (let offset = 0; offset < data.length;) {
    let end = Math.min(offset + 16384, data.length)
    const last = data.charCodeAt(end - 1)
    if (last >= 0xd800 && last <= 0xdbff && end < data.length) end--
    chunks.push(data.slice(offset, end))
    offset = end
  }
  return chunks
}

export class TerminalInput {
  private queued: string[] = []
  private size = 0
  private writing = false
  private disposed = false
  constructor(private readonly write: (data: string) => Promise<void>, private readonly fail: (error: string) => void) {}

  push(data: string): void {
    if (this.disposed) return
    if (this.size + data.length > MAX_INPUT) { this.fail('Terminal input is too large. Paste a smaller amount.'); return }
    this.queued.push(...splitTerminalInput(data))
    this.size += data.length
    void this.flush()
  }

  private async flush(): Promise<void> {
    if (this.writing) return
    this.writing = true
    try {
      while (!this.disposed && this.queued.length) {
        const chunk = this.queued.shift()!
        await this.write(chunk)
        this.size -= chunk.length
      }
    } catch (error) {
      this.queued = []; this.size = 0
      if (!this.disposed) this.fail(error instanceof Error ? error.message : 'Terminal input could not be sent.')
    } finally { this.writing = false }
  }

  dispose(): void { this.disposed = true; this.queued = []; this.size = 0 }
}
