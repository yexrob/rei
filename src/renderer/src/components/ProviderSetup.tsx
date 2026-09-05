import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { unwrap, type useWorkspace } from '../state/useWorkspace'
import { useI18n } from '../i18n'
import { Picker } from './Picker'

export function ProviderSetup({ workspace: w, onDone }: { workspace: ReturnType<typeof useWorkspace>; onDone: () => void }): React.JSX.Element {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [protocol, setProtocol] = useState<'openai' | 'anthropic'>('openai')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <form className="provider-setup" onSubmit={(event) => {
    event.preventDefault(); setBusy(true); setError('')
    const directory = w.connection.workspace || w.preferences?.workspace
    void window.bingoDesktop.configureProvider({ name: name.trim(), protocol, baseUrl: baseUrl.trim(), apiKey }).then(unwrap).then(async () => {
      setApiKey('')
      if (directory) await w.connect(directory)
      w.setNotice(t('Provider saved securely. Select its model to start a session.'))
      onDone()
    }).catch((error) => setError(error instanceof Error ? error.message : t('The operation could not be completed. Try again.'))).finally(() => { setApiKey(''); setBusy(false) })
  }}><div className="setup-title"><KeyRound size={17} /><h3>{t('Add an API provider')}</h3></div><p className="secondary">{t('The native bingo setup stores your key in its credential store, never in a conversation. You will confirm the endpoint and settings change before anything is saved.')}</p><label className="field-label">{t('Provider name')}<input required maxLength={80} autoComplete="off" placeholder="my-provider" value={name} onChange={(event) => setName(event.target.value)} /></label><div className="field-label"><span>{t('API protocol')}</span><Picker label={t('API protocol')} value={protocol} onValueChange={(value) => setProtocol(value as 'openai' | 'anthropic')} options={[{ value: 'openai', label: t('OpenAI-compatible') }, { value: 'anthropic', label: t('Anthropic-compatible') }]} /></div><label className="field-label">{t('Base URL')}<input type="url" autoComplete="off" placeholder={protocol === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com'} value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /></label><label className="field-label">{t('API key')}<input type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={t('Stored by bingo, not Rei')} /></label><p className="secondary">{t('Saving restarts an idle runtime. Finish or stop active work first. Leave the URL blank to use bingo’s default endpoint.')}</p>{error && <p className="field-error" role="alert">{error}</p>}<div className="button-row"><button type="button" disabled={busy} onClick={onDone}>{t('Cancel')}</button><button type="submit" className="primary" disabled={busy || !name.trim()}>{t(busy ? 'Saving securely…' : 'Save provider')}</button></div></form>
}
