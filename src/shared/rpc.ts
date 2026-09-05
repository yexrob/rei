// Generated from bingo-improve/schema/rpc.json; do not edit.
// SHA-256: d90a354bee2f1090918356a3d59450b96e80df205c060b39f13235a5d826cd21
export const RPC_PROTOCOL = 1 as const

export type Action = { "name": string; "args"?: unknown }

export type ActionItem = { "label": string; "action": Action; "key"?: (string | null) }

export type Activation = "keyboard" | "pointer" | "programmatic"

export type Answer = ({ "kind": "allowOnce" } | { "scope": string; "kind": "allowSession" } | { "feedback"?: (string | null); "kind": "deny" } | { "ids": Array<string>; "other"?: (string | null); "kind": "choice" } | { "text": string; "kind": "text" } | { "kind": "confirm" } | { "kind": "cancel" } | { "answers": Array<Answer>; "kind": "form" })

export type AnswerParams = { "session": SessionId; "intent": IntentId; "interaction": InteractionId; "answer": Answer; "activation": Activation }

export type AnswerRole = ("allowing" | "refusing")

export type AnswerSpec = "allowOnce" | "allowSession" | "deny" | "choice" | "text" | "confirm" | "cancel" | "form"

export type CancelReason = ("turnEnded" | "interrupted" | "sessionClosed" | "expired" | "superseded" | "commandEnded")

export type Capabilities = { "methods": Array<string>; "notifications": Array<string> }

export type Catalog = { "kind": CatalogKind; "entries": Array<CatalogEntry> }

export type CatalogEntry = { "id": string; "label": string; "meta"?: unknown }

export type CatalogKind = "models" | "providers" | "tools" | "commands" | "skills" | "plugins"

export type CatalogParams = { "kind": CatalogKind }

export type ClientIdentity = { "name": string; "surface": string }

export type CloseReason = ({ "kind": "client" } | { "kind": "shutdown" } | { "kind": "deleted" } | { "message": string; "kind": "error" })

export type ConfigView = { "kernel"?: unknown; "plugins"?: Record<string, unknown> }

export type ContentPart = ({ "text": string; "type": "text" } | (Image & { "type": "image" }) | { "id": string; "name": string; "input": unknown; "type": "toolUse" } | { "toolUseId": string; "parts": Array<ContentPart>; "isError"?: boolean; "type": "toolResult" } | { "text": string; "providerMetadata"?: Record<string, Record<string, unknown>>; "type": "reasoning" })

export type ContextUsage = { "used": number; "window": number; "trigger": number }

export type DecisionKind = "allow" | "allowSession" | "deny"

export type DeliverParams = { "session": SessionId; "intent": IntentId; "input": Input; "delivery": Delivery }

export type Delivery = ("wake" | "hold")

export type DeltaKind = ("text" | "reasoning" | "tail")

export type Driver = ("model" | "log")

export type Empty = Record<string, unknown>

export type ErrorCode = ("SESSION_NOT_FOUND" | "SESSION_LOCKED" | "SESSION_CLOSED" | "INTERACTION_CLOSED" | "NOT_READY" | "STALE_GENERATION" | "NOT_INITIALIZED" | "INVALID_INPUT" | "PERMISSION_DENIED" | "TOOL_NOT_FOUND" | "TOOL_FAILED" | "PROVIDER_UNAVAILABLE" | "AUTH_REQUIRED" | "RATE_LIMITED" | "CONTEXT_OVERFLOW" | "TIMEOUT" | "OFFLINE" | "SERVER_ERROR" | "TURN_LOST" | "TURN_BUDGET_EXHAUSTED" | "INTERNAL" | "NOT_FOUND" | "STORAGE")

