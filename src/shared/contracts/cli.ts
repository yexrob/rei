import { z } from 'zod'

export const PROTOCOL_VERSION = 1 as const

const uuid = z.string().uuid()
const commandBase = z.object({ protocolVersion: z.literal(1), commandId: uuid })
const eventBase = z.object({
  protocolVersion: z.literal(1),
  seq: z.number().int().positive(),
  sessionId: z.string().nullable()
})

const promptResponseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('option'), optionId: z.string() }),
  z.object({ kind: z.literal('text'), text: z.string().max(100_000) }),
  z.object({ kind: z.literal('cancel') })
])

export const clientCommandSchema = z.discriminatedUnion('type', [
  commandBase.extend({ type: z.literal('turn.start'), turnId: uuid, prompt: z.string().min(1).max(1_000_000) }),
  commandBase.extend({ type: z.literal('turn.cancel'), turnId: uuid }),
  commandBase.extend({ type: z.literal('prompt.respond'), turnId: uuid, promptId: uuid, response: promptResponseSchema }),
  commandBase.extend({ type: z.literal('providers.list') }),
  commandBase.extend({ type: z.literal('models.list'), provider: z.string().min(1) }),
  commandBase.extend({ type: z.literal('session.rename'), name: z.string().trim().min(1).max(80) }),
  commandBase.extend({ type: z.literal('session.delete') }),
  commandBase.extend({ type: z.literal('session.close') })
])

export const cliSessionMetadataSchema = z.object({
  bingoVersion: z.string(),
  protocolVersion: z.literal(1),
  sessionId: z.string(),
  displayName: z.string().default('New conversation'),
  transcriptPath: z.string(),
  resumed: z.boolean(),
  cwd: z.string(),
  provider: z.string(),
  model: z.string(),
  thinkingLevel: z.enum(['off', 'low', 'medium', 'high', 'xhigh', 'max']),
  permissionMode: z.string(),
  theme: z.enum(['auto', 'dark', 'light']),
  supportsImages: z.boolean()
})

export const cliInspectionMetadataSchema = cliSessionMetadataSchema.omit({
  sessionId: true,
  displayName: true,
  transcriptPath: true,
  resumed: true
})

const optionSchema = z.object({ id: z.string(), label: z.string(), description: z.string().optional() })

export const cliEventSchema = z.union([
  z.object({
    protocolVersion: z.literal(1),
    seq: z.literal(1),
    sessionId: z.null(),
    type: z.literal('protocol.ready'),
    bingoVersion: z.string().optional(),
    metadata: z.object({ bingoVersion: z.string(), protocolVersion: z.literal(1) }).optional()
  }).refine((event) => Boolean(event.bingoVersion || event.metadata), 'protocol.ready requires bingoVersion metadata'),
  z.object({ protocolVersion: z.literal(1), seq: z.literal(1), sessionId: z.null(), type: z.literal('inspection.ready'), metadata: cliInspectionMetadataSchema }),
  eventBase.extend({ type: z.literal('session.ready'), metadata: cliSessionMetadataSchema }),
  eventBase.extend({ type: z.literal('turn.started'), commandId: uuid, turnId: uuid }),
  eventBase.extend({ type: z.literal('text.delta'), turnId: uuid, delta: z.string() }),
  eventBase.extend({ type: z.literal('tool.ready'), turnId: uuid, toolCallId: z.string(), name: z.string(), summary: z.string() }),
  eventBase.extend({
    type: z.literal('tool.done'),
    turnId: uuid,
    toolCallId: z.string(),
    name: z.string(),
    summary: z.string(),
    status: z.enum(['done', 'error', 'interrupted']),
    output: z.string(),
    durationMs: z.number().nonnegative()
  }),
  eventBase.extend({
    type: z.literal('prompt.request'),
    turnId: uuid,
    promptId: uuid,
    kind: z.enum(['permission', 'question']),
    title: z.string(),
    question: z.string(),
    options: z.array(optionSchema),
    allowFreeText: z.boolean()
  }),
  eventBase.extend({
    type: z.literal('prompt.resolved'),
    turnId: uuid,
    promptId: uuid,
    commandId: uuid.optional(),
    reason: z.enum(['responded', 'turn-cancelled', 'session-closing'])
  }),
  eventBase.extend({
    type: z.literal('providers.result'),
    commandId: uuid,
    providers: z.array(z.object({
      name: z.string(),
      protocol: z.enum(['anthropic', 'openai']),
      apiBaseUrl: z.string(),
      supportsImages: z.boolean(),
      credentialConfigured: z.boolean(),
      builtin: z.boolean()
    }))
  }),
  eventBase.extend({ type: z.literal('models.result'), commandId: uuid, provider: z.string(), models: z.array(z.string()) }),
  eventBase.extend({ type: z.literal('warning'), turnId: uuid.optional(), code: z.string().optional(), msg: z.string() }),
  eventBase.extend({ type: z.literal('turn.completed'), turnId: uuid, outputTokens: z.number().int().nonnegative().optional() }),
  eventBase.extend({
    type: z.literal('turn.cancelled'),
    turnId: uuid,
    commandId: uuid.optional(),
    reason: z.enum(['requested', 'stdin-eof', 'session-closing'])
  }),
  eventBase.extend({ type: z.literal('session.renamed'), commandId: uuid, previousSessionId: z.string(), metadata: cliSessionMetadataSchema }),
  eventBase.extend({ type: z.literal('session.deleted'), commandId: uuid, deletedSessionId: z.string() }),
  eventBase.extend({ type: z.literal('session.closed'), commandId: uuid }),
  eventBase.extend({
    type: z.literal('error'),
    scope: z.enum(['command', 'turn', 'session']),
    commandId: uuid.optional(),
    turnId: uuid.optional(),
    code: z.string(),
    msg: z.string(),
    level: z.enum(['field', 'page', 'flow']),
    recoverable: z.boolean()
  })
])

export type ClientCommand = z.infer<typeof clientCommandSchema>
export type CliEvent = z.infer<typeof cliEventSchema>
export type CliSessionMetadata = z.infer<typeof cliSessionMetadataSchema>
export type CliInspectionMetadata = z.infer<typeof cliInspectionMetadataSchema>
export type PromptResponse = z.infer<typeof promptResponseSchema>
