import { app } from 'electron'

export type MainLocale = 'en' | 'zh-CN'
// Native dialog strings only. English source text is the key and the fallback.
const zhCN: Record<string, string> = {
  'Cancel': '取消',
  'Delete conversation?': '删除对话？',
  'Delete this conversation permanently?': '要永久删除此对话吗？',
  'Its saved history will be deleted by bingo. This cannot be undone.': 'bingo 将删除其已保存的历史记录。此操作无法撤销。',
  'Delete conversation': '删除对话',
  'Add provider': '添加提供商',
  'Add provider “{name}”?': '添加提供商“{name}”？',
  'bingo will save this {protocol}-compatible endpoint to its user settings and the optional key to its credential store. The key is sent only to the native CLI over stdin, never to a session.': 'bingo 会将此 {protocol} 兼容端点保存到用户设置，并将可选密钥保存到其凭据存储。密钥只通过 stdin 发送给本地 CLI，绝不会发送到会话。',
  'Endpoint: {endpoint}': '端点：{endpoint}',
  'Protocol default': '协议默认值',
  'All connected project runtimes will disconnect. Reconnect each project after setup.': '所有已连接的项目运行时都将断开。设置完成后请重新连接各个项目。',
  'Warning: this endpoint uses unencrypted HTTP.': '警告：此端点使用未加密的 HTTP。',
  'Save provider': '保存提供商',
  'Running work': '正在运行的工作',
  'Keep working': '继续工作',
  'Stop and continue': '停止并继续',
  'Reconnect this project?': '要重新连接此项目吗？',
  'Only work in this project runtime will stop. Other projects will keep running.': '只有此项目运行时中的工作会停止，其他项目将继续运行。',
  'Quit Rei and stop running work?': '要退出 Rei 并停止正在运行的工作吗？',
  'Active turns, tools and the local terminal will stop. An in-progress provider save will finish before quitting; an unfinished raw JSON export will be cancelled without replacing its chosen file. Saved history remains in bingo.': '正在进行的回合、工具和本地终端将停止。进行中的提供商保存会在退出前完成；未完成的原始 JSON 导出将被取消，且不会替换所选文件。已保存的历史记录仍保留在 bingo 中。',
  'The conversation window stopped.': '对话窗口已停止。',
  'The native runtime has been disconnected. Reload the window and reconnect to recover saved history.': '本地运行时已断开。请重新加载窗口并重新连接以恢复已保存的历史记录。',
  'Reload': '重新加载',
  'Quit': '退出'
}

/** Mirrors the renderer's system default: any zh* system language selects Simplified Chinese. */
export function localeFor(languages: readonly string[]): MainLocale {
  return /^zh(?:[-_]|$)/i.test(languages[0] ?? '') ? 'zh-CN' : 'en'
}

export function systemLocale(): MainLocale {
  try {
    const preferred = typeof app.getPreferredSystemLanguages === 'function' ? app.getPreferredSystemLanguages() : []
    return localeFor(preferred.length ? preferred : typeof app.getLocale === 'function' ? [app.getLocale()] : [])
  } catch { return 'en' }
}

export function text(source: string, vars?: Record<string, string>, locale: MainLocale = systemLocale()): string {
  const value = locale === 'zh-CN' && Object.hasOwn(zhCN, source) ? zhCN[source] : source
  return vars ? value.replace(/\{(\w+)\}/g, (placeholder, key: string) => Object.hasOwn(vars, key) ? vars[key] : placeholder) : value
}
