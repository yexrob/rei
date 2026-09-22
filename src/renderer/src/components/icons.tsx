import { forwardRef, type ReactNode, type SVGProps } from 'react'
import './icons.css'

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number | string
  title?: string
}

export type IconComponent = React.ForwardRefExoticComponent<IconProps & React.RefAttributes<SVGSVGElement>>

// Rei's 24-unit optical grid: rounded joins, open seams, quiet inset details.
// Drawings are authored here rather than wrapped from a third-party icon set.
function icon(name: string, drawing: ReactNode): IconComponent {
  const Icon = forwardRef<SVGSVGElement, IconProps>(function ReiIcon({ size = 24, className, title, children, ...props }, ref) {
    const labelled = Boolean(props['aria-label'] || props['aria-labelledby'] || title)
    return <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" focusable="false" role={labelled ? 'img' : undefined} aria-hidden={labelled ? undefined : true} aria-label={title && !props['aria-labelledby'] ? title : undefined} {...props} className={`rei-icon${className ? ` ${className}` : ''}`} data-icon={name}>
      {title && <title>{title}</title>}{drawing}{children}
    </svg>
  })
  Icon.displayName = name
  return Icon
}

const terminal = <><path d="m5.5 7 4.5 5-4.5 5" /><path className="icon-accent" d="M12.5 17h6" /></>
const folder = <path d="M20.5 9v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2H10l2.5 3h6a2 2 0 0 1 2 2Z" />
const document = <path d="M19 11v8.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3H13l6 6h-6V3" />
const shield = <path d="M19.5 8v4.5c0 4-3.8 6.8-7.5 8.5-3.7-1.7-7.5-4.5-7.5-8.5V6L12 3l5 2" />
const circle = <path d="M19.6 7.2A9 9 0 1 1 15 3.5" />
const clock = <><circle cx="12" cy="12" r="8.5" /><path className="icon-accent" d="M12 7v5l3.5 2" /></>