export type Event = ({ "summary": SessionSummary; "type": "sessionUpdated" } | { "reason": CloseReason; "type": "sessionClosed" } | { "turn": TurnId; "inputs": Array<ItemId>; "origin": TurnOrigin; "type": "turnStarted" } | { "turn": TurnId; "attempt": number; "max": number; "delayMs": number; "dropped": Array<ItemId>; "reason": string; "type": "turnRetrying" } | { "turn": TurnId; "usage": Usage; "context": ContextUsage; "type": "turnUsage" } | { "turn": TurnId; "status": TurnStatus; "usage": Usage; "type": "turnCompleted" } | { "item": Item; "type": "itemStarted" } | { "item": ItemId; "n": number; "kind": DeltaKind; "data": string; "type": "itemDelta" } | { "item": Item; "type": "itemUpdated" } | { "item": Item; "type": "itemCompleted" } | { "revision": number; "entries": Array<QueueEntry>; "type": "queueChanged" } | { "interaction": Interaction; "type": "interactionOpened" } | { "id": InteractionId; "answer": Answer; "by": ResolvedBy; "type": "interactionResolved" } | { "id": InteractionId; "reason": CancelReason; "type": "interactionCancelled" } | { "intent": IntentId; "outcome": IntentOutcome; "type": "intentAck" } | { "generation": number; "boundary": ItemId; "summary": ItemId; "kept": Array<ItemId>; "type": "compacted" } | { "generation": number; "toTurn": TurnId; "dropped": Array<ItemId>; "filesRestored": Array<string>; "type": "rewound" } | { "config": ConfigView; "type": "configChanged" } | { "kind": string; "type": "catalogChanged" } | { "level": Level; "code": string; "text": string; "type": "notice" } | { "plugin": string; "kind": string; "payload": unknown; "type": "extension" } | { "plugin": string; "kind": string; "payload": unknown; "type": "signal" } | { "from": Seq; "to": Seq; "type": "lagged" })

export type EventParams = { "seq": Seq; "ts": string; "session": SessionId; "cause"?: (IntentId | null); "event": Event; "root"?: (SessionId | null) }

export type EventsParams = { "session": SessionId; "since"?: Seq }

export type ExtendParams = { "session": SessionId; "plugin": string; "kind": string; "payload": unknown }

export type GatewayEvent = ({ "summary": SessionSummary; "type": "sessionCreated" } | { "session": SessionId; "type": "sessionRemoved" } | { "kind": CatalogKind; "type": "catalogChanged" })

export type HistoryChunk = { "items": Array<Item>; "next"?: (ItemId | null); "generation": number }

export type HistoryPage = { "before"?: (ItemId | null); "limit"?: number }

export type HistoryParams = { "session": SessionId; "page"?: HistoryPage }

export type Image = { "mediaType": string; "data": string }

export type InitializeParams = { "client": ClientIdentity; "protocol": number }

export type InitializeResult = { "protocol": number; "name": string; "version": string; "capabilities": Capabilities }

export type Input = ({ "text": string; "images"?: Array<Image>; "origin": Origin; "delivery"?: Delivery; "kind": "text" } | { "action": Action; "kind": "action" })

export type IntentId = string

export type IntentOutcome = ({ "turn": TurnId; "kind": "turnStarted" } | { "position": number; "kind": "queued" } | { "result": unknown; "kind": "applied" } | { "error": KernelError; "kind": "rejected" })

export type Interaction = { "id": InteractionId; "session": SessionId; "turn"?: (TurnId | null); "item"?: (ItemId | null); "openedAt": string; "guardUntil"?: (string | null); "expiresAt"?: (string | null); "kind": InteractionKind; "answers": Array<AnswerSpec> }

export type InteractionId = string

export type InteractionKind = ({ "tool": string; "summary": string; "preview"?: (Preview | null); "sessionScope"?: (string | null); "kind": "permission" } | (Question & { "kind": "question" }) | { "title"?: (string | null); "questions": Array<Question>; "kind": "form" } | { "title": string; "detail": string; "kind": "confirm" } | { "provider": string; "flow": LoginFlow; "kind": "login" })

export type InterruptParams = { "session": SessionId; "intent": IntentId; "scope": InterruptScope }

export type InterruptReason = "userCancel" | "newInput" | "shutdown" | "budget"

