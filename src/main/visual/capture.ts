import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'

export type VisualCaptureInput = {
  runId: string
  theme: 'dark' | 'light'
  state: 'chat' | 'empty' | 'loading' | 'error'
  viewport: '1440x900' | '800x600'
}

const SAFE_RUN_ID = /^[a-zA-Z0-9_-]{1,64}$/

export class VisualCapture {
  constructor(private readonly window: BrowserWindow, private readonly projectRoot: string) {}

  async capture(input: VisualCaptureInput): Promise<string> {
    if (!SAFE_RUN_ID.test(input.runId)) throw new Error('Invalid visual capture run ID')
    const [width, height] = input.viewport.split('x').map(Number)
    this.window.setContentSize(width, height)
    const image = await this.window.webContents.capturePage()
    const directory = join(this.projectRoot, 'screenshots', input.runId, input.theme)
    await mkdir(directory, { recursive: true })
    const path = join(directory, `${input.state}-${input.viewport}.png`)
    await writeFile(path, image.toPNG())
    return path
  }
}

export function visualCaptureEnabled(isPackaged: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  return !isPackaged || env.BINGO_GUI_VISUAL_QA === '1'
}
