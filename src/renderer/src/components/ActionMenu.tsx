import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { ReactNode } from 'react'
import { useI18n } from '../i18n'

export type MenuAction = { key: string; label: string; icon?: ReactNode; danger?: boolean; disabled?: boolean; onSelect: () => void }

/**
 * Accessible action menu (role=menu): focuses the first item, arrow keys move,
 * Escape closes and returns focus to the trigger. Labels are UI source strings.
 */
export function ActionMenu({ label, icon, items, open, onOpenChange, triggerClassName = '', align = 'end' }: { label: string; icon: ReactNode; items: MenuAction[]; open?: boolean; onOpenChange?: (open: boolean) => void; triggerClassName?: string; align?: 'start' | 'end' }): React.JSX.Element {
  const { t } = useI18n()
  return <DropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
    <DropdownMenu.Trigger asChild><button type="button" className={`icon-button ${triggerClassName}`.trim()} aria-label={t(label)} title={t(label)}>{icon}</button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className="action-menu" align={align} sideOffset={6} collisionPadding={8} loop>
      {items.map(item => <DropdownMenu.Item key={item.key} className={`action-menu-item ${item.danger ? 'danger-text' : ''}`.trim()} disabled={item.disabled} onSelect={item.onSelect}>{item.icon}<span>{t(item.label)}</span></DropdownMenu.Item>)}
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>
}