export type InterruptScope = ({ "turn": TurnId; "kind": "turn" } | { "kind": "head" })

export type Item = { "id": ItemId; "turn"?: (TurnId | null); "round"?: number; "status": ItemStatus; "startedAt": string; "completedAt"?: (string | null); "intent"?: (IntentId | null); "body": ItemBody; "meta"?: Record<string, unknown> }

export type ItemBody = ({ "parts": Array<ContentPart>; "origin": Origin; "kind": "user" } | { "text": string; "kind": "assistant" } | { "text": string; "providerMetadata"?: Record<string, Record<string, unknown>>; "kind": "reasoning" } | { "callId": string; "name": string; "input": unknown; "output"?: (ToolOutput | null); "progress"?: (string | null); "durationMs"?: (number | null); "kind": "toolCall" } | { "command": string; "output": string; "exit"?: (number | null); "cwd": string; "kind": "shell" } | { "name": string; "args"?: unknown; "result"?: unknown; "kind": "action" } | { "summary": string; "replaced": number; "before": number; "after": number; "durationMs": number; "kind": "compaction" } | { "toTurn": TurnId; "dropped": number; "kind": "rewind" } | { "marker": string; "kind": "interruption" } | { "level": Level; "code": string; "text": string; "kind": "notice" } | { "interaction": InteractionId; "question": string; "answer": string; "kind": "questionAnswer" } | { "interaction": InteractionId; "tool": string; "decision": DecisionKind; "feedback"?: (string | null); "kind": "permissionReceipt" } | { "asset": string; "label"?: (string | null); "kind": "asset" })

export type ItemId = string

export type ItemStatus = "pending" | "running" | "completed" | "failed" | "interrupted"

export type KernelError = { "code": ErrorCode; "message": string }

export type Level = "info" | "warn" | "error"

export type ListParams = { "filter"?: SessionFilter }

export type ListResult = { "sessions": Array<SessionSummary> }

export type LiveTurn = { "id": TurnId; "startedAt": string; "origin": TurnOrigin; "round"?: number; "usage"?: Usage; "retrying"?: (Retry | null) }

export type LoginFlow = ({ "url": string; "kind": "browser" } | { "url": string; "code": string; "kind": "device" } | { "kind": "paste" })

export type OpenOptions = { "children"?: boolean }

export type OpenParams = { "selector": SessionSelector; "options"?: OpenOptions }

export type OpenResult = { "session": SessionId; "snapshot": SessionState }

export type Origin = { "surface": string; "principal"?: (string | null); "conversation"?: (string | null) }

export type ParentLink = { "session": SessionId; "item"?: (ItemId | null) }

export type Preview = ({ "unified": string; "kind": "diff" } | { "command": string; "cwd": string; "kind": "command" } | { "url": string; "kind": "url" })

export type Question = { "question": string; "header"?: (string | null); "options": Array<QuestionOption>; "freeText"?: boolean; "multi"?: boolean }

export type QuestionOption = { "id": string; "label": string; "description"?: (string | null); "role"?: (AnswerRole | null); "preview"?: (string | null) }

export type QueueEntry = { "intent": IntentId; "position": number; "preview": string; "steerable": boolean; "origin": Origin }

export type ResolvedBy = ({ "name": string; "surface": string; "kind": "client" } | { "kind": "kernel" } | { "kind": "policy" })

export type Retry = { "attempt": number; "max": number }

export type Seq = number

export type SessionFilter = { "cwd"?: (string | null); "parent"?: (SessionId | null); "limit"?: (number | null) }

export type SessionId = string

export type SessionParams = { "session": SessionId }

export type SessionSelector = ({ "spec": SessionSpec; "kind": "create" } | { "id": SessionId; "kind": "byId" } | { "key": string; "kind": "byKey" } | { "cwd": string; "kind": "latest" })

export type SessionSpec = { "cwd": string; "key"?: (string | null); "parent"?: (ParentLink | null); "title"?: (string | null); "driver"?: Driver; "provider"?: (string | null); "model"?: (string | null); "systemExtra"?: (string | null); "tools"?: (Array<string> | null) }

