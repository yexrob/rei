import { ArrowUpRight, Bot, ChevronDown, FileSearch, Folder, GitCompareArrows, Lightbulb, MessageSquare, ReiMark } from './icons'
import { useI18n } from '../i18n'

export function WelcomeHeading(): React.JSX.Element {
  const { t } = useI18n()
  return <header className="welcome-heading"><ReiMark size={22} /><h2>{t('What would you like to work on?')}</h2></header>
}

/** Heading plus the workspace the next conversation will run in. */
export function WelcomeHero({ workspaceName, workspacePath, chooseProject }: { workspaceName: string; workspacePath?: string; chooseProject?: () => void }): React.JSX.Element {
  const { t } = useI18n()
  return <div className="welcome-hero">
    <WelcomeHeading />
    <button type="button" className="welcome-workspace" onClick={chooseProject} title={workspacePath || workspaceName} aria-label={t('Workspace: {name}. Choose another folder', { name: workspaceName })}><Folder size={13} /><span>{workspaceName}</span><ChevronDown size={11} /></button>
  </div>
}

// Prompts fill the draft (never send) so the person can adjust them first.
export const WELCOME_SUGGESTIONS = [
  { label: 'Explain this project', prompt: 'Explain how this project is organized and where I should start reading.', icon: Lightbulb },
  { label: 'Find and fix a bug', prompt: 'Find and fix a bug in ', icon: FileSearch },
  { label: 'Write tests for…', prompt: 'Write tests for ', icon: Bot },
  { label: 'Review my changes', prompt: 'Review my uncommitted changes and point out problems before I commit.', icon: GitCompareArrows }
] as const

export type WelcomeRecent = { key: string; title: string; when: string; open: () => void }
export function WelcomeSuggestions({ onSuggestion, recent }: { onSuggestion: (prompt: string) => void; recent: WelcomeRecent[] }): React.JSX.Element {
  const { t } = useI18n()
  return <div className="welcome-more">
    <div className="welcome-suggestions" role="group" aria-label={t('Suggestions')}>{WELCOME_SUGGESTIONS.map(({ label, prompt, icon: Icon }) => <button type="button" key={label} className="welcome-chip" onClick={() => onSuggestion(t(prompt))}><Icon size={14} />{t(label)}</button>)}</div>
    {recent.length > 0 && <nav className="welcome-recent" aria-label={t('Recent conversations')}><h3>{t('Recent conversations')}</h3>{recent.map(item => <button type="button" key={item.key} onClick={item.open}><MessageSquare size={14} /><span>{item.title}</span><time>{item.when}</time><ArrowUpRight size={13} /></button>)}</nav>}
  </div>
}
