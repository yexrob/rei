import { useEffect, useState } from 'react'
import { ArrowUpRight, Brain, Check, FolderOpen, Keyboard, Laptop, Layers, Moon, Settings2, Sun } from './icons'
import type { CatalogKind } from '../../../shared/rpc'
import { type useWorkspace, unwrap } from '../state/useWorkspace'
import { StructuredView, type OpenLink } from './Content'
import { ConfirmDialog, ErrorBanner, Modal, object } from './primitives'
import { ProviderSetup } from './ProviderSetup'
import { ModelPicker, Picker } from './Picker'
import { useI18n, type LocalePreference } from '../i18n'
import { useDisplayPath } from '../paths'
import { keyLabel, SHORTCUT_LIST, SHORTCUTS } from '../shortcuts'
import './settings.css'

type Workspace = ReturnType<typeof useWorkspace>
type CapabilityKind = CatalogKind | 'skills'
export function Settings({ workspace: w, onClose, openLink, clearDrafts, initialPage = 'general' }: { workspace: Workspace; onClose: () => void; openLink: OpenLink; clearDrafts: () => void; initialPage?: string }): React.JSX.Element {
  const { t, preference, setLocale } = useI18n()
  const [page, setPage] = useState(initialPage)
  const [addingProvider, setAddingProvider] = useState(false)
  const [catalogKind, setCatalogKind] = useState<CapabilityKind>('tools')
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const formatPath = useDisplayPath()
  const perform = (action: () => Promise<unknown>) => { setBusy(true); void action().catch(w.report).finally(() => setBusy(false)) }
  useEffect(() => { if (page === 'extensions' && w.connection.status === 'ready') void w.readCatalog(catalogKind === 'skills' ? 'commands' : catalogKind).catch(w.report) }, [page, catalogKind, w.readCatalog, w.report, w.connection.status])
  const catalogEntries = (w.catalogs[catalogKind === 'skills' ? 'commands' : catalogKind]?.entries ?? []).filter((entry) => catalogKind !== 'skills' || object(entry.meta).family === 'skill')
  return <Modal title={t('Settings')} wide onClose={onClose}><div className="settings-layout"><nav className="settings-nav" aria-label={t('Settings sections')}>{([['general', 'General', Settings2], ['models', 'Models & providers', Brain], ['extensions', 'Tools & skills', Layers], ['shortcuts', 'Keyboard shortcuts', Keyboard]] as const).map(([id, label, Icon]) => <button key={id} className={page === id ? 'selected' : ''} aria-current={page === id ? 'page' : undefined} onClick={() => { setPage(id); setFilter('') }}><Icon size={17} /><span>{t(label)}</span></button>)}</nav><div className="settings-content">
    <header className="settings-page-heading"><h3>{t(({ general: 'General', models: 'Models & providers', extensions: 'Tools & skills', shortcuts: 'Keyboard shortcuts' } as Record<string, string>)[page] ?? 'Settings')}</h3><p>{t(page === 'models' ? 'Choose how Bingo thinks. Use the providers you already trust.' : 'Make this workspace feel like yours.')}</p></header>
    {w.error && <ErrorBanner message={w.error} onDismiss={() => w.setError('')} />}
    {page === 'general' && <><h4>{t('Appearance')}</h4><div className="theme-options" role="group" aria-label={t('Appearance')}>{([['system', Laptop], ['light', Sun], ['dark', Moon]] as const).map(([theme, Icon]) => <button key={theme} aria-pressed={w.preferences?.theme === theme} className={w.preferences?.theme === theme ? 'selected' : ''} onClick={() => perform(() => w.savePreferences({ theme }))}><span className={`theme-preview theme-preview-${theme}`} aria-hidden="true"><span className="theme-preview-rail"><i /><i /><i /></span><span className="theme-preview-workspace"><i /><i /><span /></span></span><span className="theme-option-label"><Icon size={15} />{t(theme.charAt(0).toUpperCase() + theme.slice(1))}<span className="theme-option-check" aria-hidden="true">{w.preferences?.theme === theme && <Check size={13} />}</span></span></button>)}</div>
      <section className="setting-section"><h4>{t('Language')}</h4><Picker label={t('Language')} value={preference} onValueChange={(value) => setLocale(value as LocalePreference)} options={[{ value: 'system', label: t('System default') }, { value: 'en', label: 'English' }, { value: 'zh-CN', label: '简体中文' }]} /></section>
      <section className="setting-section"><h4>{t('Notifications')}</h4><label className="setting-switch"><input type="checkbox" role="switch" checked={w.preferences?.notifications !== false} disabled={busy || !w.preferences} onChange={(event) => { const notifications = event.target.checked; perform(() => w.savePreferences({ notifications })) }} /><span><strong>{t('Desktop notifications')}</strong><small>{t('Notify me when Bingo needs input or finishes a task while Rei is in the background.')}</small></span></label></section>
      <section className="setting-section"><h4>{t('Workspace')}</h4><p className="path-label" title={w.connection.workspace ?? undefined}>{w.connection.workspace ? formatPath(w.connection.workspace) : t('No folder selected')}</p><button onClick={() => perform(w.chooseWorkspace)} disabled={busy}><FolderOpen size={15} /> {t('Open another folder')}</button></section>
      <section className="setting-section"><h4>{t('bingo runtime')}</h4><p className="path-label">{w.connection.binary || w.bootstrap?.binary.path || t('Not found')}</p><p className="secondary">{w.connection.server ? t('Connected · bingo {version} · protocol {protocol}', { version: w.connection.server.version, protocol: w.connection.server.protocol }) : t('The app includes bingo. Choosing another executable is optional.')}</p><div className="button-row"><button disabled={busy} onClick={() => perform(async () => { const binary = unwrap(await window.bingoDesktop.chooseBinary()); if (binary) { await w.savePreferences({ binaryPath: binary }); if (w.connection.workspace) await w.connect(w.connection.workspace, binary) } })}>{t('Choose executable…')}</button>{w.preferences?.binaryPath && <button disabled={busy} onClick={() => perform(async () => { await w.savePreferences({ binaryPath: null }); await w.connect(w.connection.workspace || w.preferences?.workspace || undefined) })}>{t('Use default runtime')}</button>}</div></section>
      <section className="setting-section"><h4>{t('Your data stays yours')}</h4><p className="secondary">{t('bingo owns your sessions, settings and permissions. Rei stores only desktop preferences and local text drafts. Prompts and files are sent to the provider you choose. External images are not loaded automatically.')}</p><button disabled={busy} onClick={() => setConfirmClear(true)}>{t('Clear saved drafts')}</button></section>
      {confirmClear && <ConfirmDialog title={t('Clear saved drafts?')} message={<p>{t('Clear all saved text drafts? Sent messages and bingo sessions will not be changed.')}</p>} confirmLabel="Clear drafts" destructive onCancel={() => setConfirmClear(false)} onConfirm={() => { setConfirmClear(false); clearDrafts(); w.setNotice(t('Saved text drafts cleared.')) }} />}
    </>}
    {page === 'models' && addingProvider && <ProviderSetup workspace={w} onDone={() => setAddingProvider(false)} />}
    {page === 'models' && !addingProvider && <><section className="settings-model-row"><div><h4>{t('Conversation model')}</h4><p className="secondary">{t('Choose the model for the current conversation or unsent draft.')}</p></div><ModelPicker value={w.runtimeSelection.model ?? ''} models={w.catalogs.models?.entries ?? []} disabled={busy || w.connection.status !== 'ready'} onValueChange={(value) => perform(() => w.runAction('model', value))} /></section>
      <section className="setting-section settings-reasoning"><div><h4>{t('Reasoning effort')}</h4><p className="secondary">{t('Control how long the model reasons. Availability depends on your provider.')}</p></div><Picker label={t('Thinking effort')} disabled={busy || w.connection.status !== 'ready'} value={w.runtimeSelection.thinking?.toLowerCase() ?? ''} placeholder={t('Default thinking')} onValueChange={(value) => perform(() => w.runAction('think', value))} options={(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const).map((value, index) => ({ value, label: t(['Off', 'Minimal', 'Low', 'Medium', 'High', 'Extra high', 'Maximum'][index]) }))} /></section>
      <CustomModel key={w.runtimeSelection.model ?? ''} workspace={w} busy={busy} perform={perform} />
      <p className="secondary settings-model-note">{t('New-conversation choices apply when you send. Changes to an existing session are saved by bingo. Credentials stay in bingo’s credential store.')}</p>
      <section className="setting-section"><h4>{t('Connected providers')}</h4>{w.catalogs.providers?.entries.length ? w.catalogs.providers.entries.map((entry) => { const auth = object(object(entry.meta).auth); return <div className="provider-row" key={entry.id}><div><strong>{entry.label}</strong><small>{t(auth.kind === 'ready' ? 'Ready' : auth.kind === 'notApplicable' ? 'No sign-in required' : auth.kind === 'expired' ? 'Sign-in expired' : auth.kind === 'missing' ? 'Not connected' : 'Status unavailable')}{typeof auth.hint === 'string' ? ` · ${auth.hint}` : ''}</small></div>{auth.kind !== 'notApplicable' && <button disabled={busy} onClick={() => { onClose(); void w.signIn(entry.id).catch(w.report) }}>{t(auth.kind === 'ready' ? 'Sign in again' : 'Sign in')}<ArrowUpRight size={13} /></button>}</div> }) : <p className="secondary">{t('Connect to bingo to discover available providers.')}</p>}<div className="button-row"><button disabled={busy || !w.connection.workspace} onClick={() => setAddingProvider(true)}>{t('Add API provider')}</button><button disabled={busy} onClick={() => perform(() => w.readCatalog('providers'))}>{t('Refresh status')}</button></div></section>
    </>}
    {page === 'extensions' && <><h4>{t('Available capabilities')}</h4><p className="secondary">{t('Discovered from the connected runtime, including project and user configuration.')}</p><div className="catalog-toolbar"><Picker label={t('Capability type')} value={catalogKind} onValueChange={(value) => setCatalogKind(value as CapabilityKind)} options={[{ value: 'tools', label: t('Tools') }, { value: 'skills', label: t('Skills') }, { value: 'commands', label: t('Commands') }, { value: 'plugins', label: t('Plugins') }]} /><input aria-label={t('Filter capabilities')} value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={t('Filter…')} /></div><div className="catalog-list">{catalogEntries.filter((entry) => `${entry.label} ${entry.id}`.toLowerCase().includes(filter.toLowerCase())).map((entry) => <details key={entry.id}><summary>{entry.label}<span>{entry.id}</span></summary><p>{String(object(entry.meta).description ?? object(entry.meta).hint ?? t('Provided by the bingo runtime.'))}</p></details>)}{!catalogEntries.length && <p className="secondary">{t(`No ${catalogKind} are available.`)}</p>}</div></>}
    {page === 'shortcuts' && <><h4>{t('Keep your hands on the keyboard')}</h4><dl className="shortcuts">{SHORTCUT_LIST.map(([label, id]) => <div key={id}><dt>{t(label)}</dt><dd><kbd>{keyLabel(w.bootstrap?.platform ?? 'unknown', SHORTCUTS[id])}</kbd></dd></div>)}</dl><p className="secondary"><Keyboard size={14} /> {t('Native edit, select-all, copy, paste and window shortcuts work as expected.')}</p></>}
    {w.commandView && <section className="settings-result"><StructuredView view={w.commandView} openLink={openLink} runAction={(action) => perform(() => w.runAction(action.name, action.args))} /></section>}
  </div></div></Modal>
}

