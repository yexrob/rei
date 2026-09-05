import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const input = resolve(process.argv.find((arg) => arg.endsWith('.json')) ?? resolve(root, '../bingo-improve/schema/rpc.json'))
const raw = await readFile(input, 'utf8')
const schema = JSON.parse(raw)
const reference = (ref) => {
  if (!ref.startsWith('#/$defs/') || !schema.$defs[ref.slice(8)]) throw new Error(`Unknown ref: ${ref}`)
  return ref.slice(8)
}
const known = new Set(['type', '$ref', 'properties', 'required', 'additionalProperties', 'items', 'prefixItems', 'oneOf', 'anyOf', 'const', 'enum', 'description', 'default', 'format', 'minimum', 'minLength', 'maxLength', 'minItems', 'maxItems'])
function render(s, zod = false) {
  if (s === true) return zod ? 'z.json()' : 'unknown'
  if (s === false) return zod ? 'z.never()' : 'never'
  for (const key of Object.keys(s)) if (!known.has(key)) throw new Error(`Unsupported schema keyword: ${key}`)
  if (s.$ref) {
    const base = zod ? `z.lazy(() => definitions.${reference(s.$ref)})` : reference(s.$ref)
    if (!s.type && !s.properties) return base
    const { $ref, ...siblings } = s
    return zod ? `z.intersection(${base}, ${render(siblings, true)})` : `(${base} & ${render(siblings)})`
  }
  if ('const' in s) return zod ? `z.literal(${JSON.stringify(s.const)})` : JSON.stringify(s.const)
  if (s.enum) return zod ? `z.enum(${JSON.stringify(s.enum)})` : s.enum.map(JSON.stringify).join(' | ')
  const union = s.oneOf ?? s.anyOf ?? (Array.isArray(s.type) ? s.type.map((type) => ({ ...s, type })) : null)
  if (union) return zod ? `z.union([${union.map((v) => render(v, true)).join(', ')}])` : `(${union.map((v) => render(v)).join(' | ')})`
  if (s.type === 'object') {
    const entries = Object.entries(s.properties ?? {})
    if (!entries.length && s.additionalProperties) return zod ? `z.record(z.string(), ${render(s.additionalProperties, true)})` : `Record<string, ${render(s.additionalProperties)}>`
    const fields = entries.map(([key, value]) => {
      const optional = !s.required?.includes(key)
      return zod ? `${JSON.stringify(key)}: ${render(value, true)}${optional ? '.optional()' : ''}` : `${JSON.stringify(key)}${optional ? '?' : ''}: ${render(value)}`
    })
    if (zod) return `z.${s.additionalProperties === false ? 'strictObject' : 'looseObject'}({ ${fields.join(', ')} })`
    return entries.length ? `{ ${fields.join('; ')} }` : 'Record<string, unknown>'
  }
  if (s.type === 'array') {
    if (s.prefixItems) return zod ? `z.tuple([${s.prefixItems.map((v) => render(v, true)).join(', ')}])` : `[${s.prefixItems.map((v) => render(v)).join(', ')}]`
    let result = zod ? `z.array(${render(s.items ?? true, true)})` : `Array<${render(s.items ?? true)}>`
    if (zod && s.minItems !== undefined) result += `.min(${s.minItems})`
    if (zod && s.maxItems !== undefined) result += `.max(${s.maxItems})`
    return result
  }
  if (!s.type) return zod ? 'z.json()' : 'unknown'
  if (!zod) return s.type === 'integer' ? 'number' : s.type
  let result = { string: 'z.string()', boolean: 'z.boolean()', null: 'z.null()', number: 'z.number()', integer: 'z.number().int().safe()' }[s.type]
  if (!result) throw new Error(`Unsupported type: ${s.type}`)
  if (s.minimum !== undefined && ['number', 'integer'].includes(s.type)) result += `.min(${s.minimum})`
  if (s.minLength !== undefined && s.type === 'string') result += `.min(${s.minLength})`
  if (s.maxLength !== undefined && s.type === 'string') result += `.max(${s.maxLength})`
  return result
}
const banner = `// Generated from bingo-improve/schema/rpc.json; do not edit.\n// SHA-256: ${createHash('sha256').update(raw).digest('hex')}\n`
const definitions = Object.entries(schema.$defs)
const types = banner + `export const RPC_PROTOCOL = ${schema.protocol} as const\n\n` + definitions.map(([name, value]) => `export type ${name} = ${render(value)}\n`).join('\n') + '\nexport type Frame = EventParams\n\nexport interface RpcMethods {\n' + Object.entries(schema.methods).map(([name, value]) => `  ${JSON.stringify(name)}: { params: ${render(value.params)}; result: ${render(value.result)} }`).join('\n') + '\n}\nexport type RpcMethod = keyof RpcMethods\n'
const validators = banner + `import { z } from 'zod'\nimport type { RpcMethod } from '../../shared/rpc'\n\nconst definitions: Record<string, z.ZodType> = {\n` + definitions.map(([name, value]) => `  ${name}: ${render(value, true)}`).join(',\n') + '\n}\n\n' + ['params', 'result'].map((kind) => `export const rpc${kind === 'params' ? 'Params' : 'Result'}Schemas: Record<RpcMethod, z.ZodType> = {\n${Object.entries(schema.methods).map(([name, value]) => `  ${JSON.stringify(name)}: ${render(value[kind], true)}`).join(',\n')}\n}\n`).join('\n') + `\nexport const rpcNotificationSchemas = {\n${Object.entries(schema.notifications).map(([name, value]) => `  ${JSON.stringify(name)}: ${render(value.params, true)}`).join(',\n')}\n}\n`
for (const [relative, content] of [['src/shared/rpc.ts', types], ['src/main/desktop/rpc-validation.ts', validators]]) {
  const path = resolve(root, relative)
  if (process.argv.includes('--check')) {
    if (await readFile(path, 'utf8') !== content) throw new Error(`${relative} differs from canonical schema; regenerate it`)
  } else {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }
}
console.log(process.argv.includes('--check') ? 'RPC bindings match canonical schema.' : 'Generated RPC types and validators.')
