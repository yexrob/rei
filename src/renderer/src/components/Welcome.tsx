import { ArrowUpRight, BookOpen, Layers, ListTodo, ReiMark } from './icons'
import { useI18n } from '../i18n'

const starters = [
  { icon: BookOpen, title: 'Understand code', prompt: 'Help me understand a codebase. Ask me which project or code I want to explore first.' },
  { icon: Layers, title: 'Explore an idea', prompt: 'Help me explore an idea. Start by asking what I have in mind, then help me shape it.' },
  { icon: ListTodo, title: 'Make a plan', prompt: 'Help me turn a goal into an actionable plan. Ask me about the goal and constraints first.' }
] as const

export function WelcomeHeading(): React.JSX.Element {
  const { t } = useI18n()
  return <header className="welcome-heading">
    <div className="welcome-identity" aria-hidden="true"><ReiMark size={36} /><span>Rei</span><span className="welcome-rule" /></div>
    <h2>{t('A little space. A lot of possibility.')}</h2>
    <p>{t('Bring a question, an idea, or something to make.')}</p>
  </header>
}

export function PromptStarters({ onChoose, disabled }: { onChoose: (text: string) => void; disabled?: boolean }): React.JSX.Element {
  const { t } = useI18n()
  return <div className="prompt-starters" role="group" aria-label={t('Starting points')}>
    {starters.map(({ icon: Icon, title, prompt }) => <button key={title} type="button" onClick={() => onChoose(t(prompt))} disabled={disabled}>
      <Icon size={17} /><span>{t(title)}</span><ArrowUpRight size={12} className="starter-arrow" />
    </button>)}
  </div>
}
