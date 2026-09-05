import { useRef, useState, type ReactNode } from 'react'
import * as Select from '@radix-ui/react-select'
import * as Popover from '@radix-ui/react-popover'
import { Command } from 'cmdk'
import { Check, ChevronDown, ChevronUp, Search } from 'lucide-react'
import type { CatalogEntry } from '../../../shared/rpc'
import { number, object } from './primitives'
import { useI18n } from '../i18n'

export type PickerOption = { value: string; label: string; detail?: string; disabled?: boolean }
type Common = { label: string; value: string; disabled?: boolean; onValueChange: (value: string) => void; compact?: boolean; icon?: ReactNode; side?: 'top' | 'bottom' }
const EMPTY = '__rei_unselected__'

export function Picker({ label, value, options, onValueChange, disabled, compact, icon, side = 'bottom', placeholder }: Common & { options: PickerOption[]; placeholder?: string }): React.JSX.Element {
  const { t } = useI18n()
  const trigger = useRef<HTMLButtonElement>(null)
  const [portal, setPortal] = useState<HTMLElement | null>(null)
  const selected = options.find((option) => option.value === value)
  return <Select.Root value={value || EMPTY} onValueChange={(next) => onValueChange(next === EMPTY ? '' : next)} disabled={disabled} onOpenChange={(open) => { if (open) setPortal(trigger.current?.closest('dialog') ?? null) }}>
    <Select.Trigger ref={trigger} className={`picker-trigger ${compact ? 'compact' : 'field-picker'}`} aria-label={label} title={selected?.detail}>
      {icon}<Select.Value>{selected?.label ?? placeholder ?? t('Choose…')}</Select.Value><Select.Icon><ChevronDown size={12} /></Select.Icon>
    </Select.Trigger>
    <Select.Portal container={portal ?? undefined}><Select.Content className="picker-content" position="popper" side={side} sideOffset={7} align="start" collisionPadding={12}>
      <Select.ScrollUpButton className="picker-scroll"><ChevronUp size={14} /></Select.ScrollUpButton>
      <Select.Viewport className="picker-viewport"><Select.Group><Select.Label className="picker-label">{label}</Select.Label>{options.map((option) => <Select.Item key={option.value} className="picker-option" value={option.value || EMPTY} disabled={option.disabled} textValue={option.label}>
        <span className="picker-option-copy"><Select.ItemText>{option.label}</Select.ItemText>{option.detail && <span className="picker-option-detail">{option.detail}</span>}</span><Select.ItemIndicator className="picker-check"><Check size={14} /></Select.ItemIndicator>
      </Select.Item>)}</Select.Group></Select.Viewport>
      <Select.ScrollDownButton className="picker-scroll"><ChevronDown size={14} /></Select.ScrollDownButton>
    </Select.Content></Select.Portal>
  </Select.Root>
}

export function ModelPicker({ value, models, onValueChange, disabled, compact = true, side = 'top' }: Omit<Common, 'label'> & { models: CatalogEntry[] }): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [portal, setPortal] = useState<HTMLElement | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const selected = models.find((entry) => entry.id === value)
  const currentLabel = selected?.label || (value.includes('/') ? value.slice(value.indexOf('/') + 1) : value) || t('Choose model')
  const entries = value && !selected ? [{ id: value, label: currentLabel }, ...models] : models
  const groups = new Map<string, CatalogEntry[]>()
  for (const entry of entries) {
    const provider = String(object(entry.meta).provider ?? entry.id.split('/')[0])
    groups.set(provider, [...groups.get(provider) ?? [], entry])
  }
  return <Popover.Root open={open} onOpenChange={(next) => { if (next) setPortal(trigger.current?.closest('dialog') ?? null); setOpen(next) }}>
    <Popover.Trigger asChild><button ref={trigger} type="button" className={`picker-trigger model-picker-trigger ${compact ? 'compact' : 'field-picker'}`} aria-label={t('Model')} title={value || t('Choose the model for this conversation')} disabled={disabled}><span>{currentLabel}</span><ChevronDown size={12} /></button></Popover.Trigger>
    <Popover.Portal container={portal ?? undefined}><Popover.Content className="model-picker-content" side={side} sideOffset={8} collisionPadding={12} align="start" aria-label={t('Choose a model')}>
      <Command label={t('Search models')} loop filter={(id, query, keywords) => {
        const candidates = [id, ...(keywords ?? [])].map((value) => value.toLowerCase())
        return query.trim().toLowerCase().split(/\s+/).every((term) => candidates.some((value) => value.includes(term))) ? 1 : 0
      }}><div className="model-search"><Search size={15} /><Command.Input placeholder={t('Find a model or provider…')} /></div><Command.List className="model-options" label={t('Models')}><Command.Empty>{t('No matching models.')}</Command.Empty>{Array.from(groups, ([provider, entries]) => <Command.Group heading={provider} key={provider}>{entries.map((entry) => {
        const meta = object(entry.meta)
        const description = [typeof meta.context === 'number' ? t('{count} context', { count: number(meta.context) }) : '', meta.reasoning === true ? t('Reasoning') : ''].filter(Boolean).join(' · ')
        return <Command.Item className="model-option" key={entry.id} value={entry.id} keywords={[entry.label, provider]} onSelect={() => { onValueChange(entry.id); setOpen(false) }}>
          <span className="model-option-copy"><span>{entry.label}</span><small>{description || entry.id}</small></span>{value === entry.id && <Check size={14} className="picker-check" />}
        </Command.Item>
      })}</Command.Group>)}</Command.List><div className="model-picker-hint"><span>{t('↑ ↓ to navigate')}</span><span>{t('↵ to choose')}</span></div></Command>
    </Popover.Content></Popover.Portal>
  </Popover.Root>
}