function CustomModel({ workspace: w, busy, perform }: { workspace: Workspace; busy: boolean; perform: (action: () => Promise<unknown>) => void }): React.JSX.Element {
  const { t } = useI18n()
  const providers = w.catalogs.providers?.entries ?? []
  const providerIds = [...new Set([...providers.map((entry) => entry.id), ...(w.active?.snapshot.summary.provider ? [w.active.snapshot.summary.provider] : [])])].sort((a, b) => b.length - a.length)
  const current = w.runtimeSelection.model ?? ''
  const initialProvider = providerIds.find((id) => current.startsWith(`${id}/`)) ?? ''
  const [provider, setProvider] = useState(initialProvider)
  const [model, setModel] = useState(initialProvider ? current.slice(initialProvider.length + 1) : current)
  const trimmed = model.trim()
  const qualifiedProvider = providerIds.find((id) => trimmed.startsWith(`${id}/`))
  const mismatch = Boolean(provider && qualifiedProvider && provider !== qualifiedProvider)
  const identity = qualifiedProvider ? trimmed : provider ? `${provider}/${trimmed}` : trimmed
  return <details className="settings-custom-model"><summary>{t('Custom model')}</summary><p className="secondary">{t('Use an exact model ID when it is not listed. Changing providers clears the previous model ID.')}</p><div className="field-label"><span>{t('Provider')}</span><Picker label={t('Provider')} value={provider} onValueChange={(value) => { setProvider(value); setModel('') }} options={[{ value: '', label: t('Use configured provider') }, ...providers.map((entry) => ({ value: entry.id, label: entry.label }))]} /></div><label className="field-label">{t('Provider model ID')}<input value={model} onChange={(event) => setModel(event.target.value)} placeholder={t('Provider model ID')} aria-invalid={mismatch || undefined} aria-describedby={mismatch ? 'custom-model-conflict' : undefined} /></label>{mismatch && <p className="secondary" id="custom-model-conflict" role="alert">{t('This ID names another provider. Choose the matching provider or enter an unqualified model ID.')}</p>}<button disabled={busy || !trimmed || mismatch || w.connection.status !== 'ready'} onClick={() => perform(() => w.runAction('model', identity))}>{t('Use this model')}</button></details>
}