export const ReiMark = icon('rei-mark', <><path d="M18.2 5.8A8.8 8.8 0 1 0 20.8 12" /><path className="icon-accent" d="m18.5 3.5 2 2" /><path d="m8.7 15.3 6.6-6.6" /></>)
export const ArrowLeft = icon('arrow-left', <path className="icon-motion" d="M19.5 12h-15m6-6-6 6 6 6" />)
export const ArrowRight = icon('arrow-right', <path className="icon-motion" d="M4.5 12h15m-6-6 6 6-6 6" />)
export const ArrowUp = icon('arrow-up', <path className="icon-motion" d="M12 19.5v-15m-6 6 6-6 6 6" />)
export const ArrowDown = icon('arrow-down', <path className="icon-motion" d="M12 4.5v15m-6-6 6 6 6-6" />)
export const ArrowUpRight = icon('arrow-up-right', <path className="icon-motion" d="M6 18 18 6H7m11 0v11" />)
export const ChevronDown = icon('chevron-down', <path d="m6 9 6 6 6-6" />)
export const ChevronUp = icon('chevron-up', <path d="m6 15 6-6 6 6" />)
export const ChevronRight = icon('chevron-right', <path d="m9 6 6 6-6 6" />)
export const Plus = icon('plus', <><path d="M5 12h14" /><path className="icon-accent" d="M12 5v14" /></>)
export const X = icon('x', <path d="m6 6 12 12M18 6 6 18" />)
export const Check = icon('check', <path className="icon-accent" d="m5 12 4.5 4.5L19 7" />)
export const CheckCircle = icon('check-circle', <>{circle}<path className="icon-accent" d="m8 11.5 3.5 3.5L20 6.5" /></>)
export const Square = icon('square', <rect x="5.5" y="5.5" width="13" height="13" rx="2" />)
export const Search = icon('search', <><circle cx="10.5" cy="10.5" r="6.5" /><path className="icon-motion" d="m16 16 4.5 4.5" /></>)
export const Copy = icon('copy', <><path d="M7 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" /><rect className="icon-motion" x="8" y="8" width="13" height="13" rx="2" /></>)
export const MoreHorizontal = icon('more-horizontal', <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>)
export const Download = icon('download', <><path className="icon-motion" d="M12 3.5v12m-4-4 4 4 4-4" /><path d="M4.5 16v3a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-3" /></>)
export const ExternalLink = icon('external-link', <><path d="M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" /><path className="icon-motion" d="m11 13 10-10h-7m7 0v7" /></>)
export const Trash2 = icon('trash', <><path className="icon-motion" d="M3.5 6.5h17M9 6.5V3h6v3.5" /><path d="m5.5 9 1 10.5A1.5 1.5 0 0 0 8 21h8a1.5 1.5 0 0 0 1.5-1.5L18.5 9M10 10v6.5m4-6.5v6.5" /></>)
export const Folder = icon('folder', <>{folder}<path className="icon-accent" d="M7 10h4" /></>)
export const FolderOpen = icon('folder-open', <><path d="M3.5 17V6a2 2 0 0 1 2-2H10l2.5 3h6a2 2 0 0 1 2 2" /><path className="icon-motion" d="m3.5 20 2.7-9H22l-2.4 7.6a2 2 0 0 1-1.9 1.4Z" /></>)
export const FileText = icon('file-text', <>{document}<path className="icon-accent" d="M8.5 13h7M8.5 17h5" /></>)
export const FileCode2 = icon('file-code', <>{document}<path className="icon-accent" d="m10.5 12-3 3 3 3m3-6 3 3-3 3" /></>)
export const FileImage = icon('file-image', <>{document}<path className="icon-accent" d="m8 18 3-4 2 2 2-1 1 3" /><circle cx="9" cy="11" r=".7" fill="currentColor" stroke="none" /></>)
export const FileSearch = icon('file-search', <><path d="M10 21H6.5A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3H13l6 6h-6V3" /><circle cx="15" cy="15" r="4" /><path className="icon-motion" d="m18 18 3.5 3.5" /></>)
export const Terminal = icon('terminal', terminal)
export const SquareTerminal = icon('square-terminal', <><rect x="2.5" y="3.5" width="19" height="17" rx="3" /><path d="m6 8 4 4-4 4" /><path className="icon-accent" d="M13 16h5" /></>)
export const TerminalSquare = SquareTerminal
export const Monitor = icon('monitor', <><rect x="2.5" y="3.5" width="19" height="13" rx="2.5" /><path d="M12 16.5v4M8 21h8" /><path className="icon-accent" d="M6.5 13h3" /></>)
export const Laptop = icon('laptop', <><path d="M5 16V5.5A1.5 1.5 0 0 1 6.5 4h11A1.5 1.5 0 0 1 19 5.5V16M2 19l2-3h16l2 3-1 1H3Z" /><path className="icon-accent" d="M10 17h4" /></>)
export const PanelLeft = icon('panel-left', <><rect x="2.5" y="3.5" width="19" height="17" rx="3" /><path className="icon-accent" d="M9 4v16M5.5 8h.1m-.1 4h.1" /></>)
export const PanelRight = icon('panel-right', <><rect x="2.5" y="3.5" width="19" height="17" rx="3" /><path className="icon-accent" d="M15 4v16M18.5 8h.1m-.1 4h.1" /></>)
export const PanelsTopLeft = icon('panels-top-left', <><rect x="2.5" y="3.5" width="19" height="17" rx="3" /><path d="M3 9h18M9 9v11" /><path className="icon-accent" d="M6 6.5h2" /></>)
export const Globe = icon('globe', <><circle cx="12" cy="12" r="9" /><path d="M3.5 12h17M12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z" /></>)
export const Globe2 = icon('globe-2', <><circle cx="12" cy="12" r="9" /><path d="m5 6 4 1 1 4-3 2-3-1m16-4-5 1-2 4 3 2-1 5" /><path className="icon-accent" d="m7 17 2 1" /></>)
export const Shield = icon('shield', <>{shield}<path className="icon-accent" d="M12 8v7" /></>)
export const ShieldCheck = icon('shield-check', <>{shield}<path className="icon-accent" d="m9 11.5 3 3 8-9" /></>)
export const KeyRound = icon('key-round', <><circle cx="8" cy="8" r="5" /><path className="icon-accent" d="m11.5 11.5 9 9M17 17l3-3m-6 0 2-2" /><circle cx="6.5" cy="6.5" r=".7" fill="currentColor" stroke="none" /></>)
export const Settings2 = icon('settings', <><path d="M4 6h9m5 0h2M4 12h2m5 0h9M4 18h9m5 0h2" /><circle className="icon-accent" cx="15.5" cy="6" r="2.5" /><circle cx="8.5" cy="12" r="2.5" /><circle className="icon-accent" cx="15.5" cy="18" r="2.5" /></>)
export const SlidersHorizontal = icon('sliders-horizontal', <><path d="M3 7h5m5 0h8M3 17h10m5 0h3" /><rect className="icon-accent" x="8" y="4" width="5" height="6" rx="1" /><rect x="13" y="14" width="5" height="6" rx="1" /></>)
export const Keyboard = icon('keyboard', <><rect x="2.5" y="5.5" width="19" height="13" rx="2.5" /><path d="M6.5 9h.1m3.5 0h.1m3.5 0h.1m3.5 0h.1M6.5 12h.1m3.5 0h.1m3.5 0h.1m3.5 0h.1" /><path className="icon-accent" d="M8 15h8" /></>)
export const Cpu = icon('cpu', <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3" /><path className="icon-accent" d="M10 10h4v4h-4Z" /></>)
export const Brain = icon('brain', <><path d="M12 5c-3-4-7-1-7 2-4 1-4 6-1 8-1 4 4 7 8 4 4 3 9 0 8-4 3-2 3-7-1-8 0-3-4-6-7-2Zm0 0v14" /><path className="icon-accent" d="M5 8c2 0 3 1 3 3m11-3c-2 0-3 1-3 3M7 16l2-2m8 2-2-2" /></>)
export const Palette = icon('palette', <><path d="M12 3a9 9 0 1 0 0 18c2 0 2-2 1-3s-1-3 1-3h3a4 4 0 0 0 4-4c0-5-4-8-9-8Z" /><path className="icon-accent" d="M7 9h.1m4-3h.1m5 2h.1M6 14h.1" /></>)
export const Sun = icon('sun', <><circle cx="12" cy="12" r="4" /><path className="icon-motion" d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>)
export const Moon = icon('moon', <path d="M19.8 15.8A8.8 8.8 0 0 1 8.2 4.2 8.8 8.8 0 1 0 19.8 15.8Z" />)
export const Clock3 = icon('clock', clock)
export const AlarmClock = icon('alarm-clock', <><circle cx="12" cy="13" r="7.5" /><path d="m3 5 3-2m12 0 3 2M6 20l-1 1m13-1 1 1" /><path className="icon-accent" d="M12 9v4l3 2" /></>)
export const CalendarClock = icon('calendar-clock', <><path d="M9 21H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v3M7 2v4m9-4v4M3 9h17" /><circle cx="16.5" cy="16.5" r="5" /><path className="icon-accent" d="M16.5 13.5v3l2 1" /></>)
export const RotateCw = icon('rotate-cw', <g className="icon-motion"><path d="M20 10a8 8 0 1 0-1 8M20 4v6h-6" /></g>)
export const RefreshCw = icon('refresh-cw', <g className="icon-motion"><path d="M20 9a8.5 8.5 0 0 0-15-3M20 3v6h-6M4 15a8.5 8.5 0 0 0 15 3M4 21v-6h6" /></g>)
export const LoaderCircle = icon('loader-circle', <><path d="M20 12a8 8 0 1 1-8-8" /><path className="icon-accent" d="M16 5.1a8 8 0 0 1 2.9 2.9" /></>)
export const Info = icon('info', <>{circle}<path d="M12 11v6" /><circle cx="12" cy="7.5" r=".8" fill="currentColor" stroke="none" /></>)
export const CircleHelp = icon('circle-help', <>{circle}<path d="M9 8.5c0-3 6-3 6 0 0 2-3 2-3 4" /><circle cx="12" cy="16.5" r=".8" fill="currentColor" stroke="none" /></>)
export const CirclePause = icon('circle-pause', <>{circle}<path className="icon-accent" d="M9.5 8v8m5-8v8" /></>)
export const TriangleAlert = icon('triangle-alert', <><path d="M10.6 4.5a1.6 1.6 0 0 1 2.8 0l8 14A1.6 1.6 0 0 1 20 21H4a1.6 1.6 0 0 1-1.4-2.5Z" /><path d="M12 9v5" /><circle cx="12" cy="17.5" r=".8" fill="currentColor" stroke="none" /></>)
export const MessageSquare = icon('message-square', <><path d="M19 17H9l-5 4V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z" /><path className="icon-accent" d="M8 8h9M8 12h5" /></>)
export const MessagesSquare = icon('messages-square', <><path d="M13 15H7l-4 3V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v2M8 19h9l4 3V11a2 2 0 0 0-2-2h-9a2 2 0 0 0-2 2v4" /><path className="icon-accent" d="M12 13h5" /></>)
export const AtSign = icon('at-sign', <><circle cx="12" cy="12" r="4" /><path d="M16 8v6c0 3 5 2 5-2a9 9 0 1 0-5 8" /></>)
export const Hash = icon('hash', <><path d="m10 3-2 18m8-18-2 18" /><path className="icon-accent" d="M4 8h17M3 16h17" /></>)
export const Pin = icon('pin', <><path d="m15 3 6 6-4 2-2 6-8-8 6-2ZM7 17l-4 4" /><path className="icon-accent" d="m7 17 4-4" /></>)
export const SquarePen = icon('square-pen', <><path d="M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6" /><path className="icon-motion" d="m9 11 9-9 4 4-9 9-5 1Zm7-7 4 4" /></>)
export const BookOpen = icon('book-open', <><path d="M12 6C9 3 5 3 3 4v15c3-1 6-1 9 2 3-3 6-3 9-2V4c-2-1-6-1-9 2Zm0 0v15" /><path className="icon-accent" d="m6 8 3 1m6 0 3-1" /></>)
export const Layers = icon('layers', <><path d="m12 3 10 5-10 5L2 8Z" /><path className="icon-accent" d="m3 13 9 4 9-4" /><path d="m3 18 9 4 9-4" /></>)
export const Blocks = icon('blocks', <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><path className="icon-accent" d="M14 6.5h7M17.5 3v7" /></>)
export const ListTodo = icon('list-todo', <><path className="icon-accent" d="m3 6 2 2 3-4m-5 9 2 2 3-4" /><path d="M12 6h9m-9 7h9m-9 7h9M4 20h3" /></>)
export const Lightbulb = icon('lightbulb', <><path d="M8 17c0-4-3-4-3-8a7 7 0 0 1 14 0c0 4-3 4-3 8ZM9 21h6" /><path className="icon-accent" d="m9 9 3 3 3-3m-3 3v5" /></>)
export const Bot = icon('bot', <><rect x="4" y="7" width="16" height="13" rx="4" /><path d="M12 7V3M2 12v4m20-4v4" /><path className="icon-accent" d="M8 12v2m8-2v2m-7 3h6" /><circle cx="12" cy="2.5" r=".5" /></>)
export const Plug = icon('plug', <><path d="M8 3v5m8-5v5M5 8h14M6 8v4a6 6 0 0 0 12 0V8" /><path className="icon-accent" d="M12 18v4" /></>)
export const Wrench = icon('wrench', <><path d="M14 3a6 6 0 0 0-7 8L2.8 17.5a2.6 2.6 0 0 0 3.7 3.7L13 17a6 6 0 0 0 8-7l-4 3-5-5Z" /><path className="icon-accent" d="m6 18 .1-.1" /></>)
export const GitCompareArrows = icon('git-compare-arrows', <><circle cx="6" cy="5" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="M6 7.5V15a3 3 0 0 0 3 3h2m7-1.5V9a3 3 0 0 0-3-3h-2" /><path className="icon-accent" d="m8 15 3 3-3 3m8-18-3 3 3 3" /></>)
export const Sparkles = icon('sparkles', <><path d="m10 4 2.5 6.5L19 13l-6.5 2.5L10 22l-2.5-6.5L1 13l6.5-2.5Z" /><path className="icon-accent" d="M19 2v6m-3-3h6" /></>)
export const Asterisk = icon('asterisk', <><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" /><circle className="icon-accent" cx="12" cy="12" r="2.5" /></>)
export const Diamond = icon('diamond', <><path d="m12 2 10 10-10 10L2 12Z" /><path className="icon-accent" d="m8 12 4 4 4-4-4-4Z" /></>)
export const Flower2 = icon('flower', <><path d="M12 6C6-3 1 6 6 10c-9 1-5 11 1 9 2 8 11 4 10-2 8 0 7-10 1-10 0-7-6-6-6-1Z" /><circle className="icon-accent" cx="12" cy="12" r="3" /></>)
export const Orbit = icon('orbit', <><circle cx="12" cy="12" r="3" /><ellipse cx="12" cy="12" rx="11" ry="5" transform="rotate(-40 12 12)" /><path className="icon-accent" d="M7 4a9 9 0 0 1 13 11M17 20A9 9 0 0 1 4 9" /></>)
