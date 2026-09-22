import type { CSSProperties } from 'react'
import { Asterisk, Diamond, Flower2, Orbit, Sparkles } from './icons'
import './collaboration-dock.css'

export interface CollaborationAvatarProps {
  name: string
  kind?: 'agent' | 'room'
  main?: boolean
  status?: string
  size?: 'small' | 'medium'
  className?: string
  variant?: 'initial' | 'glyph'
}

function identityHue(name: string): number {
  return Array.from(name).reduce((hash, char) => (hash * 31 + (char.codePointAt(0) ?? 0)) % 360, 0)
}

export function CollaborationAvatar({ name, kind = 'agent', main = false, status, size = 'medium', className = '', variant = 'initial' }: CollaborationAvatarProps): React.JSX.Element {
  const initial = Array.from(name.trim())[0]?.toLocaleUpperCase() ?? '?'
  const hue = identityHue(name)
  const glyphs = [Sparkles, Flower2, Asterisk, Orbit, Diamond]
  const Glyph = main ? Sparkles : glyphs[hue % glyphs.length]
  return <span aria-hidden="true" className={`collaboration-avatar collaboration-avatar-${kind} collaboration-avatar-${size} ${main ? 'collaboration-avatar-main' : ''} ${variant === 'glyph' ? 'collaboration-avatar-glyph' : ''} ${className}`} style={{ '--avatar-hue': hue } as CSSProperties}>
    {kind === 'room' ? '#' : variant === 'glyph' ? <Glyph size={19} strokeWidth={1.8} fill="currentColor" fillOpacity={0.12} /> : initial}
    {status && <span className="collaboration-avatar-status" data-status={status} />}
  </span>
}
