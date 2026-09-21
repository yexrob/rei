const maxDiagramChars = 32_000
const svgNamespace = 'http://www.w3.org/2000/svg'
const svgTags = new Set(['svg', 'g', 'defs', 'marker', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc', 'style', 'clipPath'])
const svgAttributes = new Set(['id', 'class', 'viewBox', 'width', 'height', 'x', 'y', 'dx', 'dy', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'transform', 'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'opacity', 'style', 'text-anchor', 'dominant-baseline', 'font-size', 'font-family', 'font-weight', 'marker-start', 'marker-mid', 'marker-end', 'markerWidth', 'markerHeight', 'markerUnits', 'refX', 'refY', 'orient', 'clip-path', 'preserveAspectRatio', 'xmlns', 'role', 'aria-roledescription', 'aria-labelledby', 'aria-describedby'])

export function diagramSourceAllowed(source: string): boolean {
  return source.length > 0 && source.length <= maxDiagramChars && !/%%\s*\{|^\s*---|<\s*[a-z/!]|\bclick\s|\b(?:img|icon)\s*:|url\s*\(|image-set\s*\(|@import|\\/im.test(source)
}

function safeCss(value: string): boolean {
  return !/\\|@(?!keyframes\b)|(?:https?|data|file|javascript):|(?:expression|image-set)\s*\(/i.test(value) && !/url\s*\(\s*(?!#[\w-]+\s*\))/i.test(value)
}

export function sanitizeDiagramSvg(svg: string): string {
  if (svg.length > 2_000_000) throw new Error('Diagram exceeds preview limit')
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const root = parsed.documentElement
  if (root.localName !== 'svg' || root.namespaceURI !== svgNamespace || parsed.querySelector('parsererror')) throw new Error('Invalid diagram SVG')
  for (const node of [root, ...root.querySelectorAll('*')]) {
    if (node.namespaceURI !== svgNamespace || !svgTags.has(node.localName)) { node.remove(); continue }
    if (node.localName === 'style' && !safeCss(node.textContent ?? '')) { node.remove(); continue }
    for (const attr of [...node.attributes]) {
      if (!svgAttributes.has(attr.name) || !safeCss(attr.value)) node.removeAttribute(attr.name)
    }
  }
  return new XMLSerializer().serializeToString(root)
}

let queue = Promise.resolve()
let nextId = 0

export function renderDiagram(source: string): Promise<string> {
  if (!diagramSourceAllowed(source)) return Promise.reject(new Error('Unsupported diagram source'))
  // Mermaid has a global configuration and a DOM-based layout pass. Serialize both together.
  const task = queue.then(async () => {
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, maxTextSize: maxDiagramChars, maxEdges: 200, htmlLabels: false, flowchart: { htmlLabels: false }, theme: 'default' })
    await mermaid.parse(source)
    const container = document.createElement('div')
    container.setAttribute('aria-hidden', 'true')
    container.inert = true
    container.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none'
    document.body.append(container)
    try {
      const result = await mermaid.render(`rei-diagram-${++nextId}`, source, container)
      return sanitizeDiagramSvg(result.svg)
    } finally { container.remove() }
  })
  queue = task.then(() => {}, () => {})
  return task
}
