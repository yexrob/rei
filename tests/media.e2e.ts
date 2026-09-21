import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const binary = process.env.BINGO_E2E_BINARY || resolve('../bingo-improve/target/debug', process.platform === 'win32' ? 'bingo.exe' : 'bingo')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')

async function fixture() {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'rei-media-')))
  const workspace = join(home, 'media-project')
  await mkdir(join(home, '.bingo'), { recursive: true })
  await mkdir(workspace)
  await writeFile(join(home, '.bingo/settings.json'), JSON.stringify({ provider: 'fake', model: 'fake-1', permissions: { defaultMode: 'bypassPermissions' } }))
  const image = join(workspace, 'recorded picture.png')
  await writeFile(image, png)
  const script = join(home, 'responses.json')
  const markdown = [
    '# Media ready',
    `![Journal raster](<${image}>)`,
    'Inline $x^2 + y^2 = z^2$.',
    '$$\n\\frac{a}{b} = \\sqrt{c}\n$$',
    '```mermaid\ngraph LR\nA[Recorded image] --> B[Safe preview]\n```',
    '```mermaid\nsequenceDiagram\nAlice->>Bob: Hello\n```',
    '![Remote raster](https://media-fixture.invalid/click-only.png)',
    '<script>window.REI_MEDIA_EXECUTED = true</script>',
    '<img src="https://media-fixture.invalid/raw-html.png" onerror="window.REI_MEDIA_EXECUTED=true">',
    '$\\includegraphics{https://media-fixture.invalid/math.png}$',
    '```mermaid\n%%{init: {securityLevel: "loose"}}%%\ngraph TD; X-->Y\n```',
    '```html\n<img src="https://media-fixture.invalid/fenced.png">\n```'
  ].join('\n\n')
  await writeFile(script, JSON.stringify({ responses: [
    { steps: [{ toolCall: { name: 'Read', input: { file_path: image } } }] },
    { steps: [{ text: markdown }] }
  ] }))
  return { home, workspace, script }
}

test('real rich media: recorded rasters, isolated Mermaid SVG, KaTeX and consent-only remote images', async ({}, info) => {
  const { home, workspace, script } = await fixture()
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'DISPLAY', 'XAUTHORITY', 'TMPDIR', 'TEMP', 'TMP'].flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []))
  const app = await electron.launch({ args: [resolve('out/main/index.js')], env: { ...env, HOME: home, USERPROFILE: home, BINGO_GUI_USER_DATA: join(home, 'desktop'), BINGO_GUI_CWD: workspace, BINGO_GUI_BINARY: binary, BINGO_FAKE_SCRIPT: script } })
  const page = await app.firstWindow()
  const requests: { url: string; headers: Record<string, string> }[] = [], errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://media-fixture.invalid/**', async (route) => {
    requests.push({ url: route.request().url(), headers: await route.request().allHeaders() })
    await route.fulfill({ contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: png })
  })
  try {
    await expect(page.locator('.startup-stage')).toHaveAttribute('data-phase', 'settled')
    await expect(page.getByText('Connected locally')).toBeVisible()
    await page.getByRole('textbox', { name: 'Message bingo' }).fill('Show the isolated media fixture.')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Media ready' })).toBeVisible()
    const local = page.getByRole('img', { name: 'Journal raster', exact: true })
    await expect(local).toHaveAttribute('src', /^data:image\/png;base64,/)
    await local.scrollIntoViewIfNeeded()
    await expect.poll(() => local.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
    const thumbnail = page.locator('.file-image-thumbnail img')
    await thumbnail.scrollIntoViewIfNeeded()
    await expect.poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
    expect(await page.locator('.katex').count()).toBeGreaterThanOrEqual(2)
    await expect(page.locator('.katex img, .katex a')).toHaveCount(0)
    await expect(page.locator('.katex-display')).toHaveCount(1)
    expect(await page.locator('.math-display').evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true)
    const diagrams = page.getByRole('img', { name: 'Mermaid diagram', exact: true })
    await expect(diagrams).toHaveCount(2)
    for (const diagram of await diagrams.all()) {
      await diagram.scrollIntoViewIfNeeded()
      await expect.poll(() => diagram.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0)).toBe(true)
      const svg = decodeURIComponent((await diagram.getAttribute('src'))!.split(',')[1])
      expect(svg).toContain('<svg')
      expect(svg).not.toMatch(/foreignObject|<script|<image|\bonclick=|<a\s/)
    }
    const coloredPixels = await diagrams.first().evaluate((image: HTMLImageElement) => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(image.naturalWidth); canvas.height = Math.ceil(image.naturalHeight)
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      let colored = 0
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 236 && pixels[i + 1] === 236 && pixels[i + 2] === 255 && pixels[i + 3] === 255) colored++
      return colored
    })
    expect(coloredPixels).toBeGreaterThan(100)
    await expect(page.getByText('Diagram preview unavailable. Source is preserved below.')).toBeVisible()
    expect(requests).toEqual([])
    expect(await page.evaluate(() => (window as unknown as { REI_MEDIA_EXECUTED?: boolean }).REI_MEDIA_EXECUTED)).toBeUndefined()
    await diagrams.first().scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath('safe-rich-media.png'), animations: 'disabled' })
    await page.getByRole('button', { name: 'Load external image' }).click()
    const remote = page.getByRole('img', { name: 'Remote raster', exact: true })
    await remote.scrollIntoViewIfNeeded()
    await expect.poll(() => remote.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
    expect(requests.map((request) => request.url)).toEqual(['https://media-fixture.invalid/click-only.png'])
    expect(requests[0].headers.referer).toBeUndefined()
    expect(requests[0].headers.cookie).toBeUndefined()
    expect(requests[0].headers.authorization).toBeUndefined()
    expect(errors).toEqual([])
  } finally { await app.close() }
})
