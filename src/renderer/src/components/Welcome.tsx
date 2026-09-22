import { ReiMark } from './icons'
import { useI18n } from '../i18n'

export function WelcomeHeading(): React.JSX.Element {
  const { t } = useI18n()
  return <header className="welcome-heading"><ReiMark size={22} /><h2>{t('What would you like to work on?')}</h2></header>
}