export type SessionState = { "seq": Seq; "summary": SessionSummary; "config"?: ConfigView; "historyGeneration"?: number; "items": Array<Item>; "turn"?: (LiveTurn | null); "queue"?: Array<QueueEntry>; "interactions"?: Array<Interaction>; "context"?: (ContextUsage | null); "lastTurn"?: (TurnStatus | null); "unread"?: boolean; "closed"?: boolean; "extensions"?: Record<string, Record<string, unknown>>; "signals"?: Record<string, Record<string, unknown>> }

export type SessionSummary = { "id": SessionId; "key"?: (string | null); "title"?: (string | null); "cwd": string; "parent"?: (ParentLink | null); "driver"?: Driver; "model"?: (string | null); "systemExtra"?: (string | null); "tools"?: (Array<string> | null); "provider"?: (string | null); "createdAt": string; "updatedAt": string; "usage"?: Usage; "busy"?: boolean; "messages"?: (number | null) }

export type SignalParams = { "session": SessionId; "plugin": string; "kind": string; "payload": unknown }

export type SubmitParams = { "session": SessionId; "intent": IntentId; "input": Input }

export type Tone = ("neutral" | "good" | "bad" | "attention")

export type ToolOutput = { "parts": Array<ContentPart>; "isError"?: boolean; "display"?: (View | null) }

export type TreeNode = { "label": string; "badge"?: (string | null); "tone"?: Tone; "children"?: Array<TreeNode> }

export type TurnId = string

export type TurnOrigin = ("submit" | "queue" | "peer" | "auto")

export type TurnStatus = ({ "kind": "completed" } | { "error": KernelError; "kind": "failed" } | { "reason": InterruptReason; "kind": "interrupted" })

export type Usage = { "inputTokens": number; "outputTokens": number; "cacheReadTokens"?: number; "cacheWriteTokens"?: number; "reasoningTokens"?: number }

export type View = ({ "text": string; "kind": "text" } | { "text": string; "kind": "markdown" } | { "lang"?: (string | null); "text": string; "kind": "code" } | { "unified": string; "kind": "diff" } | { "items": Array<string>; "kind": "list" } | { "headers": Array<string>; "rows": Array<Array<string>>; "kind": "table" } | { "rows": Array<[string, string]>; "kind": "keyValue" } | { "value": number; "total"?: (number | null); "label"?: (string | null); "kind": "progress" } | { "text": string; "tone"?: Tone; "kind": "badge" } | { "nodes": Array<TreeNode>; "kind": "tree" } | { "children": Array<View>; "kind": "stack" } | { "children": Array<View>; "kind": "columns" } | { "title": string; "child": View; "kind": "panel" } | { "items": Array<ActionItem>; "kind": "actions" } | { "customKind": string; "data": unknown; "fold": string; "kind": "custom" })

export type Frame = EventParams

export interface RpcMethods {
  "initialize": { params: InitializeParams; result: InitializeResult }
  "shutdown": { params: Empty; result: Empty }
  "session/list": { params: ListParams; result: ListResult }
  "session/open": { params: OpenParams; result: OpenResult }
  "session/close": { params: SessionParams; result: Empty }
  "session/delete": { params: SessionParams; result: Empty }
  "session/deliver": { params: DeliverParams; result: Empty }
  "session/extend": { params: ExtendParams; result: Empty }
  "session/signal": { params: SignalParams; result: Empty }
  "session/history": { params: HistoryParams; result: HistoryChunk }
  "session/events": { params: EventsParams; result: Empty }
  "session/submit": { params: SubmitParams; result: Empty }
  "session/interrupt": { params: InterruptParams; result: Empty }
  "session/answer": { params: AnswerParams; result: Empty }
  "catalog/read": { params: CatalogParams; result: Catalog }
  "gateway/subscribe": { params: Empty; result: Empty }
}
export type RpcMethod = keyof RpcMethods
