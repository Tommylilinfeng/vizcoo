import { useState } from 'react'
import { TerminalChooser } from '../terminal/TerminalChooser.js'
import { TerminalSession } from '../terminal/TerminalSession.js'
import { Timeline } from '../view/Timeline.js'
import type { LaunchOptions } from '../terminal/launch-options.js'

export interface SessionCardProps {
  cardId: string
  opts: LaunchOptions | null
  focused: boolean
  showSplit: boolean
  activeConvIds: ReadonlySet<string>
  exitingIds: ReadonlySet<string>
  onFocus: () => void
  onSplit: () => void
  onClose: () => void
  onLaunch: (opts: LaunchOptions) => void
  onExit: () => void
}

export function SessionCard({ cardId, opts, focused, showSplit, activeConvIds, exitingIds, onFocus, onSplit, onClose, onLaunch, onExit }: SessionCardProps) {
  const [timelineOpen, setTimelineOpen] = useState(false)

  const title = opts
    ? (opts.resumeId ? 'Resumed session' : 'New session')
    : 'New session'

  const toggleTimeline = () => {
    if (!focused) onFocus()
    setTimelineOpen((v) => !v)
  }

  return (
    <div
      data-vizcoo-session-card
      data-card-id={cardId}
      onMouseDown={focused ? undefined : onFocus}
      className={[
        'relative flex h-full min-w-0 flex-1 flex-col bg-surface-0',
        focused ? '' : 'opacity-90',
      ].join(' ')}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-hairline px-3 py-2">
        <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${opts ? 'bg-accent-live' : 'bg-fg-deco'}`} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-fg">{title}</span>
        <button
          onClick={toggleTimeline}
          title={timelineOpen ? 'Hide timeline' : 'Show timeline'}
          aria-label="Toggle timeline"
          aria-pressed={timelineOpen}
          className={[
            'flex h-6 w-6 shrink-0 items-center justify-center rounded transition',
            timelineOpen
              ? 'bg-interactive-active text-fg'
              : 'text-fg-faint hover:bg-interactive hover:text-fg',
          ].join(' ')}
        >
          <TimelineIcon />
        </button>
        {showSplit && (
          <button
            onClick={onSplit}
            title="Split (new session)"
            aria-label="Split"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-faint transition hover:bg-interactive hover:text-fg"
          >
            <SplitIcon />
          </button>
        )}
        <button
          onClick={onClose}
          title="Close session"
          aria-label="Close"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-faint transition hover:bg-interactive hover:text-fg"
        >×</button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {!opts ? (
            <TerminalChooser onLaunch={onLaunch} activeConvIds={activeConvIds} exitingIds={exitingIds} />
          ) : (
            <TerminalSession opts={opts} onExit={onExit} />
          )}
        </div>
        {focused && timelineOpen && (
          <div className="w-[320px] shrink-0 border-l border-hairline">
            <Timeline onClose={() => setTimelineOpen(false)} />
          </div>
        )}
      </div>
    </div>
  )
}

function TimelineIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <rect x="2" y="2.5" width="12" height="11" rx="1" />
      <line x1="9.5" y1="2.5" x2="9.5" y2="13.5" />
    </svg>
  )
}

function SplitIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <rect x="2" y="3" width="5" height="10" rx="0.6" />
      <rect x="9" y="3" width="5" height="10" rx="0.6" />
    </svg>
  )
}
