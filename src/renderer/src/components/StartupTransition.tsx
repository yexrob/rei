import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../i18n'

type Phase = 'intro' | 'revealing' | 'settled'

export function StartupTransition({ ready, children }: { ready: boolean; children: ReactNode }): React.JSX.Element {
  const { t } = useI18n()
  const [phase, setPhase] = useState<Phase>(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'settled' : 'intro')
  const started = useRef(performance.now())
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const reduce = () => { if (media.matches) setPhase('settled') }
    media.addEventListener('change', reduce)
    return () => media.removeEventListener('change', reduce)
  }, [])
  useEffect(() => {
    if (phase !== 'intro') return
    const elapsed = performance.now() - started.current
    const wait = ready ? Math.max(0, 380 - elapsed) : Math.max(0, 1800 - elapsed)
    const timer = setTimeout(() => setPhase('revealing'), wait)
    return () => clearTimeout(timer)
  }, [ready, phase])
  useEffect(() => {
    if (phase !== 'revealing') return
    const timer = setTimeout(() => setPhase('settled'), 650)
    return () => clearTimeout(timer)
  }, [phase])
  return <div className="startup-stage" data-phase={phase}>
    <div className="startup-content" inert={phase === 'intro'}>{children}</div>
    {phase !== 'settled' && <div className="startup-prelude" aria-hidden={phase === 'revealing'}>
      <div className="startup-identity"><span className="startup-seal" aria-hidden="true">b.</span><span className="startup-wordmark">bingo</span><span className="startup-status" role="status">{t('Opening your space')}</span></div>
      {phase === 'intro' && <button className="startup-skip" onClick={() => setPhase('settled')}>{t('Skip intro')}</button>}
    </div>}
  </div>
}