export function Onboarding({ workspace: w, openLink }: { workspace: Workspace; openLink: OpenLink }): React.JSX.Element {
  const { t } = useI18n()
  const hasBinary = Boolean(w.connection.binary || w.bootstrap?.binary.path)
  const connecting = w.connection.status === 'connecting' || w.loading
  const chooseRuntime = async () => {
    const workspace = w.preview ? w.connection.workspace ?? undefined : w.preferences?.workspace ?? undefined
    const binary = unwrap(await window.bingoDesktop.chooseBinary())
    if (!binary) return
    await w.savePreferences({ binaryPath: binary })
    await w.connect(workspace, binary)
  }
  return <div className="onboarding"><h1>{t(connecting ? 'Opening your space' : 'Connect bingo')}</h1><p className="onboarding-description">{t('Rei uses its included bingo runtime by default. You can choose another executable if needed.')}</p><div className="button-row onboarding-actions">{hasBinary && <button className="primary" disabled={connecting} onClick={() => void w.reconnect().catch(w.report)}>{t(connecting ? 'Connecting…' : 'Reconnect')}</button>}<button disabled={connecting} onClick={() => { void chooseRuntime().catch(w.report) }}>{t('Choose executable')}</button></div><p className="onboarding-note">{t('Conversations use a private temporary folder until you attach a project.')}</p><button className="text-button" onClick={() => openLink('https://github.com/yexrob/bingo')}>{t('Runtime setup help')} <ArrowUpRight size={13} /></button></div>
}
