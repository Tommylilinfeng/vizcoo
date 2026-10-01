import { useEffect, useRef } from 'react'
import { useViewStore } from './viewStore.js'
import type { Turn, FileChange } from '../../core/view/types.js'
import { relTime } from './util.js'

const TAIL_THRESHOLD_PX = 30

export function Timeline({ onClose }: { onClose: () => void }) {
  const conversations = useViewStore((s) => s.conversations)
  const selectedId = useViewStore((s) => s.selectedId)
  const turns = useViewStore((s) => s.turns)
  const selectedTurnIndex = useViewStore((s) => s.selectedTurnIndex)
  const selectTurn = useViewStore((s) => s.selectTurn)

  const conv = conversations.find((c) => c.id === selectedId) ?? null
  const scrollRef = useRef<HTMLDivElement>(null)
  const isTailingRef = useRef(true)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (isTailingRef.current) el.scrollTop = el.scrollHeight
  }, [turns.length, conv?.id])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight
    isTailingRef.current = dist < TAIL_THRESHOLD_PX
  }

  return (
    <div data-vizcoo-timeline className="flex h-full w-full flex-col bg-surface-1">
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-fg-dim">Turns</span>
          <button
            onClick={onClose}
            aria-label="Close timeline"
            title="Close"
            className="-mr-1.5 flex h-6 w-6 items-center justify-center rounded text-fg-faint transition-colors hover:bg-interactive hover:text-fg"
          >
            <ChevronRight />
          </button>
        </div>
        {conv && (
          <div className="mt-1.5 flex items-center gap-2 text-[12px] text-fg-faint">
            <Dot status={conv.status} />
            <span className="min-w-0 flex-1 truncate" title={conv.title}>{conv.title}</span>
          </div>
        )}
        <div className="mt-3">
          {turns.length === 0 ? (
            <Empty />
          ) : (
            <div className="-mx-2">
              {turns.map((t, i) => (
                <Row
                  key={i}
                  turn={t}
                  index={i}
                  selected={selectedTurnIndex === i}
                  live={selectedTurnIndex === null && conv?.status === 'alive' && i === turns.length - 1}
                  onSelect={() => selectTurn(selectedTurnIndex === i ? null : i)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ turn, index, selected, live, onSelect }: {
  turn: Turn
  index: number
  selected: boolean
  live: boolean
  onSelect: () => void
}) {
  const fileCount = turn.fileChanges.length
  const fileLabel = fileCount === 0 ? null : fileCount === 1 ? '1 file' : `${fileCount} files`
  const timeLabel = relTime(turn.timestamp)
  const meta = fileLabel ? `${fileLabel} · ${timeLabel}` : timeLabel

  return (
    <div className={[
      'overflow-hidden rounded-md transition-colors',
      selected ? 'bg-interactive-active' : 'hover:bg-interactive',
    ].join(' ')}>
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-center gap-3 px-3 py-3.5 text-left"
      >
        <span className="shrink-0 text-[15px] font-medium text-fg">
          Turn {index + 1}
        </span>
        {live && <span className="shrink-0 text-[12px] text-accent-live">live</span>}
        <span className="ml-auto truncate text-[13px] tabular-nums text-fg-faint">
          {meta}
        </span>
        {selected && <span className="shrink-0"><Check /></span>}
      </button>
      {selected && <ExpandedDetail turn={turn} />}
    </div>
  )
}

function ExpandedDetail({ turn }: { turn: Turn }) {
  return (
    <div data-vizcoo-turn-expanded className="border-t border-hairline-subtle px-2.5 pt-2.5 pb-3 space-y-3">
      {turn.userText && <DetailSection label="User" body={turn.userText} accent="text-fg-muted" />}
      {turn.assistantText && <DetailSection label="Claude" body={turn.assistantText} accent="text-fg-dim" />}
      {turn.fileChanges.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] text-fg-dim">Files</div>
          <div className="flex flex-wrap gap-1">
            {turn.fileChanges.map((c, i) => <Chip key={i} c={c} />)}
          </div>
        </div>
      )}
    </div>
  )
}

function DetailSection({ label, body, accent }: { label: string; body: string; accent: string }) {
  return (
    <div>
      <div className="mb-1 text-[11px] text-fg-dim">{label}</div>
      <div className={`max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed ${accent}`}>
        {body}
      </div>
    </div>
  )
}

function Chip({ c }: { c: FileChange }) {
  const name = c.path.split('/').pop() ?? c.path
  const isEdit = c.kind === 'edit'
  return (
    <span
      className={[
        'inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[12px]',
        isEdit ? 'bg-amber-400/10 text-amber-400' : 'bg-interactive text-fg-muted',
      ].join(' ')}
      title={`${c.path} · +${c.linesAdded} -${c.linesRemoved}`}
    >
      {name}
    </span>
  )
}

function Empty() {
  return (
    <div className="px-2 py-10 text-center text-[13px] leading-relaxed text-fg-faint">
      No turns yet
    </div>
  )
}

function Dot({ status }: { status: 'alive' | 'dead' }) {
  return status === 'alive'
    ? <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent-live" />
    : <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-fg-deco" />
}

function Check() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 text-fg">
      <polyline points="3.5 8 6.5 11 12.5 5" />
    </svg>
  )
}

function ChevronRight() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <polyline points="6 4 11 8 6 12" />
    </svg>
  )
}
