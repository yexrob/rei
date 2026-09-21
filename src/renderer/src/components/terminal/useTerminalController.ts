import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { emptyTerminalSnapshot, TerminalController } from './terminal-controller'
import { createTerminalView } from './terminal-view'

export function useTerminalController(visible: boolean, onClose: () => void) {
  const { t } = useI18n()
  const host = useRef<HTMLDivElement>(null)
  const controller = useRef<TerminalController | null>(null)
  const [state, setState] = useState(emptyTerminalSnapshot)
  const close = useRef(onClose)
  const inputLabel = useRef(t('Terminal input'))
  close.current = onClose
  inputLabel.current = t('Terminal input')
  useEffect(() => {
    const api = window.bingoPanels, element = host.current
    if (!api || !element) return
    const current = new TerminalController(api, (id, handlers) => createTerminalView(element, id, handlers, inputLabel.current), setState, () => close.current())
    controller.current = current
    current.connect()
    return () => { current.dispose(); controller.current = null }
  }, [])
  useEffect(() => { controller.current?.setVisible(visible) }, [visible])
  useEffect(() => {
    host.current?.querySelectorAll('textarea').forEach((textarea) => textarea.setAttribute('aria-label', t('Terminal input')))
  }, [t, state.tabs.length])
  return { host, controller, state }
}
